/**
 * Phase 3: Object Storage Integration
 * 
 * Large file persistence via provider object storage:
 * - Upload/download large files
 * - Persistent storage across sessions
 * - S3-compatible API
 * - Automatic cleanup
 * 
 * Supported via:
 * - Daytona Object Storage (native)
 * - Provider-agnostic storage abstraction
 * 
 * @example
 * ```typescript
 * import { objectStorageIntegration } from '@/lib/sandbox/phase3-integration';
 * 
 * // Upload large file
 * const result = await objectStorageIntegration.uploadFile(sandboxId, {
 *   localPath: '/workspace/data/model.pkl',
 *   storageKey: 'my-project/model.pkl',
 * });
 * 
 * // Download file
 * await objectStorageIntegration.downloadFile(sandboxId, {
 *   storageKey: 'my-project/model.pkl',
 *   localPath: '/workspace/data/model-restored.pkl',
 * });
 * 
 * // List stored files
 * const files = await objectStorageIntegration.listFiles(sandboxId, 'my-project/');
 * ```
 */

import { getSandboxProvider, type SandboxProviderType } from '../sandbox/providers';
import { createLogger } from '../utils/logger';

const logger = createLogger('Phase3:ObjectStorage');

/**
 * File upload result
 */
export interface UploadResult {
  success: boolean;
  storageKey: string;
  size?: number;
  url?: string;
  error?: string;
}

/**
 * File download result
 */
export interface DownloadResult {
  success: boolean;
  localPath: string;
  size?: number;
  error?: string;
}

/**
 * Stored file info
 */
export interface StoredFile {
  key: string;
  size: number;
  lastModified: string;
  contentType?: string;
}

/**
 * Object Storage Integration
 */
export class ObjectStorageIntegration {
  /**
   * Upload file to object storage
   */
  async uploadFile(
    sandboxId: string,
    options: { localPath: string; storageKey: string; contentType?: string }
  ): Promise<UploadResult> {
    try {
      const provider = await getSandboxProvider(this.inferProviderType(sandboxId));
      const handle = await provider.getSandbox(sandboxId);

      // Try Daytona Object Storage service first
      const storageService = (handle as any).getObjectStorageService?.();
      if (storageService) {
        const result = await (storageService as any).upload({
          key: options.storageKey,
          content: await (handle as any).readFile(options.localPath),
        });

        return {
          success: true,
          storageKey: options.storageKey,
          size: (result as any).size,
          url: (result as any).url,
        };
      }

      // Fallback: Use provider's native upload if available
      if ((handle as any).uploadToStorage) {
        const result = await (handle as any).uploadToStorage(options.localPath, options.storageKey);

        return {
          success: true,
          storageKey: options.storageKey,
          size: (result as any).size,
          url: (result as any).url,
        };
      }
      
      // Fallback: Return error - storage not available
      return {
        success: false,
        storageKey: options.storageKey,
        error: 'Object storage not available on this provider',
      };
    } catch (error: any) {
      logger.error('Upload failed:', error);
      return {
        success: false,
        storageKey: options.storageKey,
        error: error?.message || 'Upload failed',
      };
    }
  }
  
  /**
   * Download file from object storage
   */
  async downloadFile(
    sandboxId: string,
    options: { storageKey: string; localPath: string }
  ): Promise<DownloadResult> {
    try {
      const provider = await getSandboxProvider(this.inferProviderType(sandboxId));
      const handle = await provider.getSandbox(sandboxId);
      
      // Try Daytona Object Storage service
      const storageService = (handle as any).getObjectStorageService?.();
      if (storageService) {
        const result = await (storageService as any).download(options.storageKey, options.localPath);
        
        return {
          success: true,
          localPath: options.localPath,
          size: result.size,
        };
      }
      
      // Fallback: Use provider's native download
      // @ts-ignore - downloadFromStorage may not exist on all sandbox implementations
      if ((handle as any).downloadFromStorage) {
        const result = await (handle as any).downloadFromStorage(options.storageKey, options.localPath);
        
        return {
          success: true,
          localPath: options.localPath,
          size: result.size,
        };
      }
      
      return {
        success: false,
        localPath: options.localPath,
        error: 'Object storage not available on this provider',
      };
    } catch (error: any) {
      logger.error('Download failed:', error);
      return {
        success: false,
        localPath: options.localPath,
        error: error?.message || 'Download failed',
      };
    }
  }
  
