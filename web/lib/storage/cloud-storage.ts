// Inlined feature flags to avoid Turbopack module resolution issues
const FEATURE_FLAGS = {
  NEXTCLOUD_URL: process.env.NEXTCLOUD_URL || '',
  NEXTCLOUD_USERNAME: process.env.NEXTCLOUD_USERNAME || '',
  NEXTCLOUD_PASSWORD: process.env.NEXTCLOUD_PASSWORD || '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  R2_ENDPOINT: process.env.R2_ENDPOINT || '',
  R2_BUCKET: process.env.R2_BUCKET || '',
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || '',
  PCLOUD_CLIENT_ID: process.env.PCLOUD_CLIENT_ID || '',
  PCLOUD_CLIENT_SECRET: process.env.PCLOUD_CLIENT_SECRET || '',
  PCLOUD_API_HOST: process.env.PCLOUD_API_HOST || 'api.pcloud.com',
  PCLOUD_REDIRECT_URI: process.env.PCLOUD_REDIRECT_URI || '',
  STORJ_ACCESS_KEY: process.env.STORJ_ACCESS_KEY || '',
  STORJ_SECRET_KEY: process.env.STORJ_SECRET_KEY || '',
  STORJ_ENDPOINT: process.env.STORJ_ENDPOINT || 'https://gateway.storjshare.io',
  STORJ_BUCKET: process.env.STORJ_BUCKET || '',
  ENABLE_CLOUD_STORAGE: process.env.ENABLE_CLOUD_STORAGE === 'true',
  CLOUD_STORAGE_PROVIDER: process.env.CLOUD_STORAGE_PROVIDER || 'gcp',
  CLOUD_STORAGE_BUCKET: process.env.CLOUD_STORAGE_BUCKET || '',
  CLOUD_STORAGE_MAX_SIZE: parseInt(process.env.CLOUD_STORAGE_MAX_SIZE || '104857600', 10),
  CLOUD_STORAGE_PER_USER_LIMIT_BYTES: parseInt(process.env.CLOUD_STORAGE_PER_USER_LIMIT_BYTES || '5368709120', 10),
  IS_DEVELOPMENT: process.env.NODE_ENV === 'development',
  ENABLE_VPS_DEPLOYMENT: process.env.ENABLE_VPS_DEPLOYMENT === 'true',
  VPS_PROVIDER: process.env.VPS_PROVIDER || 'aws',
  VPS_DEFAULT_REGION: process.env.VPS_DEFAULT_REGION || 'us-east-1',
  VPS_DEFAULT_SIZE: process.env.VPS_DEFAULT_SIZE || 't3.medium',
};
import { createClient } from 'webdav';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface CloudStorageService {
  upload(file: File, path: string, userId?: string): Promise<string>;
  download(path: string, userId?: string): Promise<Blob>;
  delete(path: string, userId?: string): Promise<void>;
  list(prefix?: string, userId?: string): Promise<string[]>;
  getSignedUrl(path: string, expiresIn?: number, userId?: string): Promise<string>;
  getUsage(userId: string): Promise<{ used: number; limit: number }>;
}

// In-memory storage for development
const userStorageUsage: Record<string, number> = {};
const mockFileStorage: Record<string, Blob> = {};

class NextcloudStorageService implements CloudStorageService {
  private client: any;
  private baseUrl: string;
  private username: string;
  private password: string;

  constructor() {
    this.baseUrl = FEATURE_FLAGS.NEXTCLOUD_URL;
    this.username = FEATURE_FLAGS.NEXTCLOUD_USERNAME;
    this.password = FEATURE_FLAGS.NEXTCLOUD_PASSWORD;
    
    this.client = createClient(this.baseUrl, {
      username: this.username,
      password: this.password,
    });
  }

  private getFullPath(path: string, userId?: string): string {
    const userPrefix = userId ? `users/${userId}/` : '';
    return `${userPrefix}${path}`;
  }

