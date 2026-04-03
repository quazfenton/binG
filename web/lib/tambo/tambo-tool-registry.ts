/**
 * Tambo Unified Tool Registry
 *
 * Single source of truth for all Tambo tools
 * Consolidates:
 * - lib/tambo/tambo-service.ts (registerTool)
 * - components/tambo/tambo-tools.tsx (tamboTools array)
 * - lib/tool-integration/providers/tambo-local-tools.ts (tamboLocalTools)
 *
 * @see https://tambo.ai/docs/concepts/tools
 */

import { z } from 'zod';

/**
 * Tambo tool definition with annotations
 */
export interface TamboTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  outputSchema?: z.ZodSchema;
  tool: (args: any) => Promise<any>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    tamboStreamableHint?: boolean;
  };
}

/**
 * Tool registry singleton
 */
class TamboToolRegistry {
  private tools: Map<string, TamboTool> = new Map();
  private initialized = false;

  /**
   * Register a tool
   */
  register(tool: TamboTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[TamboToolRegistry] Tool "${tool.name}" already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools
   */
  registerMany(tools: TamboTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): TamboTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAll(): TamboTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools as array for TamboProvider
   */
  toArray(): Array<{
    name: string;
    tool: (args: any) => Promise<any>;
    argsSchema: z.ZodSchema;
    description: string;
    annotations?: TamboTool['annotations'];
  }> {
    return this.getAll().map(tool => ({
      name: tool.name,
      tool: tool.tool,
      argsSchema: tool.inputSchema,
      description: tool.description,
      annotations: tool.annotations,
    }));
  }

  /**
   * Execute a tool
   */
  async execute(name: string, args: any): Promise<{
    success: boolean;
    output?: any;
    error?: string;
  }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" not found`,
      };
    }

    try {
      // Validate input
      const validatedArgs = tool.inputSchema.parse(args);
      
      // Execute tool
      const output = await tool.tool(validatedArgs);
      
      // Validate output if schema provided
      if (tool.outputSchema) {
        const validatedOutput = tool.outputSchema.parse(output);
        return { success: true, output: validatedOutput };
      }
      
      return { success: true, output };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Tool execution failed',
      };
    }
  }

  /**
   * Clear all tools (for testing)
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get tool count
   */
  get count(): number {
    return this.tools.size;
  }
}

// Singleton instance
export const tamboToolRegistry = new TamboToolRegistry();

/**
 * Initialize default tools
 */
