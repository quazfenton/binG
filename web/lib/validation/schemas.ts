/**
 * Shared Zod Schemas for API Validation
 * 
 * Reusable schema definitions for consistent validation across all API routes.
 * Import these schemas instead of recreating validation logic.
 * 
 * @example
 * import { pathSchema, sessionIdSchema } from '@/lib/validation/schemas';
 * 
 * const requestBody = await req.json();
 * const validated = pathSchema.safeParse(requestBody.path);
 */

import { z } from 'zod';

/**
 * File path validation
 * - Prevents directory traversal (..)
 * - Blocks null bytes
 * - Validates length
 * - Allows absolute and relative paths
 */
export const pathSchema = z.string()
  .min(1, 'Path is required')
  .max(500, 'Path too long (max 500 characters)')
  .refine(
    (path) => !path.includes('..'),
    'Path cannot contain directory traversal (..)'
  )
  .refine(
    (path) => !path.includes('\0'),
    'Path cannot contain null bytes'
  )
  .refine(
    (path) => !path.includes('//'),
    'Path cannot contain double slashes'
  );

/**
 * Absolute path validation (must start with /)
 */
export const absolutePathSchema = pathSchema.refine(
  (path) => path.startsWith('/'),
  'Path must be an absolute path starting with /'
);

/**
 * Relative path validation (must NOT start with /)
 */
export const relativePathSchema = pathSchema.refine(
  (path) => !path.startsWith('/'),
  'Path must be a relative path'
);

/**
 * Session ID validation
 * Format: ownerId:sessionId or just sessionId
 */
export const sessionIdSchema = z.string()
  .min(1, 'Session ID is required')
  .max(200, 'Session ID too long (max 200 characters)')
  .regex(
    /^[a-zA-Z0-9:_-]+$/,
    'Session ID can only contain letters, numbers, colons, underscores, and hyphens'
  );

/**
 * Commit ID validation
 * Accepts UUID or alphanumeric IDs
 */
export const commitIdSchema = z.string()
  .min(1, 'Commit ID is required')
  .max(100, 'Commit ID too long')
  .regex(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$|^[a-zA-Z0-9_-]+$/,
    'Invalid commit ID format'
  );

/**
 * Transaction ID validation
 * Format: fse_timestamp_randomstring
 */
export const transactionIdSchema = z.string()
  .min(1, 'Transaction ID is required')
  .regex(
    /^fse_\d+_[a-zA-Z0-9]+$/,
    'Invalid transaction ID format (expected: fse_timestamp_randomstring)'
  );

/**
 * Sandbox ID validation
 */
export const sandboxIdSchema = z.string()
  .min(1, 'Sandbox ID is required')
  .max(100, 'Sandbox ID too long')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Sandbox ID can only contain letters, numbers, underscores, and hyphens'
  );

/**
 * Command validation for sandbox/shell execution
 * - Max length to prevent buffer attacks
 * - Blocks null bytes
 * - Blocks dangerous patterns
 */
export const commandSchema = z.string()
  .min(1, 'Command is required')
  .max(10000, 'Command too long (max 10000 characters)')
  .refine(
    (cmd) => !cmd.includes('\0'),
    'Command cannot contain null bytes'
  );

/**
 * Owner ID validation
 */
export const ownerIdSchema = z.string()
  .min(1, 'Owner ID is required')
  .max(200, 'Owner ID too long')
  .regex(
    /^[a-zA-Z0-9:_@.-]+$/,
    'Invalid owner ID format'
  );

/**
 * Pagination parameters
 */
export const paginationSchema = z.object({
  page: z.string()
    .optional()
    .transform(val => val ? parseInt(val, 10) : 1)
    .refine(val => !isNaN(val) && val > 0, {
      message: 'Page must be a positive number',
    }),
  limit: z.string()
    .optional()
    .transform(val => val ? parseInt(val, 10) : 20)
    .refine(val => !isNaN(val) && val > 0 && val <= 100, {
      message: 'Limit must be between 1 and 100',
    }),
});

/**
 * File name validation
 */
export const fileNameSchema = z.string()
  .min(1, 'File name is required')
  .max(255, 'File name too long')
  .refine(
    (name) => !name.includes('/') && !name.includes('\\'),
    'File name cannot contain path separators'
  )
  .refine(
    (name) => !['.', '..'].includes(name),
    'File name cannot be "." or ".."'
  );

/**
 * Directory name validation
 */
export const directoryNameSchema = z.string()
  .min(1, 'Directory name is required')
  .max(255, 'Directory name too long')
  .refine(
    (name) => !name.includes('/') && !name.includes('\\'),
    'Directory name cannot contain path separators'
  );