  /**
   * List stored files
   */
  async listFiles(
    sandboxId: string,
    prefix?: string
  ): Promise<StoredFile[]> {
    try {
      const provider = await getSandboxProvider(this.inferProviderType(sandboxId));
      const handle = await provider.getSandbox(sandboxId);
      
      const storageService = (handle as any).getObjectStorageService?.();
      if (storageService) {
        const result = await (storageService as any).list(prefix);
        
        return result.files?.map((f: any) => ({
          key: f.key,
          size: f.size,
          lastModified: f.lastModified,
          contentType: f.contentType,
        })) || [];
      }
      
      return [];
    } catch (error: any) {
      logger.error('List files failed:', error);
      return [];
    }
  }
  
  /**
   * Delete stored file
   */
  async deleteFile(
    sandboxId: string,
    storageKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const provider = await getSandboxProvider(this.inferProviderType(sandboxId));
      const handle = await provider.getSandbox(sandboxId);
      
      const storageService = (handle as any).getObjectStorageService?.();
      if (storageService) {
        await (storageService as any).delete(storageKey);
        return { success: true };
      }
      
      return {
        success: false,
        error: 'Object storage not available',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Delete failed',
      };
    }
  }
  
  /**
   * Get storage URL for file
   */
  async getStorageUrl(
    sandboxId: string,
    storageKey: string
  ): Promise<{ url?: string; error?: string }> {
    try {
      const provider = await getSandboxProvider(this.inferProviderType(sandboxId));
      const handle = await provider.getSandbox(sandboxId);
      
      const storageService = (handle as any).getObjectStorageService?.();
      if (storageService) {
        const url = await (storageService as any).getUrl(storageKey);
        return { url };
      }
      
      return { error: 'Object storage not available' };
    } catch (error: any) {
      return { error: error?.message || 'Failed to get URL' };
    }
  }
  
  /**
   * Check if provider supports object storage
   */
  isStorageSupported(providerType: SandboxProviderType): boolean {
    // Daytona has native object storage
    return providerType === 'daytona';
  }
  
  /**
   * Infer provider type from sandbox ID
   */
  private inferProviderType(sandboxId: string): SandboxProviderType {
    if (sandboxId.startsWith('daytona-') || sandboxId.startsWith('dt-')) return 'daytona';
    if (sandboxId.startsWith('mistral-')) return 'mistral';
    if (sandboxId.startsWith('blaxel-')) return 'blaxel';
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites';
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer';
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox';
    if (sandboxId.startsWith('e2b-')) return 'e2b';
    return 'daytona';
  }
}

/**
 * Singleton instance
 */
export const objectStorageIntegration = new ObjectStorageIntegration();

/**
 * Convenience functions
 */
export const uploadFile = (sandboxId: string, options: { localPath: string; storageKey: string }) =>
  objectStorageIntegration.uploadFile(sandboxId, options);

export const downloadFile = (sandboxId: string, options: { storageKey: string; localPath: string }) =>
  objectStorageIntegration.downloadFile(sandboxId, options);

export const listFiles = (sandboxId: string, prefix?: string) =>
  objectStorageIntegration.listFiles(sandboxId, prefix);

export const deleteFile = (sandboxId: string, storageKey: string) =>
  objectStorageIntegration.deleteFile(sandboxId, storageKey);

export const getStorageUrl = (sandboxId: string, storageKey: string) =>
  objectStorageIntegration.getStorageUrl(sandboxId, storageKey);

export const isStorageSupported = (providerType: SandboxProviderType) =>
  objectStorageIntegration.isStorageSupported(providerType);
