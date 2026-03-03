/**
 * Mastra Tool Definitions
 *
 * Wraps existing services (VFS, Sandbox, etc.) as Mastra tools with schema validation.
 * All tools are MCP-compatible for provider-agnostic execution.
 *
 * @see https://mastra.ai/docs/tools/overview
 */

import { createTool } from '@mastra/core';
import { z } from 'zod';
import { VirtualFilesystemService } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { getSandboxProvider } from '@/lib/sandbox/providers';

const vfs = new VirtualFilesystemService();
const sandboxProvider = getSandboxProvider(); // Uses default from env or 'daytona'

// ===========================================
// Virtual Filesystem Tools
// ===========================================

/**
 * Write file to virtual filesystem
 * 
 * SECURITY FIXED: Added path validation to prevent path traversal attacks
 */
export const writeFileTool = createTool({
  id: 'WRITE_FILE',
  name: 'Write File',
  description: `Write content to a file in the virtual filesystem.
Use this tool when you need to:
- Create new files
- Update existing file contents
- Save generated code or configuration

The file will be created if it doesn't exist, or overwritten if it does.
Always use the full path relative to the workspace root.`,
  inputSchema: z.object({
    path: z.string()
      .describe('File path relative to workspace root (e.g., "src/index.ts")')
      .min(1, 'Path cannot be empty')
      .refine(p => !p.includes('..'), 'Path cannot contain ".."')
      .refine(p => !p.startsWith('/'), 'Path must be relative (no leading /)'),
    content: z.string()
      .describe('Complete file content')
      .max(1000000, 'Content exceeds 1MB limit'),
    ownerId: z.string()
      .describe('Workspace owner ID for isolation')
      .uuid('Must be a valid UUID'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string(),
    version: z.number(),
    size: z.number().optional(),
  }),
  metadata: {
    category: 'filesystem',
    risk: 'medium',
    requiresApproval: false,
  },
  execute: async ({ context }) => {
    try {
      const { path, content, ownerId } = context;
      
      // SECURITY: Validate path to prevent path traversal
      if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
        throw new Error('Invalid path: must be relative and not contain ".."');
      }
      
      // Normalize path separators
      const normalizedPath = path.replace(/\\/g, '/');
      
      const file = await vfs.writeFile(ownerId, normalizedPath, content);
      return { 
        success: true, 
        path: file.path, 
        version: file.version,
        size: content.length,
      };
    } catch (error) {
      throw new Error(`WRITE_FILE failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  retries: 3,
  timeout: 30000, // 30 second timeout
});

/**
 * Read file from virtual filesystem
 */
export const readFileTool = createTool({
  id: 'READ_FILE',
  name: 'Read File',
  description: `Read content from a file in the virtual filesystem.
Use this tool when you need to:
- Check existing file contents
- Review code before modification
- Verify file existence`,
  inputSchema: z.object({
    path: z.string()
      .describe('File path relative to workspace root')
      .min(1, 'Path cannot be empty')
      .refine(p => !p.includes('..'), 'Path cannot contain ".."'),
    ownerId: z.string()
      .describe('Workspace owner ID')
      .uuid('Must be a valid UUID'),
  }),
  outputSchema: z.object({
    content: z.string(),
    language: z.string().optional(),
    size: z.number().optional(),
  }),
  metadata: {
    category: 'filesystem',
    risk: 'low',
    requiresApproval: false,
  },
  execute: async ({ context }) => {
    try {
      const { path, ownerId } = context;
      
      // SECURITY: Validate path
      if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
        throw new Error('Invalid path: must be relative and not contain ".."');
      }
      
      const file = await vfs.readFile(ownerId, path);
      return { 
        content: file.content, 
        language: file.language,
        size: file.content.length,
      };
    } catch (error) {
      throw new Error(`READ_FILE failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  retries: 3,
  timeout: 30000,
});

/**
 * Delete file or directory
 */
export const deletePathTool = createTool({
  id: 'DELETE_PATH',
  name: 'Delete Path',
  description: `Delete a file or directory from the virtual filesystem.
Use this tool when you need to:
- Remove unwanted files
- Clean up temporary files
- Delete entire directories

WARNING: This action is irreversible.`,
  inputSchema: z.object({
    path: z.string()
      .describe('File or directory path')
      .min(1, 'Path cannot be empty')
      .refine(p => !p.includes('..'), 'Path cannot contain ".."'),
    ownerId: z.string()
      .describe('Workspace owner ID')
      .uuid('Must be a valid UUID'),
  }),
  outputSchema: z.object({
    deletedCount: z.number(),
    success: z.boolean(),
  }),
  metadata: {
    category: 'filesystem',
    risk: 'high',
    requiresApproval: true,
  },
  execute: async ({ context }) => {
    try {
      const { path, ownerId } = context;
      
      // SECURITY: Validate path
      if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
        throw new Error('Invalid path: must be relative and not contain ".."');
      }
      
      const result = await vfs.deletePath(ownerId, path);
      return { 
        deletedCount: result.deletedCount,
        success: true,
      };
    } catch (error) {
      throw new Error(`DELETE_PATH failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  retries: 2,
  timeout: 30000,
});

/**
 * List files in directory
 */
export const listFilesTool = createTool({
  id: 'LIST_FILES',
  name: 'List Files',
  description: `List files and directories at the given path.
Use this tool when you need to:
- Explore directory structure
- Find specific files
- Check what files exist in a location`,
  inputSchema: z.object({
    path: z.string()
      .optional()
      .describe('Directory path (default: root)')
      .refine(p => !p || !p.includes('..'), 'Path cannot contain ".."'),
    ownerId: z.string()
      .describe('Workspace owner ID')
      .uuid('Must be a valid UUID'),
  }),
  outputSchema: z.object({
    files: z.array(z.object({
      name: z.string(),
      type: z.enum(['file', 'directory']),
      path: z.string(),
      size: z.number().optional(),
    })),
  }),
  metadata: {
    category: 'filesystem',
    risk: 'low',
    requiresApproval: false,
  },
  execute: async ({ context }) => {
    try {
      const { path, ownerId } = context;
      
      // SECURITY: Validate path
      if (path && (path.includes('..') || path.startsWith('/') || path.startsWith('\\'))) {
        throw new Error('Invalid path: must be relative and not contain ".."');
      }
      
      const files = await vfs.listFiles(ownerId, path || '/');
      return { files };
    } catch (error) {
      throw new Error(`LIST_FILES failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  retries: 3,
  timeout: 30000,
});

// ===========================================
// Sandbox Execution Tools
// ===========================================

/**
 * Execute code in sandboxed environment
 * 
 * SECURITY FIXED: Prevent command injection by using proper argument passing
 */
export const executeCodeTool = createTool({
  id: 'EXECUTE_CODE',
  name: 'Execute Code',
  description: `Execute code in a sandboxed environment. Supports Python, TypeScript, and JavaScript.
Use this tool when you need to:
- Test code snippets
- Run scripts
- Validate code behavior

The code runs in an isolated sandbox for safety.`,
  inputSchema: z.object({
    code: z.string()
      .describe('Code to execute')
      .max(50000, 'Code exceeds 50KB limit'),
    language: z.enum(['python', 'typescript', 'javascript'])
      .describe('Programming language'),
    ownerId: z.string()
      .describe('Workspace owner ID')
      .uuid('Must be a valid UUID'),
  }),
  outputSchema: z.object({
    output: z.string(),
    exitCode: z.number().optional(),
    executionTime: z.number().optional(),
  }),
  metadata: {
    category: 'sandbox',
    risk: 'high',
    requiresApproval: true,
  },
  execute: async ({ context }) => {
    try {
      const { code, language, ownerId } = context;
      
      // SECURITY: Validate code doesn't contain obvious injection attempts
      const dangerousPatterns = [
        /\bexec\s*\(/,
        /\beval\s*\(/,
        /\bsystem\s*\(/,
        /\brequire\s*\(/,
        /\bimport\s+.*\s+from\s+['"]child_process['"]/,
      ];
      
      for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
          throw new Error(`Code contains potentially dangerous pattern: ${pattern.source}`);
        }
      }
      
      const sandbox = await sandboxProvider.createSandbox({ ownerId });
      
      // SECURITY FIXED: Use proper argument passing instead of string interpolation
      // This prevents command injection attacks
      const command = language === 'python' ? 'python3' : 'node';
      const args = language === 'python' ? ['-c', code] : ['-e', code];
      
      const startTime = Date.now();
      const result = await sandbox.executeCommand(command, args);
      const executionTime = Date.now() - startTime;
      
      return { 
        output: result.output || '', 
        exitCode: result.exitCode,
        executionTime,
      };
    } catch (error) {
      throw new Error(`EXECUTE_CODE failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  retries: 2,
  timeout: 60000, // 60 second timeout for code execution
});

/**
 * Check code syntax before execution (safety gate)
 */
export const syntaxCheckTool = createTool({
  id: 'SYNTAX_CHECK',
  name: 'Syntax Check',
  description: `Check code syntax before execution. Use as a safety gate before EXECUTE_CODE.
Use this tool when you need to:
- Validate code syntax
- Catch errors before execution
- Ensure code is well-formed`,
  inputSchema: z.object({
    code: z.string()
      .describe('Code to check')
      .max(50000, 'Code exceeds 50KB limit'),
    language: z.enum(['python', 'typescript', 'javascript'])
      .describe('Programming language'),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
  }),
  metadata: {
    category: 'sandbox',
    risk: 'low',
    requiresApproval: false,
  },
  execute: async ({ context }) => {
    try {
      const { code, language } = context;
      const { checkSyntax } = await import('@/lib/code-parser');
      const result = checkSyntax(code, language);
      return { 
        valid: result.valid, 
        errors: result.errors,
        warnings: result.warnings || [],
      };
    } catch (error) {
      throw new Error(`SYNTAX_CHECK failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  retries: 2,
  timeout: 25000, // 15 second timeout
});

/**
 * Install dependencies in sandbox
 */
export const installDepsTool = createTool({
  id: 'INSTALL_DEPS',
  name: 'Install Dependencies',
  description: `Install package dependencies in the sandbox environment.
Use this tool when you need to:
- Install npm packages
- Install Python packages
- Set up project dependencies

Only install trusted packages from official registries.`,
  inputSchema: z.object({
    packages: z.array(z.string())
      .describe('List of packages to install')
      .max(20, 'Cannot install more than 20 packages at once'),
    language: z.enum(['python', 'node'])
      .describe('Package manager language'),
    ownerId: z.string()
      .describe('Workspace owner ID')
      .uuid('Must be a valid UUID'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    installedCount: z.number().optional(),
  }),
  metadata: {
    category: 'sandbox',
    risk: 'medium',
    requiresApproval: true,
  },
  execute: async ({ context }) => {
    try {
      const { packages, language, ownerId } = context;
      
      // SECURITY: Validate package names
      const packageRegex = /^[a-zA-Z0-9@][a-zA-Z0-9._@/-]*$/;
      for (const pkg of packages) {
        if (!packageRegex.test(pkg)) {
          throw new Error(`Invalid package name: ${pkg}`);
        }
      }
      
      const sandbox = await sandboxProvider.createSandbox({ ownerId });
      const command = language === 'python' ? 'pip' : 'npm';
      const args = language === 'python' 
        ? ['install', ...packages] 
        : ['install', ...packages];
      
      const result = await sandbox.executeCommand(command, args);
      
      return { 
        success: result.exitCode === 0, 
        output: result.output || '',
        installedCount: packages.length,
      };
    } catch (error) {
      throw new Error(`INSTALL_DEPS failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  retries: 2,
  timeout: 120000, // 2 minute timeout for package installation
});

// ===========================================
// Tool Registry
// ===========================================

/**
 * All available tools
 */
export const allTools = {
  writeFile: writeFileTool,
  readFile: readFileTool,
  deletePath: deletePathTool,
  listFiles: listFilesTool,
  executeCode: executeCodeTool,
  syntaxCheck: syntaxCheckTool,
  installDeps: installDepsTool,
  // Filesystem tools for LLM agent (from filesystem-tools.ts)
  // These provide structured tool definitions for LLM tool calling
};

/**
 * Get tool by ID
 *
 * @param toolId - Tool identifier
 * @returns Tool instance or undefined
 */
export function getTool(toolId: string) {
  return allTools[toolId as keyof typeof allTools];
}

/**
 * Get tools by category
 *
 * @param category - Tool category ('vfs' | 'sandbox')
 * @returns Array of tools in category
 */
export function getToolsByCategory(category: 'vfs' | 'sandbox') {
  if (category === 'vfs') {
    return [writeFileTool, readFileTool, deletePathTool, listFilesTool];
  }
  return [executeCodeTool, syntaxCheckTool, installDepsTool];
}

/**
 * Get all tools including agent filesystem tools
 * For use with LLM tool calling
 */
export function getAllToolsWithAgentTools() {
  const { getFilesystemTools } = require('../tools/filesystem-tools');
  const agentTools = getFilesystemTools();
  
  return [
    ...Object.values(allTools),
    ...agentTools,
  ];
}
