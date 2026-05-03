/**
 * Database Backup Service
 * 
 * Exports the SQLite database, encrypts it using AES-256-GCM, 
 * and uploads to an external provider (simulated here with S3).
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ENCRYPTION_KEY = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || '', 'hex'); // 32 bytes
const DB_PATH = process.env.DATABASE_PATH || './database.sqlite';

export class DatabaseBackupService {
  private s3: S3Client;

  constructor() {
    this.s3 = new S3Client({ region: 'us-east-1' });
  }

  async createBackup(): Promise<void> {
    // 1. Export/Dump the DB
    const backupPath = `/tmp/backup-${Date.now()}.sqlite`;
    fs.copyFileSync(DB_PATH, backupPath);

    // 2. Encrypt
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    
    const input = fs.createReadStream(backupPath);
    const output = fs.createWriteStream(`${backupPath}.enc`);
    
    // Write IV to start of file
    output.write(iv);

     // Stream encryption
     await new Promise<void>((resolve, reject) => {
       input.pipe(cipher).pipe(output).on('finish', () => resolve()).on('error', reject);
     });

    // 3. Upload
    const encryptedData = fs.readFileSync(`${backupPath}.enc`);
    await this.s3.send(new PutObjectCommand({
      Bucket: 'my-db-backups',
      Key: `backup-${Date.now()}.enc`,
      Body: encryptedData,
    }));
  }

  async decryptLocal(encryptedPath: string, outputPath: string): Promise<void> {
    const data = fs.readFileSync(encryptedPath);
    const iv = data.subarray(0, 12);
    const encryptedContent = data.subarray(12);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedContent), decipher.final()]);
    
    fs.writeFileSync(outputPath, decrypted);
  }
}
