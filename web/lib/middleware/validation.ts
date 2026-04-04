/**
 * Input Validation Utilities
 *
 * Provides Zod schemas and validation functions for API request validation.
 * Ensures all incoming requests are properly validated before processing.
 *
 * Features:
 * - Comprehensive request schemas
 * - Custom validators
 * - Error formatting
 * - Type inference
 *
 * @see docs/sdk/validation.md
 */

import { z } from 'zod';

/**
 * LLM Message schema
 */
export const LLMMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  name: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string(),
    }),
  })).optional(),
  tool_call_id: z.string().optional(),
});

/**
 * Chat request schema
 */
export const ChatRequestSchema = z.object({
  messages: z.array(LLMMessageSchema).min(1, 'Messages array is required and cannot be empty'),
  provider: z.string({
    required_error: 'Provider is required',
    invalid_type_error: 'Provider must be a string',
  }),
  model: z.string({
    required_error: 'Model is required',
    invalid_type_error: 'Model must be a string',
  }),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().positive().optional().default(4000),
  stream: z.boolean().optional().default(true),
  apiKeys: z.record(z.string()).optional(),
  requestId: z.string().optional(),
  conversationId: z.string().optional(),
  filesystemContext: z.object({
    attachedFiles: z.array(z.object({
      path: z.string(),
      content: z.string(),
    })).optional(),
    scopePath: z.string().optional(),
  }).optional(),
});

/**
 * Tool execution request schema
 */
export const ToolExecutionRequestSchema = z.object({
  toolKey: z.string({
    required_error: 'toolKey is required',
  }),
  input: z.record(z.any()).optional(),
  conversationId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * Filesystem operation schema
 */
export const FilesystemOperationSchema = z.object({
  path: z.string({
    required_error: 'Path is required',
  }).refine(
    (path) => !path.includes('..') && !path.startsWith('/'),
    'Path must be relative and cannot contain ".."'
  ),
  ownerId: z.string({
    required_error: 'ownerId is required',
  }),
  content: z.string().optional(),
});

/**
 * Sandbox execution request schema
 */
export const SandboxExecutionRequestSchema = z.object({
  command: z.string({
    required_error: 'Command is required',
  }),
  sandboxId: z.string({
    required_error: 'sandboxId is required',
  }),
  cwd: z.string().optional(),
  timeout: z.number().positive().optional(),
  env: z.record(z.string()).optional(),
});

/**
 * Authentication request schema
 */
export const AuthRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * Webhook payload schema
 */
export const WebhookPayloadSchema = z.object({
  event_type: z.string(),
  data: z.record(z.any()),
  timestamp: z.number(),
  signature: z.string().optional(),
});

/**
 * Validate chat request
 *
 * @param data - Request data
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const body = await request.json();
 * const validation = validateChatRequest(body);
 *
 * if (!validation.valid) {
 *   return NextResponse.json(validation.error, { status: 400 });
 * }
 * ```
 */
export function validateChatRequest(data: unknown): {
  valid: true;
  data: z.infer<typeof ChatRequestSchema>;
} | {
  valid: false;
  error: {
    type: 'validation_error';
    message: string;
    details: any;
  };
} {
  const result = ChatRequestSchema.safeParse(data);

  if (!result.success) {
    return {
      valid: false,
      error: {
        type: 'validation_error',
        message: 'Invalid chat request',
        details: result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    };
  }

  return {
    valid: true,
    data: result.data,
  };
}

/**
 * Validate tool execution request
 *
 * @param data - Request data
 * @returns Validation result
 */
export function validateToolExecutionRequest(data: unknown): {
  valid: true;
  data: z.infer<typeof ToolExecutionRequestSchema>;
} | {
  valid: false;
  error: {
    type: 'validation_error';
    message: string;
    details: any;
  };
} {
  const result = ToolExecutionRequestSchema.safeParse(data);

  if (!result.success) {
    return {
      valid: false,
      error: {
        type: 'validation_error',
        message: 'Invalid tool execution request',
        details: result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    };
  }

  return {
    valid: true,
    data: result.data,
  };
}

/**
 * Validate filesystem operation
 *
 * @param data - Request data
 * @returns Validation result
 */
export function validateFilesystemOperation(data: unknown): {
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

  return {
    valid: true,
    data: result.data,
  };
}

/**
 * Validate sandbox execution request
 *
 * @param data - Request data
 * @returns Validation result
 */
export function validateSandboxExecutionRequest(data: unknown): {
  valid: true;
  data: z.infer<typeof SandboxExecutionRequestSchema>;
} | {
  valid: false;
  error: {
    type: 'validation_error';
    message: string;
    details: any;
  };
} {
  const result = SandboxExecutionRequestSchema.safeParse(data);

  if (!result.success) {
    return {
      valid: false,
      error: {
        type: 'validation_error',
        message: 'Invalid sandbox execution request',
        details: result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    };
  }

  return {
    valid: true,
    data: result.data,
  };
}

/**
 * Validate authentication request
 *
 * @param data - Request data
 * @returns Validation result
 */
export function validateAuthRequest(data: unknown): {
  valid: true;
  data: z.infer<typeof AuthRequestSchema>;
} | {
  valid: false;
  error: {
    type: 'validation_error';
    message: string;
    details: any;
  };
} {
  const result = AuthRequestSchema.safeParse(data);

  if (!result.success) {
    return {
      valid: false,
      error: {
        type: 'validation_error',
        message: 'Invalid authentication request',
        details: result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    };
  }

  return {
    valid: true,
    data: result.data,
  };
}

/**
 * Format validation error for API response
 *
 * @param error - Zod error
 * @returns Formatted error object
 */
export function formatValidationError(error: z.ZodError): {
  type: string;
  message: string;
  code: string;
  details: Array<{
    field: string;
    message: string;
  }>;
} {
  return {
    type: 'validation_error',
    message: 'Invalid request',
    code: 'VALIDATION_ERROR',
    details: error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
    })),
  };
}

/**
 * Create custom validator
 *
 * @param schema - Zod schema
 * @param errorMessage - Custom error message
 * @returns Validation function
 *
 * @example
 * ```typescript
 * const validateEmail = createCustomValidator(
 *   z.string().email(),
 *   'Invalid email address'
 * );
 * ```
 */
export function createCustomValidator<T extends z.ZodType>(
  schema: T,
  errorMessage?: string
) {
  return function validate(data: unknown): {
    valid: true;
    data: z.infer<T>;
  } | {
    valid: false;
    error: {
      type: 'validation_error';
      message: string;
      details: any;
    };
  } {
    const result = schema.safeParse(data);

    if (!result.success) {
      return {
        valid: false,
        error: {
          type: 'validation_error',
          message: errorMessage || 'Invalid input',
          details: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        },
      };
    }

    return {
      valid: true,
      data: result.data as z.infer<T>,
    };
  };
}

/**
 * Validate request body with custom schema
 *
 * @param body - Request body
 * @param schema - Custom schema
 * @returns Validation result
 */
export function validateRequestBody<T extends z.ZodType>(
  body: unknown,
  schema: T
): {
  valid: true;
  data: z.infer<T>;
} | {
  valid: false;
  error: {
    type: 'validation_error';
    message: string;
    details: any;
  };
} {
  const result = schema.safeParse(body);

  if (!result.success) {
    return {
      valid: false,
      error: {
        type: 'validation_error',
        message: 'Invalid request body',
        details: formatValidationError(result.error),
      },
    };
  }

  return {
    valid: true,
    data: result.data as z.infer<T>,
  };
}
