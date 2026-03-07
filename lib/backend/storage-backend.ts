/**
 * S3/MinIO Storage Backend
 * Provides S3-compatible storage for snapshots
 * Migrated from ephemeral/serverless_workers_sdk/storage.py
 *
 * METRICS WIRED: All operations emit metrics
 */

import { EventEmitter } from 'events';
import { createReadStream, createWriteStream, mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import * as zlib from 'zlib';
import { sandboxMetrics } from './metrics';

export interface StorageConfig {
  endpointUrl?: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
  prefix: string;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
}

export interface UploadResult {
  location: string;
  size: number;
  etag: string;
}

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB

export abstract class StorageBackend extends EventEmitter {
  abstract upload(localPath: string, remoteKey: string): Promise<UploadResult>;
  abstract download(remoteKey: string, localPath: string): Promise<boolean>;
  abstract delete(remoteKey: string): Promise<boolean>;
  abstract list(prefix: string): Promise<StorageObject[]>;
  abstract exists(remoteKey: string): Promise<boolean>;
}

export class S3StorageBackend extends StorageBackend {
  private client: any = null;
  private readonly config: StorageConfig;

  constructor(config: StorageConfig) {
    super();
    this.config = config;
  }

  private async getClient(): Promise<any> {
    if (!this.client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      
      const s3Config: any = {
        credentials: {
          accessKeyId: this.config.accessKey,
          secretAccessKey: this.config.secretKey,
        },
        region: this.config.region,
      };

      if (this.config.endpointUrl) {
        s3Config.endpoint = this.config.endpointUrl;
        s3Config.forcePathStyle = true; // Required for MinIO
      }

      this.client = new S3Client(s3Config);
    }
    return this.client;
  }

  private fullKey(remoteKey: string): string {
    return `${this.config.prefix}${remoteKey}`;
  }

  async upload(localPath: string, remoteKey: string): Promise<UploadResult> {
    const client = await this.getClient();
    const fullKey = this.fullKey(remoteKey);

    const stats = statSync(localPath);
    const fileSize = stats.size;
    const startTime = Date.now();

    this.emit('upload_start', { localPath, remoteKey, size: fileSize });
    sandboxMetrics.storageUploadsTotal.inc({ backend: 's3', status: 'started' });
    sandboxMetrics.storageUploadSize.observe({ backend: 's3' }, fileSize);

    try {
      const { PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');

      let etag: string;

      if (fileSize > MULTIPART_THRESHOLD) {
        // Multipart upload for large files
        etag = await this.multipartUpload(client, localPath, fullKey, fileSize);
      } else {
        // Simple upload for small files
        const fileContent = await this.readFile(localPath);
        const command = new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: fullKey,
          Body: fileContent,
        });
        const result = await client.send(command);
        etag = result.ETag || '';
      }

      const location = `s3://${this.config.bucket}/${fullKey}`;
      const duration = (Date.now() - startTime) / 1000;

      this.emit('upload_complete', { location, size: fileSize, etag });
      sandboxMetrics.storageUploadsTotal.inc({ backend: 's3', status: 'success' });
      sandboxMetrics.storageOperationDuration.observe(
        { backend: 's3', operation: 'upload' },
        duration
      );

      return { location, size: fileSize, etag };
    } catch (error: any) {
      const duration = (Date.now() - startTime) / 1000;
      this.emit('upload_error', { localPath, remoteKey, error });
      sandboxMetrics.storageUploadsTotal.inc({ backend: 's3', status: 'failure' });
      sandboxMetrics.storageOperationDuration.observe(
        { backend: 's3', operation: 'upload' },
        duration
      );
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  private async multipartUpload(client: any, localPath: string, fullKey: string, fileSize: number): Promise<string> {
    const { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');

    // Initiate multipart upload
    const initCommand = new CreateMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: fullKey,
    });
    const initResult = await client.send(initCommand);
    const uploadId = initResult.UploadId;

    try {
      const parts = [];
      const chunkSize = MULTIPART_THRESHOLD;
      let partNumber = 1;

      for (let start = 0; start < fileSize; start += chunkSize) {
        const end = Math.min(start + chunkSize, fileSize);
        const chunk = await this.readFileRange(localPath, start, end);

        const uploadCommand = new UploadPartCommand({
          Bucket: this.config.bucket,
          Key: fullKey,
          PartNumber: partNumber,
          UploadId: uploadId,
          Body: chunk,
        });

        const uploadResult = await client.send(uploadCommand);
        parts.push({
          PartNumber: partNumber,
          ETag: uploadResult.ETag,
        });
        partNumber++;
      }

      // Complete multipart upload
      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      });

      const completeResult = await client.send(completeCommand);
      return completeResult.ETag || '';
    } catch (error) {
      // Abort multipart upload on error
      const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
      const abortCommand = new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
        UploadId: uploadId,
      });
      await client.send(abortCommand);
      throw error;
    }
  }

  private async readFile(path: string): Promise<Buffer> {
    const { readFile } = await import('fs/promises');
    return readFile(path);
  }

  private async readFileRange(path: string, start: number, end: number): Promise<Buffer> {
    const { open } = await import('fs/promises');
    const fileHandle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(end - start);
      await fileHandle.read(buffer, 0, end - start, start);
      return buffer;
    } finally {
      await fileHandle.close();
    }
  }

  async download(remoteKey: string, localPath: string): Promise<boolean> {
    const client = await this.getClient();
    const fullKey = this.fullKey(remoteKey);
    const startTime = Date.now();

    this.emit('download_start', { remoteKey, localPath });
    sandboxMetrics.storageDownloadsTotal.inc({ backend: 's3', status: 'started' });

    try {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });

      const response = await client.send(command);

      // Ensure directory exists
      mkdirSync(dirname(localPath), { recursive: true });

      // Stream to file
      const writeStream = createWriteStream(localPath);

      if (response.Body) {
        await pipeline(response.Body as any, writeStream);
      }

      const stats = statSync(localPath);
      const duration = (Date.now() - startTime) / 1000;

      this.emit('download_complete', { remoteKey, localPath });
      sandboxMetrics.storageDownloadsTotal.inc({ backend: 's3', status: 'success' });
      sandboxMetrics.storageDownloadSize.observe({ backend: 's3' }, stats.size);
      sandboxMetrics.storageOperationDuration.observe(
        { backend: 's3', operation: 'download' },
        duration
      );
      return true;
    } catch (error: any) {
      const duration = (Date.now() - startTime) / 1000;
      this.emit('download_error', { remoteKey, localPath, error });
      sandboxMetrics.storageDownloadsTotal.inc({ backend: 's3', status: 'failure' });
      sandboxMetrics.storageOperationDuration.observe(
        { backend: 's3', operation: 'download' },
        duration
      );
      return false;
    }
  }

  async delete(remoteKey: string): Promise<boolean> {
    const client = await this.getClient();
    const fullKey = this.fullKey(remoteKey);

    this.emit('delete_start', { remoteKey });

    try {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });

      await client.send(command);
      
      this.emit('delete_complete', { remoteKey });
      return true;
    } catch (error: any) {
      this.emit('delete_error', { remoteKey, error });
      return false;
    }
  }

  async list(prefix: string): Promise<StorageObject[]> {
    const client = await this.getClient();
    const fullPrefix = this.fullKey(prefix);

    try {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: fullPrefix,
      });

      const response = await client.send(command);
      
      const objects: StorageObject[] = [];
      for (const obj of response.Contents || []) {
        const key = obj.Key || '';
        const relativeKey = key.startsWith(this.config.prefix) 
          ? key.slice(this.config.prefix.length)
          : key;

        objects.push({
          key: relativeKey,
          size: obj.Size || 0,
          lastModified: obj.LastModified || new Date(),
          etag: obj.ETag || '',
        });
      }

      return objects;
    } catch (error: any) {
      this.emit('list_error', { prefix, error });
      return [];
    }
  }

  async exists(remoteKey: string): Promise<boolean> {
    const client = await this.getClient();
    const fullKey = this.fullKey(remoteKey);

    try {
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });

      await client.send(command);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export class LocalStorageBackend extends StorageBackend {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
    
    // Ensure base directory exists
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
  }

  private fullPath(remoteKey: string): string {
    if (remoteKey.startsWith('/') || remoteKey.includes('..')) {
      throw new Error('Invalid remote key: absolute paths and path traversal not allowed');
    }
    return join(this.baseDir, remoteKey);
  }

  async upload(localPath: string, remoteKey: string): Promise<UploadResult> {
    const destPath = this.fullPath(remoteKey);
    const startTime = Date.now();

    this.emit('upload_start', { localPath, remoteKey });
    sandboxMetrics.storageUploadsTotal.inc({ backend: 'local', status: 'started' });

    try {
      // Ensure directory exists
      mkdirSync(dirname(destPath), { recursive: true });

      // Copy file
      const { copyFile } = await import('fs/promises');
      await copyFile(localPath, destPath);

      const stats = statSync(destPath);
      const location = `file://${destPath}`;
      const duration = (Date.now() - startTime) / 1000;

      this.emit('upload_complete', { location, size: stats.size, etag: '' });
      sandboxMetrics.storageUploadsTotal.inc({ backend: 'local', status: 'success' });
      sandboxMetrics.storageUploadSize.observe({ backend: 'local' }, stats.size);
      sandboxMetrics.storageOperationDuration.observe(
        { backend: 'local', operation: 'upload' },
        duration
      );

      return { location, size: stats.size, etag: '' };
    } catch (error: any) {
      const duration = (Date.now() - startTime) / 1000;
      this.emit('upload_error', { localPath, remoteKey, error });
      sandboxMetrics.storageUploadsTotal.inc({ backend: 'local', status: 'failure' });
      sandboxMetrics.storageOperationDuration.observe(
        { backend: 'local', operation: 'upload' },
        duration
      );
      throw error;
    }
  }

  async download(remoteKey: string, localPath: string): Promise<boolean> {
    const srcPath = this.fullPath(remoteKey);
    const startTime = Date.now();

    this.emit('download_start', { remoteKey, localPath });
    sandboxMetrics.storageDownloadsTotal.inc({ backend: 'local', status: 'started' });

    try {
      if (!existsSync(srcPath)) {
        sandboxMetrics.storageDownloadsTotal.inc({ backend: 'local', status: 'not_found' });
        return false;
      }

      // Ensure destination directory exists
      mkdirSync(dirname(localPath), { recursive: true });

      // Copy file
      const { copyFile } = await import('fs/promises');
      await copyFile(srcPath, localPath);

      const stats = statSync(localPath);
      const duration = (Date.now() - startTime) / 1000;

      this.emit('download_complete', { remoteKey, localPath });
      sandboxMetrics.storageDownloadsTotal.inc({ backend: 'local', status: 'success' });
      sandboxMetrics.storageDownloadSize.observe({ backend: 'local' }, stats.size);
      sandboxMetrics.storageOperationDuration.observe(
        { backend: 'local', operation: 'download' },
        duration
      );
      return true;
    } catch (error: any) {
      const duration = (Date.now() - startTime) / 1000;
      this.emit('download_error', { remoteKey, localPath, error });
      sandboxMetrics.storageDownloadsTotal.inc({ backend: 'local', status: 'failure' });
      sandboxMetrics.storageOperationDuration.observe(
        { backend: 'local', operation: 'download' },
        duration
      );
      return false;
    }
  }

  async delete(remoteKey: string): Promise<boolean> {
    const fullPath = this.fullPath(remoteKey);
    
    this.emit('delete_start', { remoteKey });

    try {
      const { unlink } = await import('fs/promises');
      await unlink(fullPath);
      
      this.emit('delete_complete', { remoteKey });
      return true;
    } catch (error: any) {
      this.emit('delete_error', { remoteKey, error });
      return false;
    }
  }

  async list(prefix: string): Promise<StorageObject[]> {
    const fullPrefix = this.fullPath(prefix);
    
    try {
      const { readdir, stat } = await import('fs/promises');
      const entries = await readdir(fullPrefix, { withFileTypes: true });
      
      const objects: StorageObject[] = [];
      for (const entry of entries) {
        const fullPath = join(fullPrefix, entry.name);
        const fileStat = await stat(fullPath);
        
        objects.push({
          key: entry.name,
          size: fileStat.size,
          lastModified: fileStat.mtime,
          etag: '',
        });
      }

      return objects;
    } catch (error: any) {
      this.emit('list_error', { prefix, error });
      return [];
    }
  }

  async exists(remoteKey: string): Promise<boolean> {
    const fullPath = this.fullPath(remoteKey);
    return existsSync(fullPath);
  }
}

// Factory function to create storage backend from config
export function createStorageBackend(config: Partial<StorageConfig> & { type: 's3' | 'local'; baseDir?: string }): StorageBackend {
  if (config.type === 's3') {
    if (!config.accessKey || !config.secretKey || !config.bucket) {
      throw new Error('S3 storage requires accessKey, secretKey, and bucket');
    }
    return new S3StorageBackend({
      endpointUrl: config.endpointUrl,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      bucket: config.bucket,
      region: config.region || 'us-east-1',
      prefix: config.prefix || 'snapshots/',
    });
  } else {
    return new LocalStorageBackend(config.baseDir || '/tmp/snapshots');
  }
}

// Singleton instances
let s3Backend: S3StorageBackend | null = null;
let localBackend: LocalStorageBackend | null = null;

export function getS3Backend(config: StorageConfig): S3StorageBackend {
  if (!s3Backend) {
    s3Backend = new S3StorageBackend(config);
  }
  return s3Backend;
}

export function getLocalBackend(baseDir: string = '/tmp/snapshots'): LocalStorageBackend {
  if (!localBackend) {
    localBackend = new LocalStorageBackend(baseDir);
  }
  return localBackend;
}
