#!/usr/bin/env node

/**
 * Database Backup Script
 * 
 * Backs up the SQLite database to remote storage (S3, R2, etc.)
 * Run manually: node scripts/backup-database.js
 * Or schedule with cron: 0 2 * * * cd /path/to/app && node scripts/backup-database.js
 * 
 * Required environment variables:
 * - DATABASE_PATH: Path to SQLite database (default: ./data/bing.db)
 * - BACKUP_PROVIDER: 's3', 'r2', or 'local' (default: local)
 * 
 * For S3/R2 backups:
 * - BACKUP_ACCESS_KEY_ID
 * - BACKUP_SECRET_ACCESS_KEY  
 * - BACKUP_ENDPOINT (for R2, or S3-compatible)
 * - BACKUP_BUCKET
 * - BACKUP_REGION (optional, default: us-east-1)
 * 
 * Optional:
 * - BACKUP_RETENTION_DAYS: How many days to keep backups (default: 30)
 * - BACKUP_ENCRYPTION_KEY: Key to encrypt backups (recommended!)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  dbPath: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'bing.db'),
  provider: process.env.BACKUP_PROVIDER || 'local',
  retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30'),
  encryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
  
  // S3/R2 settings
  s3: {
    accessKeyId: process.env.BACKUP_ACCESS_KEY_ID,
    secretAccessKey: process.env.BACKUP_SECRET_ACCESS_KEY,
    endpoint: process.env.BACKUP_ENDPOINT,
    bucket: process.env.BACKUP_BUCKET,
    region: process.env.BACKUP_REGION || 'us-east-1',
  }
};

// Colors for console output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(level, message) {
  const timestamp = new Date().toISOString();
  const color = level === 'error' ? colors.red : level === 'warn' ? colors.yellow : colors.green;
  console.log(`${color}[${timestamp}] [${level.toUpperCase()}] ${message}${colors.reset}`);
}

/**
 * Encrypt file using AES-256-GCM
 */
function encryptFile(inputPath, outputPath, key) {
  const iv = crypto.randomBytes(16);

  // SECURITY: Use scrypt for key derivation to protect against brute-force attacks
  // scrypt is a proper KDF that is computationally expensive and memory-hard
  const keyBuffer = typeof key === 'string'
    ? crypto.scryptSync(key, 'bing-backup-salt', 32)
    : key;

  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);

  const input = fs.readFileSync(inputPath);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: IV (16 bytes) + Auth Tag (16 bytes) + Encrypted Data
  const output = Buffer.concat([iv, authTag, encrypted]);
  fs.writeFileSync(outputPath, output);

  return outputPath;
}

/**
 * Create local backup
 */
async function backupLocal(backupPath, backupFileName) {
  const backupDir = path.dirname(backupPath);
  
  // Ensure backup directory exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  // Copy database file
  fs.copyFileSync(CONFIG.dbPath, backupPath);
  
  log('info', `Local backup created: ${backupPath}`);
  
  // Clean up old backups
  cleanupOldBackups(backupDir);
  
  return backupPath;
}

/**
 * Upload to S3/R2
 */
async function uploadToS3(backupPath, backupFileName) {
  try {
    // Dynamic import for AWS SDK
    const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    
    const s3Client = new S3Client({
      region: CONFIG.s3.region,
      endpoint: CONFIG.s3.endpoint,
      credentials: {
        accessKeyId: CONFIG.s3.accessKeyId,
        secretAccessKey: CONFIG.s3.secretAccessKey,
      },
    });
    
    // Read file
    const fileContent = fs.readFileSync(backupPath);
    
    // Upload
    const command = new PutObjectCommand({
      Bucket: CONFIG.s3.bucket,
      Key: `backups/${backupFileName}`,
      Body: fileContent,
      ContentType: 'application/x-sqlite3',
      Metadata: {
        'backup-date': new Date().toISOString(),
        'database-version': getDatabaseVersion(),
      },
    });
    
    await s3Client.send(command);
    
    log('info', `Uploaded to S3: ${CONFIG.s3.bucket}/backups/${backupFileName}`);
    
    // Clean up old backups in S3
    await cleanupOldS3Backups(s3Client);
    
  } catch (error) {
    log('error', `Failed to upload to S3: ${error.message}`);
    throw error;
  }
}

/**
 * Get database version/schema info
 */
function getDatabaseVersion() {
  try {
    // This would need better-sqlite3, but for backup purposes we just return timestamp
    return new Date().toISOString();
  } catch {
    return 'unknown';
  }
}

