/**
 * Database Resilience Layer
 * 
 * Attempts to connect to local DB; if failing, pulls encrypted backup 
 * and restores it to local.
 */

import { DatabaseBackupService } from './backup-service';
import fs from 'fs';

export async function getDatabaseConnection() {
  const DB_PATH = process.env.DATABASE_PATH || './database.sqlite';
  
  try {
    // Attempt local access
    if (fs.existsSync(DB_PATH)) {
      return require('better-sqlite3')(DB_PATH);
    }
    throw new Error('Local database missing');
  } catch (e) {
    console.warn('[Database] Local DB failed, attempting external recovery...');
    
    // Recovery flow
    const backupService = new DatabaseBackupService();
    // 1. Download latest from S3 (pseudocode)
    // 2. Decrypt
    await backupService.decryptLocal('./backup.sqlite.enc', DB_PATH);
    
    return require('better-sqlite3')(DB_PATH);
  }
}