  async upload(file: File, path: string, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      // Check quota before upload
      const currentUsage = await this.getUsage(userId || 'anonymous');
      if (currentUsage.used + file.size > currentUsage.limit) {
        throw new Error(`Storage limit exceeded. Max ${Math.round(currentUsage.limit / (1024 * 1024 * 1024))}GB per user.`);
      }

      // Upload to Nextcloud
      await this.client.putFileContents(fullPath, file.stream());
      
      // Update usage tracking
      if (userId) {
        userStorageUsage[userId] = (userStorageUsage[userId] || 0) + file.size;
      }

      return `${this.baseUrl}/${fullPath}`;
    } catch (error) {
      console.error('Nextcloud upload failed:', error);
      throw new Error(`Failed to upload file to Nextcloud: ${(error as Error).message}`);
    }
  }

  async download(path: string, userId?: string): Promise<Blob> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      const response = await this.client.getFileContents(fullPath, { format: 'blob' });
      return response as Blob;
    } catch (error) {
      console.error('Nextcloud download failed:', error);
      throw new Error(`Failed to download file from Nextcloud: ${(error as Error).message}`);
    }
  }

  async delete(path: string, userId?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      // Get file size before deletion for usage tracking
      if (userId) {
        try {
          const stat = await this.client.stat(fullPath);
          const fileSize = stat.size || 0;
          userStorageUsage[userId] = Math.max(0, (userStorageUsage[userId] || 0) - fileSize);
        } catch (e) {
          // File might not exist, continue with deletion
        }
      }

      await this.client.deleteFile(fullPath);
    } catch (error) {
      console.error('Nextcloud delete failed:', error);
      throw new Error(`Failed to delete file from Nextcloud: ${(error as Error).message}`);
    }
  }

  async list(prefix?: string, userId?: string): Promise<string[]> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPrefix = this.getFullPath(prefix || '', userId);
    
    try {
      const contents = await this.client.getDirectoryContents(fullPrefix);
      return contents
        .filter((item: any) => item.type === 'file')
        .map((item: any) => item.filename.replace(fullPrefix, '').replace(/^\//, ''));
    } catch (error) {
      console.error('Nextcloud list failed:', error);
      throw new Error(`Failed to list files from Nextcloud: ${(error as Error).message}`);
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      // For Nextcloud, we'll use a direct URL with basic auth
      // In production, you might want to implement proper signed URLs
      const url = new URL(fullPath, this.baseUrl);
      url.username = this.username;
      url.password = this.password;
      return url.toString();
    } catch (error) {
      console.error('Nextcloud signed URL failed:', error);
      throw new Error(`Failed to generate signed URL: ${(error as Error).message}`);
    }
  }

  async getUsage(userId: string): Promise<{ used: number; limit: number }> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      // For Nextcloud, we'll use the in-memory tracking for now
      // In production, you'd query Nextcloud's quota API
      return {
        used: userStorageUsage[userId] || 0,
        limit: FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES,
      };
    } catch (error) {
      console.error('Nextcloud usage check failed:', error);
      throw new Error(`Failed to get usage: ${(error as Error).message}`);
    }
  }
}

class S3StorageService implements CloudStorageService {
  private client: S3Client;
  private bucketName: string;

  constructor() {
    this.bucketName = FEATURE_FLAGS.CLOUD_STORAGE_BUCKET;
    
    this.client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  private getFullPath(path: string, userId?: string): string {
    const userPrefix = userId ? `users/${userId}/` : '';
    return `${userPrefix}${path}`;
  }

  async upload(file: File, path: string, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      // Check quota before upload
      const currentUsage = await this.getUsage(userId || 'anonymous');
      if (currentUsage.used + file.size > currentUsage.limit) {
        throw new Error(`Storage limit exceeded. Max ${Math.round(currentUsage.limit / (1024 * 1024 * 1024))}GB per user.`);
      }

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
        Body: file,
        ContentType: file.type,
        Metadata: {
          userId: userId || 'anonymous',
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
        },
      });

      await this.client.send(command);
      
      // Update usage tracking
      if (userId) {
        userStorageUsage[userId] = (userStorageUsage[userId] || 0) + file.size;
      }

      return `https://${this.bucketName}.s3.amazonaws.com/${fullPath}`;
    } catch (error) {
      console.error('S3 upload failed:', error);
      throw new Error(`Failed to upload file to S3: ${(error as Error).message}`);
    }
  }

  async download(path: string, userId?: string): Promise<Blob> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error('No file content received');
      }

      return response.Body as Blob;
    } catch (error) {
      console.error('S3 download failed:', error);
      throw new Error(`Failed to download file from S3: ${(error as Error).message}`);
    }
  }

  async delete(path: string, userId?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      // Get file size before deletion for usage tracking
      if (userId) {
        try {
          const headCommand = new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: fullPath,
          });
          const headResponse = await this.client.send(headCommand);
          const fileSize = headResponse.ContentLength || 0;
          userStorageUsage[userId] = Math.max(0, (userStorageUsage[userId] || 0) - fileSize);
        } catch (e) {
          // File might not exist, continue with deletion
        }
      }

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('S3 delete failed:', error);
      throw new Error(`Failed to delete file from S3: ${(error as Error).message}`);
    }
  }

  async list(prefix?: string, userId?: string): Promise<string[]> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPrefix = this.getFullPath(prefix || '', userId);
    
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: fullPrefix,
      });

      const response = await this.client.send(command);
      return (response.Contents || [])
        .map(obj => obj.Key?.replace(fullPrefix, '').replace(/^\//, ''))
        .filter(Boolean) as string[];
    } catch (error) {
      console.error('S3 list failed:', error);
      throw new Error(`Failed to list files from S3: ${(error as Error).message}`);
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      console.error('S3 signed URL failed:', error);
      throw new Error(`Failed to generate signed URL: ${(error as Error).message}`);
    }
  }

  async getUsage(userId: string): Promise<{ used: number; limit: number }> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      // For S3, we'll use the in-memory tracking for now
      // In production, you'd query S3's storage metrics or maintain a separate usage table
      return {
        used: userStorageUsage[userId] || 0,
        limit: FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES,
      };
    } catch (error) {
      console.error('S3 usage check failed:', error);
      throw new Error(`Failed to get usage: ${(error as Error).message}`);
    }
  }
}

