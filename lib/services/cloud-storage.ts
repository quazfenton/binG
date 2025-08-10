import { FEATURE_FLAGS, CloudStorageService } from '../../config/features';

export interface CloudUsageRecord {
  userId: string;
  usedBytes: number;
}

const inMemoryUsage: Record<string, number> = {};

const getUserPrefix = (userId: string) => `users/${userId}/`;

const assertQuota = (userId: string, incomingBytes: number) => {
  const used = inMemoryUsage[userId] || 0;
  const limit = FEATURE_FLAGS.CLOUD_STORAGE_PER_USER_LIMIT_BYTES;
  if (used + incomingBytes > limit) {
    throw new Error('Storage quota exceeded (5GB per account)');
  }
};

class GCPStorageService implements CloudStorageService {
  private bucketName: string;
  
  constructor() {
    this.bucketName = FEATURE_FLAGS.CLOUD_STORAGE_BUCKET;
  }

  async upload(file: File, path: string, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    // Check file size
    if (file.size > FEATURE_FLAGS.CLOUD_STORAGE_MAX_SIZE) {
      throw new Error('File size exceeds 5GB limit');
    }

    try {
      if (userId) {
        assertQuota(userId, file.size);
      }

      const namespacedPath = userId ? `${getUserPrefix(userId)}${path}` : path;
      // In production, this would use Google Cloud Storage SDK
      // For now, return a mock URL
      const mockUrl = `https://storage.googleapis.com/${this.bucketName}/${namespacedPath}`;
      
      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        console.log(`[DEV] Would upload ${file.name} to ${mockUrl}`);
        // Simulate upload delay
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (userId) {
        inMemoryUsage[userId] = (inMemoryUsage[userId] || 0) + file.size;
      }

      return mockUrl;
    } catch (error) {
      console.error('Upload failed:', error);
      throw new Error('Failed to upload file to cloud storage');
    }
  }

  async download(path: string, userId?: string): Promise<Blob> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const namespacedPath = userId ? `${getUserPrefix(userId)}${path}` : path;
      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        console.log(`[DEV] Would download from ${namespacedPath}`);
        // Return mock blob
        return new Blob(['Mock file content'], { type: 'text/plain' });
      }
      
      // In production, implement actual GCS download
      throw new Error('Download not implemented in production');
    } catch (error) {
      console.error('Download failed:', error);
      throw new Error('Failed to download file from cloud storage');
    }
  }

  async delete(path: string, userId?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const namespacedPath = userId ? `${getUserPrefix(userId)}${path}` : path;
      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        console.log(`[DEV] Would delete ${namespacedPath}`);
        return;
      }
      
      // In production, implement actual GCS delete
    } catch (error) {
      console.error('Delete failed:', error);
      throw new Error('Failed to delete file from cloud storage');
    }
  }

  async list(prefix?: string, userId?: string): Promise<string[]> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const namespacedPrefix = userId ? `${getUserPrefix(userId)}${prefix || ''}` : prefix || '';
      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        console.log(`[DEV] Would list files with prefix: ${namespacedPrefix}`);
        // Return a mocked namespaced listing
        return [
          `${namespacedPrefix}file1.txt`,
          `${namespacedPrefix}file2.js`,
          `${namespacedPrefix}folder/file3.css`
        ];
      }
      
      // In production, implement actual GCS list
      return [];
    } catch (error) {
      console.error('List failed:', error);
      throw new Error('Failed to list files from cloud storage');
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600, userId?: string): Promise<string> {
    if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
      throw new Error('Cloud storage is disabled');
    }

    try {
      const namespacedPath = userId ? `${getUserPrefix(userId)}${path}` : path;
      if (FEATURE_FLAGS.IS_DEVELOPMENT) {
        console.log(`[DEV] Would generate signed URL for ${namespacedPath}, expires in ${expiresIn}s`);
        return `https://storage.googleapis.com/${this.bucketName}/${namespacedPath}?signed=true&expires=${Date.now() + expiresIn * 1000}`;
      }
      
      // In production, implement actual signed URL generation
      throw new Error('Signed URL generation not implemented in production');
    } catch (error) {
      console.error('Signed URL generation failed:', error);
      throw new Error('Failed to generate signed URL');
    }
  }
}

// Factory function to create storage service based on provider
export const createCloudStorageService = (): CloudStorageService => {
  if (!FEATURE_FLAGS.ENABLE_CLOUD_STORAGE) {
    throw new Error('Cloud storage is disabled in configuration');
  }

  switch (FEATURE_FLAGS.CLOUD_STORAGE_PROVIDER) {
    case 'gcp':
      return new GCPStorageService();
    case 'aws':
    case 's3':
      // TODO: Implement AWS S3 service
      throw new Error('AWS S3 storage not yet implemented');
    case 'azure':
      // TODO: Implement Azure Blob storage
      throw new Error('Azure Blob storage not yet implemented');
    case 'minio':
      // TODO: Implement MinIO storage for self-hosting
      throw new Error('MinIO storage not yet implemented');
    default:
      throw new Error(`Unsupported storage provider: ${FEATURE_FLAGS.CLOUD_STORAGE_PROVIDER}`);
  }
};

// Export singleton instance
export const cloudStorage = FEATURE_FLAGS.ENABLE_CLOUD_STORAGE 
  ? createCloudStorageService() 
  : null;