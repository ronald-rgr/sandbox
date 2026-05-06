# S3 Backup CDK Stack

AWS CDK (TypeScript) stack that provisions a production-ready S3 backup infrastructure
for local-to-cloud backups.

## What Gets Created

| Resource | Details |
|---|---|
| **KMS Key** | Customer-managed, auto-rotating, with alias |
| **S3 Log Bucket** | Stores server-access logs, 1-year retention |
| **S3 Backup Bucket** | Versioned, SSE-KMS, Object Lock, lifecycle tiers |
| **IAM User** | `s3-backup-agent-{env}` — least-privilege policy |
| **IAM Policy** | ListBucket + PutObject + GetObject + KMS usage only |
| **CloudWatch Log Group** | `/s3-backup/{env}` — for monitoring |

## Storage Lifecycle

```
Day 0–30   → S3 Standard
Day 31–90  → S3 Standard-IA
Day 91–180 → S3 Glacier Instant Retrieval
Day 180+   → S3 Glacier Deep Archive
```

Non-current versions are expired after 90 days (last 5 kept minimum).

## Prerequisites

- Node.js 18+
- AWS CLI configured (`aws configure`)
- CDK bootstrapped in your account (`cdk bootstrap`)

```bash
npm install -g aws-cdk
```

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build

# 3. Preview the CloudFormation template
npm run synth

# 4. See what will change
npm run diff
```

## Deploy

```bash
# Deploy to dev (default)
npm run deploy

# Deploy to prod with custom retention
cdk deploy -c environment=prod -c retentionDays=365

# Deploy to specific AWS account/region
CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=us-west-2 npm run deploy
```

## Post-Deploy: Get Access Keys

After deploying, retrieve the IAM user secret access key from the AWS Console:

1. Go to **IAM → Users → s3-backup-agent-dev**
2. Click **Security credentials**
3. Find the Access Key ID from the CloudFormation Output
4. If you need to rotate, create a new key there

Configure on your local machine:

```bash
aws configure --profile s3-backup
# Enter Access Key ID, Secret Access Key, region
```

## Running a Backup

```bash
# Sync a local directory to the backup bucket
aws s3 sync /path/to/local/data s3://s3-backup-{account}-dev/daily/ \
  --storage-class STANDARD \
  --sse aws:kms \
  --profile s3-backup \
  --delete

# Dry-run first (always a good idea)
aws s3 sync /path/to/local/data s3://s3-backup-{account}-dev/daily/ \
  --dryrun \
  --profile s3-backup
```

## Tear Down

```bash
# Will NOT delete the bucket (RemovalPolicy.RETAIN)
cdk destroy

# To fully delete: manually empty and delete the bucket via AWS Console
```

## Security Notes

- All objects are encrypted with SSE-KMS (customer-managed key)
- Bucket policy **denies** any PutObject that doesn't use KMS encryption
- Object Lock prevents deletion during the 30-day governance window
- IAM user has **no console access** — API access only
- Public access is fully blocked at the bucket level
- MFA Delete should be enabled manually after deploy (requires root credentials)