class MinIOStorageService implements CloudStorageService {
  private client: S3Client;
  private bucketName: string;
  private endpoint: string;

  constructor() {
    this.bucketName = FEATURE_FLAGS.CLOUD_STORAGE_BUCKET;
    this.endpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
    
    this.client = new S3Client({
      region: 'us-east-1', // MinIO default
      endpoint: this.endpoint,
      forcePathStyle: true, // Required for MinIO
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || '',
        secretAccessKey: process.env.MINIO_SECRET_KEY || '',
      },
    });
  }

  private getFullPath(path: string, userId?: string): string {
    const userPrefix = userId ? `users/${userId}/` : '';
    return `${userPrefix}${path}`;
  }

  async upload(file: File, path: string, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      // Check quota before upload
      const currentUsage = await this.getUsage(userId || 'anonymous');
      if (currentUsage.used + file.size > currentUsage.limit) {
        throw new Error(`Storage limit exceeded. Max ${Math.round(currentUsage.limit / (1024 * 1024 * 1024))}GB per user.`);
      }

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
        Body: file,
        ContentType: file.type,
        Metadata: {
          userId: userId || 'anonymous',
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
        },
      });

      await this.client.send(command);
      
      // Update usage tracking
      if (userId) {
        userStorageUsage[userId] = (userStorageUsage[userId] || 0) + file.size;
      }

      return `${this.endpoint}/${this.bucketName}/${fullPath}`;
    } catch (error) {
      console.error('MinIO upload failed:', error);
      throw new Error(`Failed to upload file to MinIO: ${(error as Error).message}`);
    }
  }

  async download(path: string, userId?: string): Promise<Blob> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error('No file content received');
      }

      return response.Body as Blob;
    } catch (error) {
      console.error('MinIO download failed:', error);
      throw new Error(`Failed to download file from MinIO: ${(error as Error).message}`);
    }
  }

  async delete(path: string, userId?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      // Get file size before deletion for usage tracking
      if (userId) {
        try {
          const headCommand = new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: fullPath,
          });
          const headResponse = await this.client.send(headCommand);
          const fileSize = headResponse.ContentLength || 0;
          userStorageUsage[userId] = Math.max(0, (userStorageUsage[userId] || 0) - fileSize);
        } catch (e) {
          // File might not exist, continue with deletion
        }
      }

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('MinIO delete failed:', error);
      throw new Error(`Failed to delete file from MinIO: ${(error as Error).message}`);
    }
  }

  async list(prefix?: string, userId?: string): Promise<string[]> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPrefix = this.getFullPath(prefix || '', userId);
    
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: fullPrefix,
      });

      const response = await this.client.send(command);
      return (response.Contents || [])
        .map(obj => obj.Key?.replace(fullPrefix, '').replace(/^\//, ''))
        .filter(Boolean) as string[];
    } catch (error) {
      console.error('MinIO list failed:', error);
      throw new Error(`Failed to list files from MinIO: ${(error as Error).message}`);
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);
    
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      console.error('MinIO signed URL failed:', error);
      throw new Error(`Failed to generate signed URL: ${(error as Error).message}`);
    }
  }

  async getUsage(userId: string): Promise<{ used: number; limit: number }> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      // For MinIO, we'll use the in-memory tracking for now
      // In production, you'd query MinIO's storage metrics or maintain a separate usage table
      return {
        used: userStorageUsage[userId] || 0,
        limit: FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES,
      };
    } catch (error) {
      console.error('MinIO usage check failed:', error);
      throw new Error(`Failed to get usage: ${(error as Error).message}`);
    }
  }
}

/**
 * Storj Decentralized Storage Service
 *
 * S3-compatible client pointed at Storj's S3 gateway.
 * Storj is a decentralized cloud object storage with client-side encryption.
 * Uses the same @aws-sdk/client-s3 as S3/MinIO/R2 — just a different endpoint.
 *
 * Environment variables:
 *   STORJ_ACCESS_KEY   — Storj access grant or S3 credential access key
 *   STORJ_SECRET_KEY   — Storj secret key
 *   STORJ_ENDPOINT     — Storj S3 gateway (default: https://gateway.storjshare.io)
 *   STORJ_BUCKET       — Storj bucket name (falls back to CLOUD_STORAGE_BUCKET)
 */
class StorjStorageService implements CloudStorageService {
  private client: S3Client;
  private bucketName: string;
  private endpoint: string;

