/**
 * Configuration Validation Utilities
 *
 * Provides runtime validation for configuration objects
 * with detailed error messages and type checking.
 */

import { z } from 'zod';

// Common validation schemas
export const portSchema = z.number().int().min(1).max(65535);

export const urlSchema = z.string().url();

export const emailSchema = z.string().email();

export const nonEmptyStringSchema = z.string().min(1).trim();

// Database configuration schema
export const databaseConfigSchema = z.object({
  host: z.string().min(1),
  port: portSchema,
  database: nonEmptyStringSchema,
  username: nonEmptyStringSchema,
  password: z.string(), // Allow empty passwords for dev
  ssl: z.boolean().optional().default(false),
  connectionTimeoutMillis: z.number().int().positive().optional().default(10000),
});

// API configuration schema
export const apiConfigSchema = z.object({
  baseUrl: urlSchema,
  timeout: z.number().int().positive().optional().default(30000),
  retries: z.number().int().min(0).max(10).optional().default(3),
  apiKey: z.string().optional(),
});

// File system configuration schema
export const filesystemConfigSchema = z.object({
  rootDir: z.string().min(1),
  maxFileSize: z.number().int().positive().optional().default(10 * 1024 * 1024), // 10MB
  allowedExtensions: z.array(z.string()).optional().default(['.js', '.ts', '.json', '.md', '.txt']),
  blockedPaths: z.array(z.string()).optional().default(['node_modules', '.git', 'tmp']),
});

// Orchestration configuration schema
export const orchestrationConfigSchema = z.object({
  defaultMode: z.enum(['unified-agent', 'task-router', 'stateful-agent', 'agent-kernel']),
  timeout: z.number().int().positive().optional().default(300000), // 5 minutes
  maxConcurrentTasks: z.number().int().positive().optional().default(10),
  enableHealthChecks: z.boolean().optional().default(true),
});

/**
 * Validate configuration object against schema
 */
export function validateConfig<T>(
  config: unknown,
  schema: z.ZodSchema<T>,
  configName: string = 'configuration'
): { success: true; data: T } | { success: false; errors: string[] } {
  try {
    const result = schema.parse(config);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      return { success: false, errors };
    }
    return { success: false, errors: [`Validation failed: ${error.message}`] };
  }
}

/**
 * Validate environment variables
 */
export function validateEnvironment(requiredVars: string[], optionalVars: string[] = []): {
  valid: boolean;
  missing: string[];
  invalid: Array<{ var: string; reason: string }>;
} {
  const missing: string[] = [];
  const invalid: Array<{ var: string; reason: string }> = [];

  // Check required variables
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Validate optional variables if present
  for (const varName of optionalVars) {
    const value = process.env[varName];
    if (value) {
      // Add specific validations as needed
      if (varName.includes('PORT') && isNaN(Number(value))) {
        invalid.push({ var: varName, reason: 'must be a valid port number' });
      }
      if (varName.includes('URL') && !value.startsWith('http')) {
        invalid.push({ var: varName, reason: 'must be a valid URL' });
      }
    }
  }

  return {
    valid: missing.length === 0 && invalid.length === 0,
    missing,
    invalid
  };
}

/**
 * Create validated configuration with defaults
 */
export function createValidatedConfig<T>(
  input: Partial<T>,
  defaults: T,
  schema: z.ZodSchema<T>
): T {
  const merged = { ...defaults, ...input };
  const result = validateConfig(merged, schema);

  if (!result.success) {
    throw new Error(`Configuration validation failed:\n${(result as any).errors.join('\n')}`);
  }

  return result.data;
}