/**
 * File content validation
 */
export const fileContentSchema = z.string()
  .max(100 * 1024 * 1024, 'File content too large (max 100MB)');

/**
 * Language identifier validation
 */
export const languageSchema = z.string()
  .min(1, 'Language is required')
  .max(50, 'Language too long')
  .regex(
    /^[a-zA-Z0-9#+-]+$/,
    'Invalid language format'
  );

/**
 * URL validation
 */
export const urlSchema = z.string()
  .url('Invalid URL format')
  .max(2048, 'URL too long');

/**
 * Email validation
 */
export const emailSchema = z.string()
  .email('Invalid email format')
  .max(255, 'Email too long');

/**
 * Search query validation
 */
export const searchQuerySchema = z.string()
  .min(1, 'Search query is required')
  .max(500, 'Search query too long');

/**
 * Glob pattern validation
 */
export const globPatternSchema = z.string()
  .min(1, 'Pattern is required')
  .max(200, 'Pattern too long')
  .refine(
    (pattern) => !pattern.includes('\0'),
    'Pattern cannot contain null bytes'
  );

/**
 * Array of glob patterns
 */
export const globPatternsArraySchema = z.array(globPatternSchema);

/**
 * Context pack format enum
 */
export const contextPackFormatSchema = z.enum(['markdown', 'xml', 'json', 'plain']);

/**
 * Context pack request options
 */
export const contextPackOptionsSchema = z.object({
  path: absolutePathSchema.optional().default('/'),
  format: contextPackFormatSchema.optional().default('markdown'),
  includeContents: z.boolean().optional().default(true),
  includeTree: z.boolean().optional().default(true),
  maxFileSize: z.number()
    .optional()
    .default(102400)
    .refine((val) => val <= 10 * 1024 * 1024, 'Max file size is 10MB'),
  maxLinesPerFile: z.number()
    .optional()
    .default(500)
    .refine((val) => val <= 10000, 'Max lines per file is 10000'),
  excludePatterns: globPatternsArraySchema.optional(),
  includePatterns: globPatternsArraySchema.optional(),
});

/**
 * Common error response schema
 */
export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

/**
 * Common success response schema template
 */
export function successResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
    metadata: z.object({
      timestamp: z.string().optional(),
      requestId: z.string().optional(),
    }).optional(),
  });
}

/**
 * Validate and parse Zod schema with error handling
 * 
 * @example
 * const result = await validateRequest(req, mySchema);
 * if (!result.success) return result.errorResponse;
 * const data = result.data;
 */
export async function validateRequest<T extends z.ZodSchema>(
  request: Request,
  schema: T,
  options?: { useQuery?: boolean; useBody?: boolean }
): Promise<
  | { success: true; data: z.infer<T> }
  | { success: false; error: string; errorResponse: Response }
> {
  const url = new URL(request.url);
  let inputData: any;

  if (options?.useQuery) {
    inputData = Object.fromEntries(url.searchParams);
  } else if (options?.useBody !== false) {
    try {
      inputData = await request.json();
    } catch {
      return {
        success: false,
        error: 'Invalid JSON in request body',
        errorResponse: Response.json(
          { success: false, error: 'Invalid JSON in request body' },
          { status: 400 }
        ),
      };
    }
  }

  const result = schema.safeParse(inputData);

  if (!result.success) {
    const errorMessage = result.error.errors[0]?.message || 'Validation failed';
    return {
      success: false,
      error: errorMessage,
      errorResponse: Response.json(
        { 
          success: false, 
          error: errorMessage,
          details: result.error.flatten(),
        },
        { status: 400 }
      ),
    };
  }

  return { success: true, data: result.data };
}

/**
 * Export all schemas as a namespace for convenience
 */
export const schemas = {
  path: pathSchema,
  absolutePath: absolutePathSchema,
  relativePath: relativePathSchema,
  sessionId: sessionIdSchema,
  commitId: commitIdSchema,
  transactionId: transactionIdSchema,
  sandboxId: sandboxIdSchema,
  command: commandSchema,
  ownerId: ownerIdSchema,
  pagination: paginationSchema,
  fileName: fileNameSchema,
  directoryName: directoryNameSchema,
  fileContent: fileContentSchema,
  language: languageSchema,
  url: urlSchema,
  email: emailSchema,
  searchQuery: searchQuerySchema,
  globPattern: globPatternSchema,
  globPatternsArray: globPatternsArraySchema,
  contextPackFormat: contextPackFormatSchema,
  contextPackOptions: contextPackOptionsSchema,
  errorResponse: errorResponseSchema,
  successResponse: successResponseSchema,
};