  constructor() {
    this.bucketName = FEATURE_FLAGS.STORJ_BUCKET || FEATURE_FLAGS.CLOUD_STORAGE_BUCKET;
    this.endpoint = FEATURE_FLAGS.STORJ_ENDPOINT;

    const accessKeyId = FEATURE_FLAGS.STORJ_ACCESS_KEY;
    const secretAccessKey = FEATURE_FLAGS.STORJ_SECRET_KEY;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Storj storage requires STORJ_ACCESS_KEY and STORJ_SECRET_KEY to be set');
    }

    if (!this.bucketName) {
      throw new Error('Storj storage requires either STORJ_BUCKET or CLOUD_STORAGE_BUCKET to be set');
    }

    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: this.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private getFullPath(path: string, userId?: string): string {
    const userPrefix = userId ? `users/${userId}/` : '';
    return `${userPrefix}${path}`;
  }

  async upload(file: File, path: string, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) throw new Error('Cloud storage is disabled');
    const fullPath = this.getFullPath(path, userId);
    try {
      const currentUsage = await this.getUsage(userId || 'anonymous');
      if (currentUsage.used + file.size > currentUsage.limit) {
        throw new Error(`Storage limit exceeded. Max ${Math.round(currentUsage.limit / (1024 * 1024 * 1024))}GB per user.`);
      }
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucketName, Key: fullPath, Body: file, ContentType: file.type,
        Metadata: { userId: userId || 'anonymous', originalName: file.name, uploadedAt: new Date().toISOString() },
      }));
      if (userId) userStorageUsage[userId] = (userStorageUsage[userId] || 0) + file.size;
      return `${this.endpoint}/${this.bucketName}/${fullPath}`;
    } catch (error) {
      console.error('Storj upload failed:', error);
      throw new Error(`Failed to upload file to Storj: ${(error as Error).message}`);
    }
  }

  async download(path: string, userId?: string): Promise<Blob> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) throw new Error('Cloud storage is disabled');
    const fullPath = this.getFullPath(path, userId);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: fullPath }));
      if (!response.Body) throw new Error('No file content received');
      return response.Body as Blob;
    } catch (error) {
      console.error('Storj download failed:', error);
      throw new Error(`Failed to download file from Storj: ${(error as Error).message}`);
    }
  }

  async delete(path: string, userId?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) throw new Error('Cloud storage is disabled');
    const fullPath = this.getFullPath(path, userId);
    try {
      if (userId) {
        try {
          const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: fullPath }));
          userStorageUsage[userId] = Math.max(0, (userStorageUsage[userId] || 0) - (head.ContentLength || 0));
        } catch { /* file may not exist */ }
      }
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: fullPath }));
    } catch (error) {
      console.error('Storj delete failed:', error);
      throw new Error(`Failed to delete file from Storj: ${(error as Error).message}`);
    }
  }

  async list(prefix?: string, userId?: string): Promise<string[]> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) throw new Error('Cloud storage is disabled');
    const fullPrefix = this.getFullPath(prefix || '', userId);
    try {
      const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucketName, Prefix: fullPrefix }));
      return (response.Contents || []).map(obj => obj.Key?.replace(fullPrefix, '').replace(/^\//, '')).filter(Boolean) as string[];
    } catch (error) {
      console.error('Storj list failed:', error);
      throw new Error(`Failed to list files from Storj: ${(error as Error).message}`);
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) throw new Error('Cloud storage is disabled');
    const fullPath = this.getFullPath(path, userId);
    try {
      return await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName, Key: fullPath }), { expiresIn });
    } catch (error) {
      console.error('Storj signed URL failed:', error);
      throw new Error(`Failed to generate signed URL for Storj: ${(error as Error).message}`);
    }
  }

  async getUsage(userId: string): Promise<{ used: number; limit: number }> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) throw new Error('Cloud storage is disabled');
    return { used: userStorageUsage[userId] || 0, limit: FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES };
  }
}

/**
 * Cloudflare R2 Storage Service
 *
 * S3-compatible client pointed at Cloudflare R2.
 * Uses the same @aws-sdk/client-s3 as S3StorageService/MinIOStorageService
 * but configured with R2-specific endpoint and credentials.
 *
 * Environment variables:
 *   R2_ACCESS_KEY_ID     — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret
 *   R2_ENDPOINT          — R2 endpoint (e.g., https://<account-id>.r2.cloudflarestorage.com)
 *   R2_BUCKET            — R2 bucket name (falls back to CLOUD_STORAGE_BUCKET)
 *   R2_PUBLIC_URL        — Optional public URL for direct file access
 */
class R2StorageService implements CloudStorageService {
  private client: S3Client;
  private bucketName: string;
  private endpoint: string;
  private publicUrl: string;

  constructor() {
    this.bucketName = FEATURE_FLAGS.R2_BUCKET || FEATURE_FLAGS.CLOUD_STORAGE_BUCKET;
    this.endpoint = FEATURE_FLAGS.R2_ENDPOINT;
    this.publicUrl = FEATURE_FLAGS.R2_PUBLIC_URL;

    const accessKeyId = FEATURE_FLAGS.R2_ACCESS_KEY_ID;
    const secretAccessKey = FEATURE_FLAGS.R2_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('R2 storage requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to be set');
    }

