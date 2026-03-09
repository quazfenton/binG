/**
 * Input Validation Schemas for Sandbox Tools
 * 
 * Provides Zod schemas for validating all tool inputs
 * to prevent injection attacks and ensure type safety.
 */

import { z } from 'zod';

/**
 * File path validation schema
 * - Max length: 500 characters
 * - No null bytes
 * - No path traversal (validated separately in resolvePath)
 */
export const FilePathSchema = z.string()
  .min(1, 'Path cannot be empty')
  .max(500, 'Path too long (max 500 characters)')
  .refine(
    (path) => !path.includes('\0'),
    'Path cannot contain null bytes'
  );

/**
 * File content validation schema
 * - Max size: 10MB (10,000,000 bytes)
 * - Valid UTF-8 string
 */
export const FileContentSchema = z.string()
  .max(10_000_000, 'File content too large (max 10MB)');

/**
 * Directory path validation schema
 * - Same as FilePathSchema but allows trailing slash
 */
export const DirectoryPathSchema = z.string()
  .min(1, 'Directory path cannot be empty')
  .max(500, 'Directory path too long (max 500 characters)')
  .refine(
    (path) => !path.includes('\0'),
    'Path cannot contain null bytes'
  );

/**
 * Shell command validation schema
 * - Max length: 10,000 characters
 * - No null bytes
 * - Will be further validated by BLOCKED_PATTERNS
 */
export const ShellCommandSchema = z.string()
  .min(1, 'Command cannot be empty')
  .max(10_000, 'Command too long (max 10,000 characters)')
  .refine(
    (cmd) => !cmd.includes('\0'),
    'Command cannot contain null bytes'
  );

/**
 * Write file tool parameters schema
 */
export const WriteFileSchema = z.object({
  path: FilePathSchema,
  content: FileContentSchema,
});

/**
 * Read file tool parameters schema
 */
export const ReadFileSchema = z.object({
  path: FilePathSchema,
});

/**
 * List directory tool parameters schema
 */
export const ListDirectorySchema = z.object({
  path: DirectoryPathSchema.optional().default('.'),
});

/**
 * Execute shell command tool parameters schema
 */
export const ExecShellSchema = z.object({
  command: ShellCommandSchema,
});

/**
 * Tool execution context schema
 */
export const ToolExecutionContextSchema = z.object({
  userId: z.string().uuid('Invalid user ID format').optional(),
  sandboxId: z.string().uuid('Invalid sandbox ID format').optional(),
  conversationId: z.string().uuid('Invalid conversation ID format').optional(),
  requestId: z.string().optional(),
});

/**
 * Type exports
 */
export type WriteFileInput = z.infer<typeof WriteFileSchema>;
export type ReadFileInput = z.infer<typeof ReadFileSchema>;
export type ListDirectoryInput = z.infer<typeof ListDirectorySchema>;
export type ExecShellInput = z.infer<typeof ExecShellSchema>;
export type ToolExecutionContext = z.infer<typeof ToolExecutionContextSchema>;

/**
 * Validation helper functions
 */

/**
 * Validate and parse tool input with detailed error messages
 */
export function validateToolInput<T extends z.ZodSchema>(
  schema: T,
  input: unknown,
  toolName: string
): z.infer<T> {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      );
      throw new Error(
        `Invalid input for tool '${toolName}': ${messages.join('; ')}`
      );
    }
    throw error;
  }
}

/**
 * Safe file operation wrapper with validation
 */
export async function safeFileOperation<T>(
  operation: () => Promise<T>,
  context: {
    toolName: string;
    path?: string;
    userId?: string;
  }
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Log error with context (but don't expose sensitive details)
    console.error('[Sandbox] File operation failed', {
      tool: context.toolName,
      path: context.path,
      userId: context.userId,
      error: error.message,
    });
    
    // Re-throw with sanitized message
    throw new Error(
      `File operation '${context.toolName}' failed. Check logs for details.`
    );
  }
}

/**
 * Command validation wrapper
 * Combines schema validation with pattern matching
 */
export function validateShellCommand(
  command: string,
  validateCommand: (cmd: string) => { valid: boolean; reason?: string }
): { valid: boolean; command?: string; reason?: string } {
  // First validate schema
  const schemaResult = ExecShellSchema.safeParse({ command });
  if (!schemaResult.success) {
    return {
      valid: false,
      reason: `Invalid command format: ${schemaResult.error.errors[0]?.message}`,
    };
  }

  // Then validate against blocked patterns
  const patternResult = validateCommand(command);
  if (!patternResult.valid) {
    return patternResult;
  }

  return { valid: true, command };
}