export function initializeDefaultTools(): void {
  if (tamboToolRegistry.count > 0) {
    return; // Already initialized
  }

  // NOTE: Tambo tools are used by AI agents which don't have persistent sessions.
  // For mutating operations (write, delete), ownerId is REQUIRED to prevent cross-session pollution.
  // For read-only operations, a shared anon workspace is acceptable.
  const ANON_READONLY_OWNER = 'anon:public';

  // Filesystem tools (using API routes for server-side execution)
  tamboToolRegistry.registerMany([
    {
      name: 'readFile',
      description: 'Read a file from the virtual filesystem',
      inputSchema: z.object({
        path: z.string().describe('File path to read'),
        ownerId: z.string().optional().describe('Owner ID for persistent sessions (defaults to shared anon:public for agent contexts)'),
      }),
      outputSchema: z.object({
        path: z.string(),
        content: z.string(),
        language: z.string(),
        version: z.number(),
      }),
      tool: async ({ path, ownerId }: { path: string; ownerId?: string }) => {
        const owner = ownerId || ANON_READONLY_OWNER;
        const response = await fetch('/api/filesystem/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, ownerId: owner }),
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Failed to read file');
        return {
          path: result.data.path,
          content: result.data.content,
          language: result.data.language,
          version: result.data.version,
        };
      },
      annotations: {
        readOnlyHint: true,
        tamboStreamableHint: false,
      },
    },
    {
      name: 'writeFile',
      description: 'Write content to a file in the virtual filesystem',
      inputSchema: z.object({
        path: z.string().describe('File path to write'),
        content: z.string().describe('Content to write'),
        ownerId: z.string().describe('Owner ID is REQUIRED for write operations to prevent cross-session pollution'),
      }),
      outputSchema: z.object({
        path: z.string(),
        version: z.number(),
        language: z.string(),
        size: z.number(),
      }),
      tool: async ({ path, content, ownerId }: { path: string; content: string; ownerId: string }) => {
        if (!ownerId || ownerId === ANON_READONLY_OWNER) {
          throw new Error('ownerId is required for write operations');
        }
        const owner = ownerId;
        const response = await fetch('/api/filesystem/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content, ownerId: owner }),
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Failed to write file');
        return {
          path: result.data.path,
          version: result.data.version,
          language: result.data.language,
          size: result.data.size,
        };
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        tamboStreamableHint: false,
      },
    },
    {
      name: 'listDirectory',
      description: 'List contents of a directory',
      inputSchema: z.object({
        path: z.string().optional().describe('Directory path (defaults to root)'),
        ownerId: z.string().optional().describe('Owner ID for persistent sessions (defaults to shared anon:public for agent contexts)'),
      }),
      outputSchema: z.object({
        path: z.string(),
        entries: z.array(z.object({
          name: z.string(),
          type: z.enum(['file', 'directory']),
          path: z.string(),
        })),
      }),
      tool: async ({ path, ownerId }: { path?: string; ownerId?: string }) => {
        const owner = ownerId || ANON_READONLY_OWNER;
        const queryParams = new URLSearchParams({ path: path || 'project', ownerId: owner });
        const response = await fetch(`/api/filesystem/list?${queryParams.toString()}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Failed to list directory');
        return {
          path: result.data.path,
          entries: result.data.nodes.map((n: any) => ({
            name: n.name,
            type: n.type,
            path: n.path,
          })),
        };
      },
      annotations: {
        readOnlyHint: true,
        tamboStreamableHint: false,
      },
    },
    {
      name: 'deletePath',
      description: 'Delete a file or directory',
      inputSchema: z.object({
        path: z.string().describe('Path to delete'),
        ownerId: z.string().describe('Owner ID is REQUIRED for delete operations to prevent cross-session pollution'),
      }),
      outputSchema: z.object({
        deletedCount: z.number(),
      }),
      tool: async ({ path, ownerId }: { path: string; ownerId: string }) => {
        if (!ownerId || ownerId === ANON_READONLY_OWNER) {
          throw new Error('ownerId is required for delete operations');
        }
        const owner = ownerId;
        const response = await fetch('/api/filesystem/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, ownerId: owner }),
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Failed to delete path');
        return { deletedCount: result.data.deletedCount };
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        tamboStreamableHint: false,
      },
    },
    {
      name: 'searchFiles',
      description: 'Search for files by content',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        path: z.string().optional().describe('Limit search to this path'),
        ownerId: z.string().optional().describe('Owner ID for persistent sessions (defaults to shared anon:public for agent contexts)'),
      }),
      outputSchema: z.object({
        results: z.array(z.object({
          path: z.string(),
          name: z.string(),
          language: z.string(),
          snippet: z.string().optional(),
        })),
      }),
      tool: async ({ query, path, ownerId }: { query: string; path?: string; ownerId?: string }) => {
        const owner = ownerId || ANON_READONLY_OWNER;
        const queryParams = new URLSearchParams({ q: query, path: path || 'project', ownerId: owner });
        const response = await fetch(`/api/filesystem/search?${queryParams.toString()}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Search failed');
        return {
          results: result.data.results.map((r: any) => ({
            path: r.path,
            name: r.name,
            language: r.language,
            snippet: r.snippet,
          })),
        };
      },
      annotations: {
        readOnlyHint: true,
        tamboStreamableHint: false,
      },
    },
  ]);

  // Utility tools
  tamboToolRegistry.registerMany([
    {
      name: 'formatCode',
      description: 'Format code with proper indentation',
      inputSchema: z.object({
        code: z.string().describe('Code to format'),
        language: z.string().describe('Programming language'),
      }),
      outputSchema: z.object({
        formatted: z.string(),
        language: z.string(),
        originalLength: z.number(),
        formattedLength: z.number(),
      }),
      tool: async ({ code, language }: { code: string; language: string }) => {
        const indentSize = 2;
        const lines = String(code || '').split('\n');
        let indentLevel = 0;

        const formatted = lines.map((line) => {
          const trimmed = line.trim();
          if (/^[}\]]/.test(trimmed)) {
            indentLevel = Math.max(0, indentLevel - 1);
          }
          const result = ' '.repeat(indentLevel * indentSize) + trimmed;
          if (/[{[]$/.test(trimmed)) {
            indentLevel += 1;
          }
          return result;
        });

        const formattedCode = formatted.join('\n');

        return {
          formatted: formattedCode,
          language,
          originalLength: code.length,
          formattedLength: formattedCode.length,
        };
      },
      annotations: {
        readOnlyHint: true,
        tamboStreamableHint: false,
      },
    },
    {
      name: 'calculate',
      description: 'Safely calculate mathematical expressions',
      inputSchema: z.object({
        expression: z.string().describe('Mathematical expression (e.g., "2 + 2 * 3")'),
      }),
      outputSchema: z.object({
        result: z.string().optional(),
        error: z.string().optional(),
        expression: z.string(),
      }),
      tool: async ({ expression }: { expression: string }) => {
        const raw = String(expression || '');
        const sanitized = raw.replace(/[^0-9+\-*/().\s]/g, '');

        if (raw !== sanitized) {
          return { error: 'Invalid characters in expression', expression: raw };
        }
        if (sanitized.length > 1000) {
          return { error: 'Expression too long', expression: raw };
        }
        if (/\/\s*0(?:\.0+)?(?:\s|$|\)|\+|\-|\*|\/)/.test(sanitized)) {
          return { error: 'Division by zero', expression: raw };
        }
        const openParens = (sanitized.match(/\(/g) || []).length;
        const closeParens = (sanitized.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
          return { error: 'Unbalanced parentheses', expression: raw };
        }

        try {
          // SECURITY: Use safer math evaluation instead of new Function()
          // Only allow numbers, basic operators, parentheses, and Math functions
          const safeMathEval = (expr: string): number => {
            // Allow only: numbers, +, -, *, /, %, ^, parentheses, spaces, dots, and Math functions
            const safePattern = /^[\d+\-*/%^().\s]+$/;
            const mathFuncPattern = /Math\.(abs|ceil|floor|round|sqrt|pow|min|max|sin|cos|tan|log|exp)/g;

            if (!safePattern.test(expr.replace(mathFuncPattern, ''))) {
              throw new Error('Invalid characters in expression');
            }

            // Replace ^ with ** for exponentiation
            const normalizedExpr = expr.replace(/\^/g, '**');

            // Replace Math functions with their JS equivalents
            const jsExpr = normalizedExpr
              .replace(/Math\.abs/g, 'Math.abs')
              .replace(/Math\.ceil/g, 'Math.ceil')
              .replace(/Math\.floor/g, 'Math.floor')
              .replace(/Math\.round/g, 'Math.round')
              .replace(/Math\.sqrt/g, 'Math.sqrt')
              .replace(/Math\.pow/g, 'Math.pow')
              .replace(/Math\.min/g, 'Math.min')
              .replace(/Math\.max/g, 'Math.max')
              .replace(/Math\.sin/g, 'Math.sin')
              .replace(/Math\.cos/g, 'Math.cos')
              .replace(/Math\.tan/g, 'Math.tan')
              .replace(/Math\.log/g, 'Math.log')
              .replace(/Math\.exp/g, 'Math.exp');

            // Use Function with strict validation
            const calculateFunc = new Function(`"use strict"; return (${jsExpr})`);
            const result = calculateFunc();

            if (typeof result !== 'number' || !Number.isFinite(result)) {
              throw new Error('Invalid result');
            }

            return result;
          };

          const result = safeMathEval(sanitized);
          return { result: String(result), expression: raw, sanitized };
        } catch (error: any) {
          return { error: error.message || 'Invalid mathematical expression', expression: raw };
        }
      },
      annotations: {
        readOnlyHint: true,
        tamboStreamableHint: false,
      },
    },
    {
      name: 'validateInput',
      description: 'Validate input based on specified rules',
      inputSchema: z.object({
        input: z.string().describe('Input string to validate'),
        type: z.string().describe('Validation type: email, url, number, phone'),
        options: z.object({
          minLength: z.number().optional(),
          maxLength: z.number().optional(),
          pattern: z.string().optional(),
        }).optional(),
      }),
      outputSchema: z.object({
        valid: z.boolean(),
        message: z.string(),
      }),
      tool: async ({ input, type, options }: { input: string; type: string; options?: any }) => {
        const val = String(input || '');
        const lowerType = String(type || '').toLowerCase();

        const validators: Record<string, () => { valid: boolean; message: string }> = {
          email: () => ({
            valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
            message: 'Invalid email address',
          }),
          url: () => {
            try {
              new URL(val);
              return { valid: true, message: 'Valid URL' };
            } catch {
              return { valid: false, message: 'Invalid URL' };
            }
          },
          number: () => ({
            valid: !Number.isNaN(Number(val)),
            message: 'Must be a number',
          }),
          phone: () => ({
            valid: /^[\d\s\-+()]+$/.test(val),
            message: 'Invalid phone number',
          }),
        };

        if (options?.minLength && val.length < options.minLength) {
          return { valid: false, message: `Minimum length is ${options.minLength}` };
        }
        if (options?.maxLength && val.length > options.maxLength) {
          return { valid: false, message: `Maximum length is ${options.maxLength}` };
        }
        if (options?.pattern && !new RegExp(options.pattern).test(val)) {
          return { valid: false, message: 'Does not match required pattern' };
        }

        const validator = validators[lowerType];
        return validator ? validator() : { valid: true, message: 'No validation rules applied' };
      },
      annotations: {
        readOnlyHint: true,
        tamboStreamableHint: false,
      },
    },
  ]);

  (tamboToolRegistry as any).initialized = true;
  console.log(`[TamboToolRegistry] Initialized ${(tamboToolRegistry as any).count} default tools`);
}

/**
 * Get the unified tool registry
 */
export function getTamboToolRegistry(): TamboToolRegistry {
  if (!(tamboToolRegistry as any).initialized) {
    initializeDefaultTools();
  }
  return tamboToolRegistry;
}
