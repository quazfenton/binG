# Database Resilience and Backup Documentation

## Overview
This system provides an automated, secure, and resilient backup solution for the SQLite database. It ensures business continuity by providing an encrypted cloud-based recovery path if the local database is lost or corrupted.

## Backup Process
- **Encryption**: Backups are encrypted using **AES-256-GCM**, providing both confidentiality and integrity checking.
- **Transport**: Encrypted blobs are uploaded to an S3-compatible storage provider.
- **Automation**: Backups should be triggered periodically via the system's CRON service.

## Resilience Layer
The application uses a connection proxy (`resilience-layer.ts`) instead of direct database access. If the local file is missing, the system will:
1.  Pause current requests.
2.  Fetch the latest encrypted backup from external storage.
3.  Decrypt and restore the database to the local path.
4.  Resume database operations.

## Secondary Connection (Live Fallback)
While the app is running, you can connect an external viewer or secondary instance by pointing to the same S3 bucket or by creating a secondary Read-Only connection to the primary SQLite file via a network mount (e.g., Litestream or rclone). For non-disruptive access, prefer the Litestream sidecar which handles streaming replication of SQLite to S3 in real-time.