    if (!this.endpoint) {
      throw new Error('R2 storage requires R2_ENDPOINT to be set');
    }

    if (!this.bucketName) {
      throw new Error('R2 storage requires either R2_BUCKET or CLOUD_STORAGE_BUCKET to be set');
    }

    this.client = new S3Client({
      region: 'auto', // R2 doesn't use regions
      endpoint: this.endpoint,
      forcePathStyle: true, // Required for R2 (like MinIO)
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  private getFullPath(path: string, userId?: string): string {
    const userPrefix = userId ? `users/${userId}/` : '';
    return `${userPrefix}${path}`;
  }

  private getPublicUrl(fullPath: string): string {
    if (this.publicUrl) {
      const base = this.publicUrl.replace(/\/+$/, '');
      return `${base}/${fullPath}`;
    }
    return `${this.endpoint}/${this.bucketName}/${fullPath}`;
  }

  async upload(file: File, path: string, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);

    try {
      // Check quota before upload
      const currentUsage = await this.getUsage(userId || 'anonymous');
      if (currentUsage.used + file.size > currentUsage.limit) {
        throw new Error(`Storage limit exceeded. Max ${Math.round(currentUsage.limit / (1024 * 1024 * 1024))}GB per user.`);
      }

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
        Body: file,
        ContentType: file.type,
        Metadata: {
          userId: userId || 'anonymous',
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
        },
      });

      await this.client.send(command);

      // Update usage tracking
      if (userId) {
        userStorageUsage[userId] = (userStorageUsage[userId] || 0) + file.size;
      }

      return this.getPublicUrl(fullPath);
    } catch (error) {
      console.error('R2 upload failed:', error);
      throw new Error(`Failed to upload file to R2: ${(error as Error).message}`);
    }
  }

  async download(path: string, userId?: string): Promise<Blob> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error('No file content received');
      }

      return response.Body as Blob;
    } catch (error) {
      console.error('R2 download failed:', error);
      throw new Error(`Failed to download file from R2: ${(error as Error).message}`);
    }
  }

  async delete(path: string, userId?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);

    try {
      // Get file size before deletion for usage tracking
      if (userId) {
        try {
          const headCommand = new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: fullPath,
          });
          const headResponse = await this.client.send(headCommand);
          const fileSize = headResponse.ContentLength || 0;
          userStorageUsage[userId] = Math.max(0, (userStorageUsage[userId] || 0) - fileSize);
        } catch (e) {
          // File might not exist, continue with deletion
        }
      }

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('R2 delete failed:', error);
      throw new Error(`Failed to delete file from R2: ${(error as Error).message}`);
    }
  }

  async list(prefix?: string, userId?: string): Promise<string[]> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPrefix = this.getFullPath(prefix || '', userId);

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: fullPrefix,
      });

      const response = await this.client.send(command);
      return (response.Contents || [])
        .map(obj => obj.Key?.replace(fullPrefix, '').replace(/^\//, ''))
        .filter(Boolean) as string[];
    } catch (error) {
      console.error('R2 list failed:', error);
      throw new Error(`Failed to list files from R2: ${(error as Error).message}`);
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const fullPath = this.getFullPath(path, userId);

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      console.error('R2 signed URL failed:', error);
      throw new Error(`Failed to generate signed URL for R2: ${(error as Error).message}`);
    }
  }

  async getUsage(userId: string): Promise<{ used: number; limit: number }> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      return {
        used: userStorageUsage[userId] || 0,
        limit: FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES,
      };
    } catch (error) {
      console.error('R2 usage check failed:', error);
      throw new Error(`Failed to get usage: ${(error as Error).message}`);
    }
  }
}

// Keep the existing GCP mock service for development
class PCloudStorageService implements CloudStorageService {
  private clientId: string;
  private clientSecret: string;
  private apiHost: string;
  private redirectUri: string;
  // Per-user token cache: userId -> { accessToken, refreshToken, expiresAt }
  private tokenCache = new Map<string, { accessToken: string; refreshToken: string; expiresAt: number }>();
  // Per-user folder ID cache: userId -> root folderId (avoids repeated lookups)
  private folderCache = new Map<string, number>();

  constructor() {
    this.clientId = FEATURE_FLAGS.PCLOUD_CLIENT_ID;
    this.clientSecret = FEATURE_FLAGS.PCLOUD_CLIENT_SECRET;
    this.apiHost = FEATURE_FLAGS.PCLOUD_API_HOST;
    this.redirectUri = FEATURE_FLAGS.PCLOUD_REDIRECT_URI;

    if (!this.clientId || !this.clientSecret) {
      throw new Error('pCloud storage requires PCLOUD_CLIENT_ID and PCLOUD_CLIENT_SECRET to be set');
    }
  }

