#!/bin/bash
# 9Router Database Backup Script
# Run manually or set up a cron job for automated backups

set -e

BACKUP_DIR=${BACKUP_DIR:-/opt/backups/9router}
CONTAINER_NAME=${CONTAINER_NAME:-9router}
DB_PATH=/app/data/9router.db

# Create backup directory
mkdir -p $BACKUP_DIR

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE=$BACKUP_DIR/9router_backup_$TIMESTAMP.db

echo ========================================
echo 9Router Database Backup
echo ========================================
echo Backup directory: $BACKUP_DIR
echo Backup file: $BACKUP_FILE
echo Timestamp: $TIMESTAMP
echo

# Check if container is running
if ! docker ps | grep -q $CONTAINER_NAME; then
    echo ERROR: Container $CONTAINER_NAME is not running
    exit 1
fi

# Create backup by copying from container
docker cp $CONTAINER_NAME:$DB_PATH $BACKUP_FILE

# Verify backup was created
if [ -f $BACKUP_FILE ]; then
    SIZE=$(du -h $BACKUP_FILE | cut -f1)
    echo SUCCESS: Backup created ($SIZE)
    
    # Optionally compress the backup
    gzip $BACKUP_FILE
    echo Compressed: ${BACKUP_FILE}.gz
    
    # Clean up old backups (keep last 7 days)
    find $BACKUP_DIR -name '9router_backup_*.db.gz' -mtime +7 -delete
    echo Cleaned up backups older than 7 days
else
    echo ERROR: Backup file was not created
    exit 1
fi

echo ========================================
echo Backup Complete!
echo ========================================