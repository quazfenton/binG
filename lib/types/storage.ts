/**
 * Storage API Types
 * 
 * Standardized response types for all storage endpoints.
 * Ensures consistent API responses across all storage operations.
 */

/**
 * Standard storage response structure
 */
export interface StorageResponse<T = any> {
  success: boolean;
  data?: T;
  error?: StorageError;
  meta?: {
    timestamp: string;
    requestId: string;
    userId?: string;
  };
}

/**
 * Storage error structure
 */
export interface StorageError {
  code: string;
  message: string;
  details?: any;
  retryable?: boolean;
}

/**
 * Upload response data
 */
export interface UploadData {
  url: string;
  key: string;
  path: string;
  size: number;
  contentType?: string;
  uploadedAt: string;
}

/**
 * Download response data
 */
export interface DownloadData {
  url: string;
  key: string;
  path: string;
  size: number;
  contentType?: string;
  expiresAt?: string;
}

/**
 * List response data
 */
export interface ListData {
  files: FileInfo[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * File information
 */
export interface FileInfo {
  key: string;
  path: string;
  size: number;
  lastModified: string;
  contentType?: string;
  etag?: string;
}

/**
 * Delete response data
 */
export interface DeleteData {
  deleted: boolean;
  key: string;
  path: string;
  deletedAt: string;
}

/**
 * Usage response data
 */
export interface UsageData {
  used: number;
  limit: number;
  available: number;
  percentUsed: number;
  files: number;
}

/**
 * Signed URL response data
 */
export interface SignedUrlData {
  url: string;
  key: string;
  path: string;
  expiresAt: string;
  expiresIn: number;
}

/**
 * Storage quota information
 */
export interface StorageQuota {
  maxFileSize: number;        // bytes
  maxTotalSize: number;       // bytes
  maxFiles: number;
  allowedTypes: string[];     // MIME types
}

/**
 * Error codes for storage operations
 */
export const STORAGE_ERROR_CODES = {
  // Authentication/Authorization
  UNAUTHORIZED: 'STORAGE_UNAUTHORIZED',
  FORBIDDEN: 'STORAGE_FORBIDDEN',
  
  // File errors
  FILE_NOT_FOUND: 'STORAGE_FILE_NOT_FOUND',
  FILE_TOO_LARGE: 'STORAGE_FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'STORAGE_INVALID_FILE_TYPE',
  FILE_ALREADY_EXISTS: 'STORAGE_FILE_ALREADY_EXISTS',
  
  // Quota errors
  QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  QUOTA_LIMIT_REACHED: 'STORAGE_QUOTA_LIMIT_REACHED',
  
  // Operation errors
  UPLOAD_FAILED: 'STORAGE_UPLOAD_FAILED',
  DOWNLOAD_FAILED: 'STORAGE_DOWNLOAD_FAILED',
  DELETE_FAILED: 'STORAGE_DELETE_FAILED',
  LIST_FAILED: 'STORAGE_LIST_FAILED',
  
  // Configuration errors
  STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
  INVALID_PATH: 'STORAGE_INVALID_PATH',
  INVALID_PARAMETERS: 'STORAGE_INVALID_PARAMETERS',
  
  // System errors
  INTERNAL_ERROR: 'STORAGE_INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'STORAGE_SERVICE_UNAVAILABLE',
  TIMEOUT: 'STORAGE_TIMEOUT',
} as const;

/**
 * Create a storage error object
 */
export function createStorageError(
  code: keyof typeof STORAGE_ERROR_CODES,
  message: string,
  options?: {
    details?: any;
    retryable?: boolean;
  }
): StorageError {
  return {
    code: STORAGE_ERROR_CODES[code],
    message,
    details: options?.details,
    retryable: options?.retryable ?? false,
  };
}

/**
 * Create a success response
 */
export function createSuccessResponse<T>(
  data: T,
  options?: {
    userId?: string;
    requestId?: string;
  }
): StorageResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: options?.requestId || crypto.randomUUID(),
      userId: options?.userId,
    },
  };
}

/**
 * Create an error response
 */
export function createErrorResponse(
  error: StorageError,
  options?: {
    userId?: string;
    requestId?: string;
  }
): StorageResponse<never> {
  return {
    success: false,
    error,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: options?.requestId || crypto.randomUUID(),
      userId: options?.userId,
    },
  };
}

/**
 * Convert error to storage error
 */
export function toStorageError(error: unknown): StorageError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Map common errors to storage error codes
    if (message.includes('unauthorized') || message.includes('auth')) {
      return createStorageError('UNAUTHORIZED', error.message);
    }
    if (message.includes('not found')) {
      return createStorageError('FILE_NOT_FOUND', error.message);
    }
    if (message.includes('quota') || message.includes('limit')) {
      return createStorageError('QUOTA_EXCEEDED', error.message);
    }
    if (message.includes('timeout')) {
      return createStorageError('TIMEOUT', error.message, { retryable: true });
    }
    
    // Default internal error
    return createStorageError('INTERNAL_ERROR', error.message);
  }
  
  // Unknown error
  return createStorageError('INTERNAL_ERROR', 'An unknown error occurred');
}
