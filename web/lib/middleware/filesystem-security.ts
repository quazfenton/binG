/**
 * Filesystem Security Middleware
 *
 * Provides security validation for filesystem operations.
 * Prevents path traversal, unauthorized access, and other filesystem attacks.
 *
 * Features:
 * - Path validation and normalization
 * - Path traversal prevention
 * - File type validation
 * - Size limit enforcement
 * - Permission checking
 *
 * @see docs/sdk/filesystem-security.md
 */

import { z } from 'zod';
import { resolve, relative, normalize } from 'path';

/**
 * Filesystem operation types
 */
export type FilesystemOperation = 'read' | 'write' | 'delete' | 'list' | 'move' | 'copy';

/**
 * Filesystem validation result
 */
export interface FilesystemValidationResult {
  valid: boolean;
  normalizedPath?: string;
  error?: {
    type: string;
    message: string;
    code?: string;
  };
}

/**
 * Filesystem configuration
 */
export interface FilesystemConfig {
  /** Base directory for all operations */
  baseDir: string;
  /** Maximum file size in bytes */
  maxFileSize: number;
  /** Allowed file extensions */
  allowedExtensions: string[];
  /** Denied path patterns */
  deniedPatterns: RegExp[];
  /** Enable path validation */
  enablePathValidation: boolean;
  /** Enable file type validation */
  enableFileTypeValidation: boolean;
  /** Enable size limits */
  enableSizeLimits: boolean;
}

/**
 * Default filesystem configuration
 */
export const DEFAULT_FILESYSTEM_CONFIG: FilesystemConfig = {
  baseDir: process.env.WORKSPACE_DIR || '/workspace',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10), // 100MB
  allowedExtensions: ['*', '.ts', '.js', '.tsx', '.jsx', '.json', '.md', '.txt', '.html', '.css', '.py', '.go', '.rs', '.java'],
  deniedPatterns: [
    /\.env(\..+)?$/,
    /\.git\/.*/,
    /\.ssh\/.*/,
    /\/etc\/.*/,
    /\/proc\/.*/,
    /\/sys\/.*/,
    /node_modules\/.*/,
  ],
  enablePathValidation: true,
  enableFileTypeValidation: true,
  enableSizeLimits: true,
};

/**
 * Validate and normalize path
 *
 * @param path - Path to validate
 * @param config - Filesystem configuration
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validatePath('../etc/passwd');
 * if (!result.valid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 });
 * }
 * ```
 */
export function validatePath(
  path: string,
  config: FilesystemConfig = DEFAULT_FILESYSTEM_CONFIG
): FilesystemValidationResult {
  if (!config.enablePathValidation) {
    return { valid: true, normalizedPath: path };
  }

  // Check for null bytes
  if (path.includes('\0')) {
    return {
      valid: false,
      error: {
        type: 'path_validation_error',
        message: 'Path contains null bytes',
        code: 'INVALID_PATH_NULL_BYTE',
      },
    };
  }

  // Normalize path separators
  const normalizedPath = path.replace(/\\/g, '/');

  // Check for path traversal attempts
  if (normalizedPath.includes('..')) {
    return {
      valid: false,
      error: {
        type: 'path_validation_error',
        message: 'Path traversal detected: ".." is not allowed',
        code: 'PATH_TRAVERSAL_DETECTED',
      },
    };
  }

  // Check for absolute paths
  if (normalizedPath.startsWith('/') || normalizedPath.startsWith('\\')) {
    return {
      valid: false,
      error: {
        type: 'path_validation_error',
        message: 'Absolute paths are not allowed',
        code: 'ABSOLUTE_PATH_DETECTED',
      },
    };
  }

  // Check for denied patterns
  for (const pattern of config.deniedPatterns) {
    if (pattern.test(normalizedPath)) {
      return {
        valid: false,
        error: {
          type: 'path_validation_error',
          message: `Access to this path is denied: ${normalizedPath}`,
          code: 'PATH_ACCESS_DENIED',
        },
      };
    }
  }

  // Resolve and validate path stays within base directory
  const resolvedPath = resolve(config.baseDir, normalizedPath);
  const relativePath = relative(config.baseDir, resolvedPath);

  // Ensure path doesn't escape base directory
  if (relativePath.startsWith('..') || resolvedPath === '..' || resolve(config.baseDir, relativePath) !== resolvedPath) {
    return {
      valid: false,
      error: {
        type: 'path_validation_error',
        message: 'Path escapes base directory',
        code: 'PATH_ESCAPE_DETECTED',
      },
    };
  }

  return {
    valid: true,
    normalizedPath: resolvedPath,
  };
}

/**
 * Validate file extension
 *
 * @param path - File path
 * @param config - Filesystem configuration
 * @returns Validation result
 */
export function validateFileExtension(
  path: string,
  config: FilesystemConfig = DEFAULT_FILESYSTEM_CONFIG
): FilesystemValidationResult {
  if (!config.enableFileTypeValidation) {
    return { valid: true };
  }

  const ext = '.' + path.split('.').pop()?.toLowerCase();

  if (!config.allowedExtensions.includes('*') && !config.allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: {
        type: 'file_type_error',
        message: `File extension "${ext}" is not allowed`,
        code: 'FILE_EXTENSION_NOT_ALLOWED',
      },
    };
  }

  return { valid: true };
}

/**
 * Validate file size
 *
 * @param size - File size in bytes
 * @param config - Filesystem configuration
 * @returns Validation result
 */
export function validateFileSize(
  size: number,
  config: FilesystemConfig = DEFAULT_FILESYSTEM_CONFIG
): FilesystemValidationResult {
  if (!config.enableSizeLimits) {
    return { valid: true };
  }

  if (size > config.maxFileSize) {
    return {
      valid: false,
      error: {
        type: 'file_size_error',
        message: `File size (${size} bytes) exceeds maximum allowed size (${config.maxFileSize} bytes)`,
        code: 'FILE_SIZE_EXCEEDED',
      },
    };
  }

  return { valid: true };
}

