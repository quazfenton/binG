# Database Security & Backup Guide

## 🔒 Security Protection (Already Implemented)

Your database is now protected by multiple layers:

### 1. Middleware Protection (`middleware.ts`)
Blocks all attempts to access:
- `.db`, `.sqlite`, `.sqlite3` files
- `.env` files
- `/data/` directory
- Backup files (`.bak`, `.backup`, `~`)

**Example blocked requests:**
```
GET /data/bing.db → 403 Forbidden
GET /.env → 403 Forbidden
GET /app.db → 403 Forbidden
```

### 2. .gitignore Protection
Database files are excluded from git:
```
*.db
*.db-shm
*.db-wal
/data/*.db
/backups/
```

### 3. File Permissions (Docker)
Database files have restricted permissions:
```dockerfile
RUN chmod 600 /app/data/*.db  # Owner read/write only
```

## 📦 Backup System

### Quick Start - Local Backups

```bash
# Create a backup locally
npm run backup
# or
node scripts/backup-database.js

# Backups are saved to: ./backups/bing-2026-02-18T12-00-00.db
```

### Automated Backups with Cron

Add to your crontab (`crontab -e`):

```bash
# Daily at 2 AM
0 2 * * * cd /path/to/bing && npm run backup >> /var/log/bing-backup.log 2>&1

# Weekly on Sundays at 3 AM
0 3 * * 0 cd /path/to/bing && BACKUP_RETENTION_DAYS=90 npm run backup
```

### Cloud Backups (S3/R2)

#### 1. Set environment variables:

```bash
# Required
BACKUP_PROVIDER=s3
BACKUP_ACCESS_KEY_ID=your_access_key
BACKUP_SECRET_ACCESS_KEY=your_secret_key
BACKUP_BUCKET=my-bing-backups
BACKUP_REGION=us-east-1

# Optional
BACKUP_RETENTION_DAYS=30
BACKUP_ENCRYPTION_KEY=your-encryption-key-here
```

#### 2. For Cloudflare R2:

```bash
BACKUP_PROVIDER=r2
BACKUP_ENDPOINT=https://your-account.r2.cloudflarestorage.com
BACKUP_ACCESS_KEY_ID=your_r2_access_key
BACKUP_SECRET_ACCESS_KEY=your_r2_secret_key
BACKUP_BUCKET=bing-backups
```

#### 3. Run backup:

```bash
npm run backup:s3
```

### Docker Backups

When using Docker, the backup is stored in a volume:

```bash
# Backup from running container
docker exec bing-app node scripts/backup-database.js

# Or use the data volume
docker run --rm -v bing_data:/data -v $(pwd)/backups:/backups alpine cp /data/bing.db /backups/
```

## 🔐 Encryption

**Highly Recommended for Production!**

Add encryption key to your `.env`:

```bash
# Generate a key: openssl rand -hex 32
BACKUP_ENCRYPTION_KEY=a1b2c3d4e5f6...
```

Backups will be encrypted with AES-256-GCM before upload.

## 📋 Restore from Backup

### Local Restore:

```bash
# Stop the app
docker-compose down

# Restore database
cp backups/bing-2026-02-18T12-00-00.db data/bing.db

# Restart
docker-compose up -d
```

### From S3/R2:

```bash
# Download and decrypt
aws s3 cp s3://my-bucket/backups/bing-2026-02-18T12-00-00.db.encrypted .
openssl enc -d -aes-256-cbc -in bing-2026-02-18T12-00-00.db.encrypted -out bing.db -k your-key
```

## 🚨 Security Checklist

Before deploying to production:

- [ ] Database files added to `.gitignore`
- [ ] `middleware.ts` blocking sensitive paths
- [ ] Database not in `public/` folder
- [ ] File permissions restricted (600)
- [ ] Backups encrypted with `BACKUP_ENCRYPTION_KEY`
- [ ] Backup retention policy set
- [ ] Regular backup schedule configured
- [ ] Tested restore process
- [ ] Separate backup credentials (not production!)

## 🐛 Troubleshooting

**"Database file not found"**
```bash
# Check path
ls -la data/
export DATABASE_PATH=/absolute/path/to/bing.db
```

**"S3 upload failed"**
```bash
# Verify credentials
aws s3 ls s3://your-bucket --endpoint-url=https://your-endpoint

# Check environment variables
echo $BACKUP_ACCESS_KEY_ID
echo $BACKUP_BUCKET
```

**"Permission denied"**
```bash
# Fix permissions
chmod 644 data/bing.db
chmod 755 data/
```

## 📊 Backup Strategy Recommendations

### For Personal/Small Use:
- Local backups: Daily
- Retention: 7 days
- No encryption needed (local only)

### For Production:
- Local + S3 backups: Every 6 hours
- Retention: 30 days locally, 90 days in S3
- Encryption: Required
- Test restore: Monthly

### For Enterprise:
- Automated backups: Hourly
- Cross-region replication
- Point-in-time recovery
- Encrypted at rest and in transit
- Compliance auditing

## 💡 Tips

1. **Keep backups separate from app** - Use different S3 bucket/credentials
2. **Test restores regularly** - A backup you can't restore is useless
3. **Monitor backup size** - Large databases need different strategies
4. **Encrypt everything** - Assume your storage will be compromised
5. **Use immutable backups** - Prevent ransomware from deleting backups
6. **Document everything** - Someone else might need to restore

## 🔗 Additional Resources

- [SQLite Backup Documentation](https://www.sqlite.org/backup.html)
- [AWS S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)