/**
 * Clean up old local backups
 */
function cleanupOldBackups(backupDir) {
  try {
    const files = fs.readdirSync(backupDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.retentionDays);
    
    let deletedCount = 0;
    
    files.forEach(file => {
      if (file.startsWith('bing-') && file.endsWith('.db')) {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          deletedCount++;
          log('info', `Deleted old backup: ${file}`);
        }
      }
    });
    
    if (deletedCount > 0) {
      log('info', `Cleaned up ${deletedCount} old backup(s)`);
    }
  } catch (error) {
    log('warn', `Failed to cleanup old backups: ${error.message}`);
  }
}

/**
 * Clean up old S3 backups
 */
async function cleanupOldS3Backups(s3Client) {
  try {
    const { ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.retentionDays);
    
    const listCommand = new ListObjectsV2Command({
      Bucket: CONFIG.s3.bucket,
      Prefix: 'backups/',
    });
    
    const response = await s3Client.send(listCommand);
    
    if (response.Contents) {
      let deletedCount = 0;
      
      for (const object of response.Contents) {
        if (object.LastModified < cutoffDate) {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: CONFIG.s3.bucket,
            Key: object.Key,
          });
          
          await s3Client.send(deleteCommand);
          deletedCount++;
          log('info', `Deleted old S3 backup: ${object.Key}`);
        }
      }
      
      if (deletedCount > 0) {
        log('info', `Cleaned up ${deletedCount} old S3 backup(s)`);
      }
    }
  } catch (error) {
    log('warn', `Failed to cleanup old S3 backups: ${error.message}`);
  }
}

/**
 * Validate database before backup
 */
function validateDatabase() {
  try {
    // Check if file exists
    if (!fs.existsSync(CONFIG.dbPath)) {
      throw new Error(`Database file not found: ${CONFIG.dbPath}`);
    }
    
    // Check if file is readable
    fs.accessSync(CONFIG.dbPath, fs.constants.R_OK);
    
    // Check file size (should be > 0)
    const stats = fs.statSync(CONFIG.dbPath);
    if (stats.size === 0) {
      throw new Error('Database file is empty');
    }
    
    log('info', `Database validated: ${CONFIG.dbPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    return true;
  } catch (error) {
    log('error', `Database validation failed: ${error.message}`);
    return false;
  }
}

/**
 * Main backup function
 */
async function main() {
  log('info', 'Starting database backup...');
  
  // Validate database
  if (!validateDatabase()) {
    process.exit(1);
  }
  
  // Generate backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let backupFileName = `bing-${timestamp}.db`;
  
  // Create temp backup path
  const tempDir = path.join(process.cwd(), '.backup-temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  let backupPath = path.join(tempDir, backupFileName);
  
  try {
    // Create local backup first
    await backupLocal(backupPath, backupFileName);
    
    // Encrypt if key provided
    if (CONFIG.encryptionKey) {
      const encryptedPath = `${backupPath}.encrypted`;
      encryptFile(backupPath, encryptedPath, CONFIG.encryptionKey);
      backupPath = encryptedPath;
      backupFileName = `${backupFileName}.encrypted`;
      log('info', 'Backup encrypted');
    }
    
    // Upload based on provider
    switch (CONFIG.provider) {
      case 's3':
      case 'r2':
        if (!CONFIG.s3.accessKeyId || !CONFIG.s3.secretAccessKey || !CONFIG.s3.bucket) {
          throw new Error('Missing S3 credentials. Set BACKUP_ACCESS_KEY_ID, BACKUP_SECRET_ACCESS_KEY, and BACKUP_BUCKET');
        }
        await uploadToS3(backupPath, backupFileName);
        break;
        
      case 'local':
      default:
        // Move from temp to backup directory
        const finalBackupDir = path.join(process.cwd(), 'backups');
        if (!fs.existsSync(finalBackupDir)) {
          fs.mkdirSync(finalBackupDir, { recursive: true });
        }
        const finalPath = path.join(finalBackupDir, backupFileName);
        fs.copyFileSync(backupPath, finalPath);
        fs.unlinkSync(backupPath);
        log('info', `Backup saved locally: ${finalPath}`);
        break;
    }
    
    log('info', 'Backup completed successfully!');
    
  } catch (error) {
    log('error', `Backup failed: ${error.message}`);
    process.exit(1);
  } finally {
    // Cleanup temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// Run backup
main();