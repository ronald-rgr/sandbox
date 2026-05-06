#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { S3BackupStack } from '../lib/s3-backup-stack';

const app = new cdk.App();

// Read context values (can be overridden via `cdk deploy -c key=value`)
const environment = app.node.tryGetContext('environment') ?? 'dev';
const retentionDays = Number(app.node.tryGetContext('retentionDays') ?? 90);

new S3BackupStack(app, `S3BackupStack-${environment}`, {
  environment,
  retentionDays,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:  process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: `S3 Backup Strategy Stack — ${environment}`,
});

app.synth();