/**
 * Validate filesystem operation
 *
 * @param operation - Operation type
 * @param path - File/directory path
 * @param content - File content (for write operations)
 * @param config - Filesystem configuration
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const validation = validateFilesystemOperation('write', path, content);
 * if (!validation.valid) {
 *   return NextResponse.json(validation.error, { status: 400 });
 * }
 * ```
 */
export function validateFilesystemOperation(
  operation: FilesystemOperation,
  path: string,
  content?: string,
  config: FilesystemConfig = DEFAULT_FILESYSTEM_CONFIG
): FilesystemValidationResult {
  // Check operation-specific rules BEFORE path validation so that
  // special-case error codes (e.g. CANNOT_DELETE_ROOT) take priority
  // over generic path errors (e.g. ABSOLUTE_PATH_DETECTED).
  switch (operation) {
    case 'delete':
      // Prevent deletion of critical directories
      if (path === '' || path === '/' || path === '.') {
        return {
          valid: false,
          error: {
            type: 'operation_error',
            message: 'Cannot delete root directory',
            code: 'CANNOT_DELETE_ROOT',
          },
        };
      }
      break;

    case 'move':
    case 'copy':
      // Additional validation for move/copy operations
      break;
  }

  // Validate path
  const pathValidation = validatePath(path, config);
  if (!pathValidation.valid) {
    return pathValidation;
  }

  // Validate file extension for write operations
  if (operation === 'write') {
    const extValidation = validateFileExtension(path, config);
    if (!extValidation.valid) {
      return extValidation;
    }

    // Validate file size
    if (content) {
      const sizeValidation = validateFileSize(Buffer.byteLength(content, 'utf-8'), config);
      if (!sizeValidation.valid) {
        return sizeValidation;
      }
    }
  }

  return { valid: true, normalizedPath: pathValidation.normalizedPath };
}

/**
 * Sanitize path for logging
 *
 * @param path - Path to sanitize
 * @returns Sanitized path
 */
export function sanitizePathForLogging(path: string): string {
  // Remove sensitive path segments
  return path
    .replace(/\/home\/[^/]+/g, '/home/[REDACTED]')
    .replace(/\/Users\/[^/]+/g, '/Users/[REDACTED]')
    .replace(/\/var\/tmp\/.*/g, '/var/tmp/[REDACTED]');
}

/**
 * Get file extension safely
 *
 * @param path - File path
 * @returns File extension or empty string
 */
export function getFileExtension(path: string): string {
  const parts = path.split('.');
  if (parts.length < 2) return '';
  return '.' + parts.pop()?.toLowerCase() || '';
}

/**
 * Check if path is within base directory
 *
 * @param path - Path to check
 * @param baseDir - Base directory
 * @returns True if path is within base directory
 */
export function isPathWithinBaseDir(path: string, baseDir: string): boolean {
  const resolvedPath = resolve(baseDir, path);
  const relativePath = relative(baseDir, resolvedPath);
  return !relativePath.startsWith('..') && !resolve(baseDir, relativePath).startsWith('..');
}

/**
 * Create filesystem validation middleware
 *
 * @param config - Filesystem configuration
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * const validateFilesystem = createFilesystemValidator();
 *
 * export async function POST(request: NextRequest) {
 *   const body = await request.json();
 *   const validation = validateFilesystem('write', body.path, body.content);
 *
 *   if (!validation.valid) {
 *     return NextResponse.json(validation.error, { status: 400 });
 *   }
 *
 *   // Process request...
 * }
 * ```
 */
export function createFilesystemValidator(config: FilesystemConfig = DEFAULT_FILESYSTEM_CONFIG) {
  return function validate(
    operation: FilesystemOperation,
    path: string,
    content?: string
  ): FilesystemValidationResult {
    return validateFilesystemOperation(operation, path, content, config);
  };
}

/**
 * Default filesystem validator instance
 */
export const validateFilesystem = createFilesystemValidator();

/**
 * Filesystem security Zod schema
 */
export const FilesystemOperationSchema = z.object({
  path: z.string({
    required_error: 'Path is required',
  }).refine(
    (path) => {
      const validation = validatePath(path);
      return validation.valid;
    },
    {
      message: 'Invalid path: must be relative and cannot contain ".." or absolute paths',
    }
  ),
  ownerId: z.string({
    required_error: 'ownerId is required',
  }),
  content: z.string().optional(),
  operation: z.enum(['read', 'write', 'delete', 'list', 'move', 'copy']).optional(),
});

/**
 * Validate filesystem request with Zod
 *
 * @param data - Request data
 * @returns Validation result
 */
export function validateFilesystemRequest(data: unknown): {
  valid: true;
  data: z.infer<typeof FilesystemOperationSchema>;
} | {
  valid: false;
  error: {
    type: 'validation_error';
    message: string;
    details: any;
  };
} {
  const result = FilesystemOperationSchema.safeParse(data);

  if (!result.success) {
    return {
      valid: false,
      error: {
        type: 'validation_error',
        message: 'Invalid filesystem operation',
        details: result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    };
  }

  // Additional validation
  const { path, operation = 'read', content } = result.data;
  const validation = validateFilesystemOperation(operation, path, content);

  if (!validation.valid) {
    return {
      valid: false,
      error: {
        type: 'validation_error' as any,
        message: validation.error!.message,
        details: validation.error,
      },
    };
  }

  return {
    valid: true,
    data: {
      ...result.data,
      path: validation.normalizedPath!,
    },
  };
}
