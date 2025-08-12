import { FEATURE_FLAGS } from '@/config/features';
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

// Keep the existing GCP mock service for development
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

  const provider = FEATURE_FLAGS.CLOUD_STORAGE_PROVIDER;

  switch (provider) {
    case 'nextcloud':
      return new NextcloudStorageService();
    case 's3':
      return new S3StorageService();
    case 'minio':
      return new MinIOStorageService();
    case 'gcp':
    default:
      return new GCPStorageService();
  }
}

// Export individual services for testing
export { NextcloudStorageService, S3StorageService, MinIOStorageService, GCPStorageService };