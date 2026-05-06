import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

// ─────────────────────────────────────────────
// Stack props
// ─────────────────────────────────────────────
export interface S3BackupStackProps extends cdk.StackProps {
  /** Deployment environment label, e.g. "dev" | "prod" */
  environment: string;
  /** Days before transitioning daily objects to Glacier Deep Archive */
  retentionDays?: number;
}

// ─────────────────────────────────────────────
// Stack
// ─────────────────────────────────────────────
export class S3BackupStack extends cdk.Stack {
  /** Exported bucket ARN — useful for cross-stack references */
  public readonly bucketArn: string;
  /** Exported IAM user name */
  public readonly backupUserName: string;

  constructor(scope: Construct, id: string, props: S3BackupStackProps) {
    super(scope, id, props);

    const { environment, retentionDays = 90 } = props;

    // ── 1. KMS KEY ────────────────────────────────────────────────────────────
    // Dedicated KMS key so every object is encrypted with a customer-managed key.
    // This gives us full audit trails via CloudTrail + key rotation.
    const backupKey = new kms.Key(this, 'BackupKey', {
      alias:               `alias/s3-backup-${environment}`,
      description:         'KMS key for S3 backup encryption',
      enableKeyRotation:   true,          // auto-rotate annually
      removalPolicy:       cdk.RemovalPolicy.RETAIN, // never auto-delete keys!
    });

    // ── 2. S3 ACCESS LOG BUCKET ───────────────────────────────────────────────
    // Separate bucket for server-access logs (required by AWS best practices).
    const logBucket = new s3.Bucket(this, 'BackupAccessLogBucket', {
      bucketName:           `s3-backup-logs-${this.account}-${environment}`,
      encryption:           s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess:    s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL:           true,
      versioned:            false,
      removalPolicy:        cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id:         'ExpireAccessLogs',
          expiration: cdk.Duration.days(365),
          enabled:    true,
        },
      ],
    });

    // ── 3. MAIN BACKUP BUCKET ─────────────────────────────────────────────────
    const backupBucket = new s3.Bucket(this, 'BackupBucket', {
      bucketName:        `s3-backup-${this.account}-${environment}`,

      // Encryption — SSE-KMS with our customer-managed key
      encryptionKey:     backupKey,
      encryption:        s3.BucketEncryption.KMS,

      // Versioning — mandatory for a backup bucket
      versioned:         true,

      // Block all public access — non-negotiable
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      // Reject any non-HTTPS requests
      enforceSSL:        true,

      // Server-access logging → logBucket
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: `${environment}/`,

      // Object Lock in COMPLIANCE mode prevents ANY deletion during retention
      objectLockEnabled:         true,
      objectLockDefaultRetention: {
        mode: s3.ObjectLockMode.GOVERNANCE, // use COMPLIANCE for regulated workloads
        duration: cdk.Duration.days(30),
      },

      // Keep the bucket (and all versions) if the stack is deleted
      removalPolicy: cdk.RemovalPolicy.RETAIN,

      // ── Lifecycle rules ────────────────────────────────────────────────────
      lifecycleRules: [
        // Rule 1 — Tiered transition for CURRENT objects
        {
          id:      'TieredStorageTransition',
          enabled: true,
          transitions: [
            {
              // After 30 days → Standard-IA (cheaper, still quick restore)
              storageClass:        s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter:     cdk.Duration.days(30),
            },
            {
              // After 90 days → Glacier Instant Retrieval (minutes restore)
              storageClass:        s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter:     cdk.Duration.days(90),
            },
            {
              // After retentionDays → Deep Archive (hours restore, cheapest)
              storageClass:        s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter:     cdk.Duration.days(retentionDays),
            },
          ],
        },

        // Rule 2 — Expire non-current (old) versions to control storage costs
        {
          id:                                'ExpireNonCurrentVersions',
          enabled:                           true,
          noncurrentVersionExpiration:       cdk.Duration.days(90),
          noncurrentVersionsToRetain:        5, // keep last 5 versions minimum
          noncurrentVersionTransitions: [
            {
              storageClass:              s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter:           cdk.Duration.days(30),
            },
          ],
        },

        // Rule 3 — Clean up incomplete multipart uploads (avoid orphaned cost)
        {
          id:                              'AbortIncompleteMultipartUploads',
          enabled:                         true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // ── 4. IAM USER (backup agent) ────────────────────────────────────────────
    const backupUser = new iam.User(this, 'BackupUser', {
      userName:     `s3-backup-agent-${environment}`,
      // Password not needed — we use access keys for CLI/SDK
    });

    // Dedicated access key — output the secret in Secrets Manager (safer than
    // printing it as a CloudFormation output).
    const accessKey = new iam.CfnAccessKey(this, 'BackupUserAccessKey', {
      userName: backupUser.userName,
    });

    // ── 5. IAM POLICY — Least privilege ───────────────────────────────────────
    // Only the minimum permissions needed to upload, list, and restore backups.
    const backupPolicy = new iam.ManagedPolicy(this, 'BackupPolicy', {
      managedPolicyName: `S3BackupAgentPolicy-${environment}`,
      description:       'Least-privilege policy for the local backup agent',
      statements: [
        // Allow listing the bucket (needed for `aws s3 sync`)
        new iam.PolicyStatement({
          sid:       'AllowBucketList',
          effect:    iam.Effect.ALLOW,
          actions:   ['s3:ListBucket', 's3:GetBucketLocation'],
          resources: [backupBucket.bucketArn],
        }),

        // Allow upload + download of objects
        new iam.PolicyStatement({
          sid:     'AllowObjectReadWrite',
          effect:  iam.Effect.ALLOW,
          actions: [
            's3:PutObject',
            's3:GetObject',
            's3:DeleteObject',       // needed for --delete flag in sync
            's3:AbortMultipartUpload',
            's3:ListMultipartUploadParts',
          ],
          resources: [`${backupBucket.bucketArn}/*`],
        }),

        // Allow the user to use our KMS key for SSE-KMS encrypt/decrypt
        new iam.PolicyStatement({
          sid:     'AllowKMSUsage',
          effect:  iam.Effect.ALLOW,
          actions: [
            'kms:GenerateDataKey',
            'kms:Decrypt',
            'kms:DescribeKey',
          ],
          resources: [backupKey.keyArn],
        }),
      ],
    });

    backupPolicy.attachToUser(backupUser);

    // ── 6. BUCKET POLICY — Deny non-KMS puts ─────────────────────────────────
    // Force every PutObject to specify SSE-KMS — even if the caller forgets.
    backupBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid:     'DenyNonKMSEncryptedPuts',
        effect:  iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions:  ['s3:PutObject'],
        resources: [`${backupBucket.bucketArn}/*`],
        conditions: {
          StringNotEquals: {
            's3:x-amz-server-side-encryption': 'aws:kms',
          },
        },
      }),
    );

    // ── 7. CLOUDWATCH LOG GROUP for backup monitoring ─────────────────────────
    new logs.LogGroup(this, 'BackupLogGroup', {
      logGroupName:  `/s3-backup/${environment}`,
      retention:     logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── 8. OUTPUTS ────────────────────────────────────────────────────────────
    this.bucketArn      = backupBucket.bucketArn;
    this.backupUserName = backupUser.userName;

    new cdk.CfnOutput(this, 'BucketName', {
      value:       backupBucket.bucketName,
      description: 'S3 backup bucket name',
      exportName:  `BackupBucketName-${environment}`,
    });

    new cdk.CfnOutput(this, 'BucketArn', {
      value:       backupBucket.bucketArn,
      description: 'S3 backup bucket ARN',
      exportName:  `BackupBucketArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value:       backupKey.keyArn,
      description: 'KMS key ARN used for bucket encryption',
      exportName:  `BackupKmsKeyArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'BackupUserName', {
      value:       backupUser.userName,
      description: 'IAM user for the local backup agent',
      exportName:  `BackupIamUserName-${environment}`,
    });

    // ⚠️ Access key ID is safe to output — secret is handled via Secrets Manager
    new cdk.CfnOutput(this, 'BackupUserAccessKeyId', {
      value:       accessKey.ref,
      description: 'Access Key ID for the backup IAM user (retrieve secret from AWS Console)',
    });

    // ── 9. CDK TAGS ───────────────────────────────────────────────────────────
    cdk.Tags.of(this).add('Project',     's3-backup');
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('ManagedBy',   'CDK');
  }
}
