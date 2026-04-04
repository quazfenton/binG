/**
 * Terminal Command Handlers for File Operations
 * 
 * Handles commands like:
 * - xdg-open <file> - Open file in editor
 * - gedit <file> - Open file in editor
 * - edit <file> - Open file in editor
 * - code <file> - Open file in editor
 * - vim <file> - Open file in editor (falls back to Monaco)
 * - nano <file> - Open file in editor (falls back to Monaco)
 * - cat <file> - Display file content
 * - head <file> - Display first lines
 * - tail <file> - Display last lines
 */

import type { OpenFileEvent } from "@/components/monaco-vfs-editor";

// ============================================================================
// Types
// ============================================================================

export interface TerminalCommandHandler {
  command: string;
  description: string;
  handler: (args: string[], context: TerminalContext) => Promise<TerminalResult>;
}

export interface TerminalContext {
  currentPath: string;
  ownerId?: string;
  filesystemScopePath?: string;
  onOpenFile?: (event: OpenFileEvent) => void;
  onOutput?: (output: string) => void;
  onError?: (error: string) => void;
}

export interface TerminalResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode: number;
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Open file in Monaco editor
 */
const handleOpenFile = async (
  command: string,
  args: string[],
  context: TerminalContext
): Promise<TerminalResult> => {
  const filePath = args[0];

  if (!filePath) {
    return {
      success: false,
      error: `Usage: ${command} <file>`,
      exitCode: 1,
    };
  }

  // Resolve relative path
  const resolvedPath = filePath.startsWith("/")
    ? filePath
    : `${context.currentPath}/${filePath}`.replace(/\/+/g, "/");

  // Notify parent to open editor
  context.onOpenFile?.({
    filePath: resolvedPath,
    source: "terminal",
    terminalCommand: `${command} ${args.join(" ")}`,
  });

  return {
    success: true,
    output: `Opening ${resolvedPath} in editor...`,
    exitCode: 0,
  };
};

/**
 * Display file content (cat)
 */
const handleCat = async (
  command: string,
  args: string[],
  context: TerminalContext
): Promise<TerminalResult> => {
  const filePath = args[0];

  if (!filePath) {
    return {
      success: false,
      error: `Usage: ${command} <file>`,
      exitCode: 1,
    };
  }

  try {
    // In production, this would fetch from VFS
    const resolvedPath = filePath.startsWith("/")
      ? filePath
      : `${context.currentPath}/${filePath}`.replace(/\/+/g, "/");

    context.onOutput?.(`[Would display content of ${resolvedPath}]`);
    context.onOpenFile?.({
      filePath: resolvedPath,
      source: "terminal",
      terminalCommand: `${command} ${args.join(" ")}`,
    });

    return {
      success: true,
      output: `Content of ${resolvedPath} opened in editor`,
      exitCode: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
      exitCode: 1,
    };
  }
};

/**
 * Display first N lines of file (head)
 */
const handleHead = async (
  command: string,
  args: string[],
  context: TerminalContext
): Promise<TerminalResult> => {
  const filePath = args.find(a => !a.startsWith("-"));
  const linesArg = args.find(a => a.startsWith("-n ") || a === "-n");
  const lines = linesArg ? parseInt(linesArg.replace("-n ", "")) : 10;

  if (!filePath) {
    return {
      success: false,
      error: `Usage: ${command} [-n N] <file>`,
      exitCode: 1,
    };
  }

  try {
    const resolvedPath = filePath.startsWith("/")
      ? filePath
      : `${context.currentPath}/${filePath}`.replace(/\/+/g, "/");

    context.onOutput?.(`[First ${lines} lines of ${resolvedPath}]`);
    context.onOpenFile?.({
      filePath: resolvedPath,
      source: "terminal",
      terminalCommand: `${command} ${args.join(" ")}`,
    });

    return {
      success: true,
      output: `Opening ${resolvedPath} (showing first ${lines} lines)`,
      exitCode: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
      exitCode: 1,
    };
  }
};

/**
 * Display last N lines of file (tail)
 */
const handleTail = async (
  command: string,
  args: string[],
  context: TerminalContext
): Promise<TerminalResult> => {
  const filePath = args.find(a => !a.startsWith("-"));
  const linesArg = args.find(a => a.startsWith("-n ") || a === "-n");
  const lines = linesArg ? parseInt(linesArg.replace("-n ", "")) : 10;

  if (!filePath) {
    return {
      success: false,
      error: `Usage: ${command} [-n N] <file>`,
      exitCode: 1,
    };
  }

  try {
    const resolvedPath = filePath.startsWith("/")
      ? filePath
      : `${context.currentPath}/${filePath}`.replace(/\/+/g, "/");

    context.onOutput?.(`[Last ${lines} lines of ${resolvedPath}]`);
    context.onOpenFile?.({
      filePath: resolvedPath,
      source: "terminal",
      terminalCommand: `${command} ${args.join(" ")}`,
    });

    return {
      success: true,
      output: `Opening ${resolvedPath} (showing last ${lines} lines)`,
      exitCode: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
      exitCode: 1,
    };
  }
};

// ============================================================================
// Exported Command Registry
// ============================================================================

export const terminalCommandHandlers: TerminalCommandHandler[] = [
  {
    command: "xdg-open",
    description: "Open file in default editor",
    handler: (args, context) => handleOpenFile("xdg-open", args, context),
  },
  {
    command: "gedit",
    description: "Open file in GNOME text editor",
    handler: (args, context) => handleOpenFile("gedit", args, context),
  },
  {
    command: "edit",
    description: "Open file in editor",
    handler: (args, context) => handleOpenFile("edit", args, context),
  },
  {
    command: "code",
    description: "Open file in VS Code style editor",
    handler: (args, context) => handleOpenFile("code", args, context),
  },
  {
    command: "vim",
    description: "Open file in Vim-style editor (Monaco)",
    handler: (args, context) => handleOpenFile("vim", args, context),
  },
  {
    command: "nano",
    description: "Open file in Nano-style editor (Monaco)",
    handler: (args, context) => handleOpenFile("nano", args, context),
  },
  {
    command: "cat",
    description: "Display file content",
    handler: (args, context) => handleCat("cat", args, context),
  },
  {
    command: "head",
    description: "Display first N lines of file",
    handler: (args, context) => handleHead("head", args, context),
  },
  {
    command: "tail",
    description: "Display last N lines of file",
    handler: (args, context) => handleTail("tail", args, context),
  },
];

/**
 * Get handler for command
 */
export function getTerminalHandler(command: string): TerminalCommandHandler | undefined {
  return terminalCommandHandlers.find(h => h.command === command);
}

/**
 * Check if command opens a file in editor
 */
export function isEditorCommand(command: string): boolean {
  return ["xdg-open", "gedit", "edit", "code", "vim", "nano"].includes(command);
}

/**
 * Execute terminal command
 */
export async function executeTerminalCommand(
  commandLine: string,
  context: TerminalContext
): Promise<TerminalResult> {
  const parts = commandLine.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  const handler = getTerminalHandler(command);

  if (!handler) {
    return {
      success: false,
      error: `Command not found: ${command}`,
      exitCode: 127,
    };
  }

  try {
    return await handler.handler(args, context);
  } catch (error) {
    return {
      success: false,
      error: `Command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      exitCode: 1,
    };
  }
}

export default terminalCommandHandlers;