  private baseUrl(): string {
    return `https://${this.apiHost}`;
  }

  private async apiCall<T = any>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {},
    userId?: string,
    method: 'GET' | 'POST' = 'GET',
    body?: FormData
  ): Promise<T> {
    const url = new URL(`${this.baseUrl()}${endpoint}`);
    const accessToken = userId ? await this.getAccessToken(userId) : undefined;

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const fetchOptions: RequestInit = { method, headers };
    if (method === 'POST' && body) {
      // Don't set Content-Type — browser sets it with boundary for FormData
      fetchOptions.body = body;
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`pCloud API error ${response.status}: ${text}`);
    }

    const data = await response.json();

    // pCloud returns result: 0 for success
    if (data.result !== 0) {
      throw new Error(`pCloud API error: ${data.error || 'Unknown error'} (code ${data.result})`);
    }

    return data;
  }

  /**
   * Exchange an OAuth authorization code for tokens.
   * Called once during the OAuth callback flow.
   */
  async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
    const data = await this.apiCall<{
      access_token: string;
      refresh_token?: string;
      userid: number;
      expires_in?: number;
    }>('/oauth2_token', {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
    });

    const userId = String(data.userid);
    const refreshToken = data.refresh_token || '';

    this.tokenCache.set(userId, {
      accessToken: data.access_token,
      refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : Date.now() + 3600 * 1000,
    });

    return { accessToken: data.access_token, refreshToken, userId };
  }

  /**
   * Get the OAuth authorization URL for the user to visit.
   */
  getAuthorizationUrl(state?: string): string {
    const url = new URL('https://my.pcloud.com/oauth2/authorize');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('response_type', 'code');
    if (this.redirectUri) {
      url.searchParams.set('redirect_uri', this.redirectUri);
    }
    if (state) {
      url.searchParams.set('state', state);
    }
    return url.toString();
  }

  private async getAccessToken(userId: string): Promise<string> {
    const cached = this.tokenCache.get(userId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }

    // Try refresh if we have a refresh token
    if (cached?.refreshToken) {
      try {
        const data = await this.apiCall<{
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
        }>('/oauth2_token', {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: cached.refreshToken,
          grant_type: 'refresh_token',
        });

        this.tokenCache.set(userId, {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || cached.refreshToken,
          expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : Date.now() + 3600 * 1000,
        });

        return data.access_token;
      } catch {
        // Refresh failed — token cache entry is stale, will need re-auth
        this.tokenCache.delete(userId);
        throw new Error('pCloud token expired. Please re-authenticate.');
      }
    }

    throw new Error('No pCloud token available. Please authenticate first.');
  }

  /**
   * Store a token obtained externally (e.g., from DB after OAuth flow).
   */
  setToken(userId: string, accessToken: string, refreshToken?: string, expiresIn?: number): void {
    this.tokenCache.set(userId, {
      accessToken,
      refreshToken: refreshToken || '',
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : Date.now() + 3600 * 1000,
    });
  }

  /**
   * Resolve a file/folder path to a pCloud folder ID.
   * pCloud uses integer IDs, not paths — we walk the tree to resolve.
   */
  private async resolveFolder(path: string, userId: string): Promise<number> {
    const cacheKey = `${userId}:${path}`;
    if (this.folderCache.has(cacheKey)) {
      return this.folderCache.get(cacheKey)!;
    }

    // Start from root (folderId 0)
    let folderId = 0;

    if (path && path !== '/' && path !== '') {
      const parts = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/');

      for (const part of parts) {
        const data = await this.apiCall<{
          metadata: { contents: Array<{ id: number; name: string; folder: boolean; isfolder: boolean }> };
        }>('/listfolder', { folderid: folderId }, userId);

        const found = data.metadata?.contents?.find(
          (item) => item.name === part && (item.folder || item.isfolder)
        );

        if (!found) {
          // Create the folder if it doesn't exist
          const createData = await this.apiCall<{ metadata: { folderid: number } }>(
            '/createfolderifnotexists',
            { folderid: folderId, name: part },
            userId
          );
          folderId = createData.metadata?.folderid || 0;
        } else {
          folderId = found.id;
        }
      }
    }

    this.folderCache.set(cacheKey, folderId);
    return folderId;
  }

  /**
   * Find a file by name in a folder and return its pCloud file ID.
   */
  private async resolveFile(folderId: number, fileName: string, userId: string): Promise<number | null> {
    const data = await this.apiCall<{
      metadata: { contents: Array<{ id: number; name: string; folder: boolean; isfolder: boolean }> };
    }>('/listfolder', { folderid: folderId }, userId);

    const file = data.metadata?.contents?.find(
      (item) => item.name === fileName && !item.folder && !item.isfolder
    );

    return file?.id ?? null;
  }

  // ─── CloudStorageService Implementation ──────────────────────────

  async upload(file: File, path: string, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }
    if (!userId) {
      throw new Error('pCloud requires a userId for token management');
    }

    try {
      const currentUsage = await this.getUsage(userId);
      if (currentUsage.used + file.size > currentUsage.limit) {
        throw new Error(`Storage limit exceeded. Max ${Math.round(currentUsage.limit / (1024 * 1024 * 1024))}GB per user.`);
      }

      // Resolve parent folder
      const parts = path.split('/');
      const fileName = parts.pop() || 'untitled';
      const folderPath = parts.join('/') || '';
      const folderId = await this.resolveFolder(folderPath, userId);

      // Upload via multipart
      const formData = new FormData();
      formData.append('folderid', String(folderId));
      formData.append('file', file, fileName);

      const data = await this.apiCall<{ metadata: Array<{ id: number; name: string }> }>(
        '/uploadfile',
        {},
        userId,
        'POST',
        formData
      );

      // Update usage tracking
      userStorageUsage[userId] = (userStorageUsage[userId] || 0) + file.size;

      const fileId = data.metadata?.[0]?.id;
      return fileId ? `pcloud://${userId}/${fileId}/${fileName}` : `pcloud://${userId}/unknown/${fileName}`;
    } catch (error) {
      console.error('pCloud upload failed:', error);
      throw new Error(`Failed to upload file to pCloud: ${(error as Error).message}`);
    }
  }

  async download(path: string, userId?: string): Promise<Blob> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }
    if (!userId) {
      throw new Error('pCloud requires a userId for token management');
    }

    try {
      // Resolve file ID from path
      const parts = path.split('/');
      const fileName = parts.pop() || '';
      const folderPath = parts.join('/') || '';
      const folderId = await this.resolveFolder(folderPath, userId);
      const fileId = await this.resolveFile(folderId, fileName, userId);

      if (!fileId) {
        throw new Error(`File not found: ${path}`);
      }

      // Get download link
      const linkData = await this.apiCall<{ hosts: string[]; path: string }>(
        '/getfilelink',
        { fileid: fileId },
        userId
      );

      const host = linkData.hosts?.[0] || this.apiHost;
      const downloadUrl = `https://${host}${linkData.path}`;

      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('pCloud download failed:', error);
      throw new Error(`Failed to download file from pCloud: ${(error as Error).message}`);
    }
  }

  async delete(path: string, userId?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }
    if (!userId) {
      throw new Error('pCloud requires a userId for token management');
    }

    try {
      const parts = path.split('/');
      const fileName = parts.pop() || '';
      const folderPath = parts.join('/') || '';
      const folderId = await this.resolveFolder(folderPath, userId);
      const fileId = await this.resolveFile(folderId, fileName, userId);

      if (!fileId) {
        throw new Error(`File not found: ${path}`);
      }

      await this.apiCall('/deletefile', { fileid: fileId }, userId);

      // Invalidate folder cache for the parent
      this.folderCache.delete(`${userId}:${folderPath}`);

      // Update usage tracking (approximate — pCloud reports actual usage via userinfo)
      const usage = await this.getUsage(userId);
      userStorageUsage[userId] = usage.used;
    } catch (error) {
      console.error('pCloud delete failed:', error);
      throw new Error(`Failed to delete file from pCloud: ${(error as Error).message}`);
    }
  }

  async list(prefix?: string, userId?: string): Promise<string[]> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }
    if (!userId) {
      throw new Error('pCloud requires a userId for token management');
    }

    try {
      const folderId = await this.resolveFolder(prefix || '', userId);
      const data = await this.apiCall<{
        metadata: { contents: Array<{ name: string; folder: boolean; isfolder: boolean }> };
      }>('/listfolder', { folderid: folderId }, userId);

      return (data.metadata?.contents || [])
        .filter((item) => !item.folder && !item.isfolder)
        .map((item) => item.name);
    } catch (error) {
      console.error('pCloud list failed:', error);
      throw new Error(`Failed to list files from pCloud: ${(error as Error).message}`);
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }
    if (!userId) {
      throw new Error('pCloud requires a userId for token management');
    }

    try {
      const parts = path.split('/');
      const fileName = parts.pop() || '';
      const folderPath = parts.join('/') || '';
      const folderId = await this.resolveFolder(folderPath, userId);
      const fileId = await this.resolveFile(folderId, fileName, userId);

      if (!fileId) {
        throw new Error(`File not found: ${path}`);
      }

      // pCloud getfilelink provides temporary download URLs
      const linkData = await this.apiCall<{ hosts: string[]; path: string }>(
        '/getfilelink',
        { fileid: fileId },
        userId
      );

      const host = linkData.hosts?.[0] || this.apiHost;
      return `https://${host}${linkData.path}`;
    } catch (error) {
      console.error('pCloud signed URL failed:', error);
      throw new Error(`Failed to generate pCloud download URL: ${(error as Error).message}`);
    }
  }

  async getUsage(userId: string): Promise<{ used: number; limit: number }> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const data = await this.apiCall<{ usedquota: number; quota: number }>('/userinfo', {}, userId);
      const used = data.usedquota || userStorageUsage[userId] || 0;
      const limit = data.quota || FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES;

      // Sync in-memory tracking
      userStorageUsage[userId] = used;

      return { used, limit };
    } catch (error) {
      console.error('pCloud usage check failed:', error);
      // Fall back to in-memory tracking
      return {
        used: userStorageUsage[userId] || 0,
        limit: FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES,
      };
    }
  }
}

