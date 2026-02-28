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
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

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

  const DEFAULT_OWNER = 'anon:public';

  // Filesystem tools
  tamboToolRegistry.registerMany([
    {
      name: 'readFile',
      description: 'Read a file from the virtual filesystem',
      inputSchema: z.object({
        path: z.string().describe('File path to read'),
        ownerId: z.string().optional().describe('Owner ID (defaults to anon:public)'),
      }),
      outputSchema: z.object({
        path: z.string(),
        content: z.string(),
        language: z.string(),
        version: z.number(),
      }),
      tool: async ({ path, ownerId }: { path: string; ownerId?: string }) => {
        const owner = ownerId || DEFAULT_OWNER;
        const file = await virtualFilesystem.readFile(owner, path);
        return {
          path: file.path,
          content: file.content,
          language: file.language,
          version: file.version,
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
        ownerId: z.string().optional().describe('Owner ID (defaults to anon:public)'),
      }),
      outputSchema: z.object({
        path: z.string(),
        version: z.number(),
        language: z.string(),
        size: z.number(),
      }),
      tool: async ({ path, content, ownerId }: { path: string; content: string; ownerId?: string }) => {
        const owner = ownerId || DEFAULT_OWNER;
        const file = await virtualFilesystem.writeFile(owner, path, content);
        return {
          path: file.path,
          version: file.version,
          language: file.language,
          size: file.size,
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
        ownerId: z.string().optional().describe('Owner ID (defaults to anon:public)'),
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
        const owner = ownerId || DEFAULT_OWNER;
        const listing = await virtualFilesystem.listDirectory(owner, path);
        return {
          path: listing.path,
          entries: listing.nodes.map(n => ({
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
        ownerId: z.string().optional().describe('Owner ID (defaults to anon:public)'),
      }),
      outputSchema: z.object({
        deletedCount: z.number(),
      }),
      tool: async ({ path, ownerId }: { path: string; ownerId?: string }) => {
        const owner = ownerId || DEFAULT_OWNER;
        const result = await virtualFilesystem.deletePath(owner, path);
        return { deletedCount: result.deletedCount };
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
        ownerId: z.string().optional().describe('Owner ID (defaults to anon:public)'),
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
        const owner = ownerId || DEFAULT_OWNER;
        const results = await virtualFilesystem.search(owner, query, { path });
        return {
          results: results.map(r => ({
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
          const calculateFunc = new Function(`'use strict'; return (${sanitized})`);
          const result = calculateFunc();

          if (typeof result !== 'number' || !Number.isFinite(result)) {
            return { error: 'Invalid result', expression: raw };
          }

          return { result: String(result), expression: raw, sanitized };
        } catch {
          return { error: 'Invalid mathematical expression', expression: raw };
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

  tamboToolRegistry.initialized = true;
  console.log(`[TamboToolRegistry] Initialized ${tamboToolRegistry.count} default tools`);
}

/**
 * Get the unified tool registry
 */
export function getTamboToolRegistry(): TamboToolRegistry {
  if (!tamboToolRegistry.initialized) {
    initializeDefaultTools();
  }
  return tamboToolRegistry;
}
