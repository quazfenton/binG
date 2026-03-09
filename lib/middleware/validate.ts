/**
 * Input Validation Middleware
 * 
 * Provides request body validation using Zod schemas
 * Ensures type safety and prevents injection attacks
 */

import { NextRequest, NextResponse } from 'next/server';
import { z, ZodSchema, ZodError } from 'zod';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Middleware:Validation');

/**
 * Validate request body against Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @returns Middleware function
 * 
 * @example
 * export const POST = validateRequest(z.object({
 *   email: z.string().email(),
 *   password: z.string().min(8),
 * })).async (req, { validatedBody }) => {
 *   // validatedBody is typed and validated
 *   return NextResponse.json({ success: true });
 * };
 */
export function validateRequest<T extends ZodSchema>(schema: T) {
  return function validationMiddleware(
    handler: (
      req: NextRequest,
      context: { validatedBody: z.infer<T>; validatedQuery: Record<string, string>; validatedParams: Record<string, string> }
    ) => Promise<NextResponse>
  ) {
    return async function wrappedHandler(
      req: NextRequest,
      context?: { params: Promise<Record<string, string>> }
    ): Promise<NextResponse> {
      try {
        // Parse and validate body
        const body = await req.json().catch(() => null);
        const validatedBody = schema.parse(body);

        // Parse query parameters
        const queryObject = Object.fromEntries(req.nextUrl.searchParams.entries());
        const validatedQuery = queryObject as Record<string, string>;

        // Parse route params if available
        const params = context?.params ? await context.params : {};
        const validatedParams = params as Record<string, string>;

        // Call handler with validated data
        return await handler(req, { validatedBody, validatedQuery, validatedParams });
      } catch (error) {
        if (error instanceof ZodError) {
          logger.warn('Request validation failed', {
            errors: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
              code: e.code,
            })),
          });

          return NextResponse.json(
            {
              error: 'Validation failed',
              details: error.errors.map(e => ({
                field: e.path.join('.') || 'root',
                message: e.message,
                code: e.code,
              })),
            },
            { status: 400 }
          );
        }

        logger.error('Validation middleware error', error as Error);
        return NextResponse.json(
          { error: 'Invalid request' },
          { status: 400 }
        );
      }
    };
  };
}

/**
 * Validate only query parameters
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return function validationMiddleware(
    handler: (
      req: NextRequest,
      context: { validatedQuery: z.infer<T> }
    ) => Promise<NextResponse>
  ) {
    return async function wrappedHandler(req: NextRequest): Promise<NextResponse> {
      try {
        const queryObject = Object.fromEntries(req.nextUrl.searchParams.entries());
        const validatedQuery = schema.parse(queryObject);

        return await handler(req, { validatedQuery });
      } catch (error) {
        if (error instanceof ZodError) {
          return NextResponse.json(
            {
              error: 'Invalid query parameters',
              details: error.errors.map(e => ({
                field: e.path.join('.') || 'root',
                message: e.message,
              })),
            },
            { status: 400 }
          );
        }

        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
    };
  };
}

/**
 * Validate only route parameters
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return function validationMiddleware(
    handler: (
      req: NextRequest,
      context: { validatedParams: z.infer<T> }
    ) => Promise<NextResponse>,
    context?: { params: Promise<Record<string, string>> }
  ) {
    return async function wrappedHandler(
      req: NextRequest,
      routeContext?: { params: Promise<Record<string, string>> }
    ): Promise<NextResponse> {
      try {
        const params = routeContext?.params || context?.params;
        const resolvedParams = params ? await params : {};
        const validatedParams = schema.parse(resolvedParams);

        return await handler(req, { validatedParams });
      } catch (error) {
        if (error instanceof ZodError) {
          return NextResponse.json(
            {
              error: 'Invalid route parameters',
              details: error.errors.map(e => ({
                field: e.path.join('.') || 'root',
                message: e.message,
              })),
            },
            { status: 400 }
          );
        }

        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
    };
  };
}

/**
 * Common validation schemas
 */
export const schemas = {
  // Email validation
  email: z.string().email('Invalid email address'),

  // Password validation (8+ chars, uppercase, lowercase, number)
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),

  // UUID validation
  uuid: z.string().uuid('Invalid UUID format'),

  // Positive integer
  positiveInt: z.coerce.number().int().positive(),

  // Non-empty string
  nonEmptyString: z.string().trim().min(1, 'Field cannot be empty'),

  // Optional string
  optionalString: z.string().optional().nullable(),

  // Pagination
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),

  // Login request
  login: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),

  // Registration request (define inline to avoid circular reference)
  registration: z.object({
    email: z.string().email(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[a-z]/, 'Password must contain a lowercase letter')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[0-9]/, 'Password must contain a number'),
    username: z.string().min(3).max(50).optional(),
  }),

  // Terminal input
  terminalInput: z.object({
    sessionId: z.string(),
    data: z.string(),
  }),

  // File operation
  fileOperation: z.object({
    path: z.string(),
    action: z.enum(['read', 'write', 'delete', 'list']),
    content: z.string().optional(),
  }),

  // Chat message
  chatMessage: z.object({
    message: z.string().trim().min(1).max(10000),
    conversationId: z.string().optional(),
  }),
};

/**
 * Sanitize string input to prevent XSS
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove HTML brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Sanitize object with string fields
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  const sanitized: Partial<T> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key as keyof T] = sanitizeString(value) as T[keyof T];
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key as keyof T] = sanitizeObject(value as Record<string, any>) as T[keyof T];
    } else {
      sanitized[key as keyof T] = value;
    }
  }

  return sanitized as T;
}

/**
 * Validate and sanitize request
 * Combines validation with sanitization
 */
export function validateAndSanitize<T extends ZodSchema>(schema: T) {
  return validateRequest(schema.transform(data => sanitizeObject(data)));
}