class GCPStorageService implements CloudStorageService {
  private bucketName: string;

  constructor() {
    this.bucketName = FEATURE_FLAGS.CLOUD_STORAGE_BUCKET;
  }

  private getFullPath(path: string, userId?: string): string {
    const userPrefix = userId ? `users/${userId}/` : '';
    return `${userPrefix}${path}`;
  }

  async upload(file: File, path: string, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    const currentUsage = userStorageUsage[userId || 'anonymous'] || 0;
    if (currentUsage + file.size > FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES) {
      throw new Error(`Storage limit exceeded. Max 5GB per user.`);
    }

    try {
      const fullPath = this.getFullPath(path, userId);
      const mockUrl = `https://storage.googleapis.com/${this.bucketName}/${fullPath}`;

      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        console.log(`[DEV] Would upload ${file.name} to ${mockUrl}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        userStorageUsage[userId || 'anonymous'] = currentUsage + file.size;
      }
      return mockUrl;
    } catch (error) {
      console.error('Upload failed:', error);
      throw new Error(`Failed to upload file to cloud storage: ${(error as Error).message}`);
    }
  }

  async download(path: string, userId?: string): Promise<Blob> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const fullPath = this.getFullPath(path, userId);
      
      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        // Return mock content for development
        const mockContent = `// Mock file content for ${fullPath}\n// This is a development placeholder`;
        return new Blob([mockContent], { type: 'text/plain' });
      }
      
      throw new Error('Download not implemented in production');
    } catch (error) {
      console.error('Download failed:', error);
      throw new Error(`Failed to download file from cloud storage: ${(error as Error).message}`);
    }
  }

  async delete(path: string, userId?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const fullPath = this.getFullPath(path, userId);
      
      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        console.log(`[DEV] Would delete ${fullPath}`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error('Delete failed:', error);
      throw new Error(`Failed to delete file from cloud storage: ${(error as Error).message}`);
    }
  }

  async list(prefix?: string, userId?: string): Promise<string[]> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const fullPrefix = this.getFullPath(prefix || '', userId);
      
      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        // Return mock files for development
        return [
          'example.js',
          'styles.css',
          'README.md',
          'package.json'
        ];
      }
      
      throw new Error('List not implemented in production');
    } catch (error) {
      console.error('List failed:', error);
      throw new Error(`Failed to list files from cloud storage: ${(error as Error).message}`);
    }
  }

  async getSignedUrl(path: string, expiresIn?: number, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const fullPath = this.getFullPath(path, userId);
      return `https://storage.googleapis.com/${this.bucketName}/${fullPath}?mock=true`;
    } catch (error) {
      console.error('Signed URL failed:', error);
      throw new Error(`Failed to generate signed URL: ${(error as Error).message}`);
    }
  }

  async getUsage(userId: string): Promise<{ used: number; limit: number }> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }
    
    if (FEATURE_FLAGS.IS_DEVELOPMENT) {
      return {
        used: userStorageUsage[userId] || 0,
        limit: FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES,
      };
    }
    throw new Error('Usage tracking not implemented in production');
  }
}

export function createCloudStorageService(): CloudStorageService {
  if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
    throw new Error('Cloud storage is disabled');
  }

  const provider = FEATURE_FLAGS.CLOUD_STORAGE_PROVIDER as string;

  switch (provider) {
    case 'nextcloud' as any:
      return new NextcloudStorageService();
    case 's3' as any:
      return new S3StorageService();
    case 'minio' as any:
      return new MinIOStorageService();
    case 'r2' as any:
      return new R2StorageService();
    case 'pcloud' as any:
      return new PCloudStorageService();
    case 'storj' as any:
      return new StorjStorageService();
    case 'gcp' as any:
    default:
      return new GCPStorageService() as any;
  }
}

// Default instance - lazy initialized to avoid throwing at import time during SSG builds
let _cloudStorageInstance: CloudStorageService | null = null;
export const cloudStorage = new Proxy({} as CloudStorageService, {
  get(_target, prop) {
    if (!_cloudStorageInstance) {
      _cloudStorageInstance = createCloudStorageService();
    }
    return (_cloudStorageInstance as any)[prop];
  },
});

// Export individual services for testing
export { NextcloudStorageService, S3StorageService, MinIOStorageService, R2StorageService, PCloudStorageService, StorjStorageService, GCPStorageService };
