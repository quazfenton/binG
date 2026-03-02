import { tool } from 'ai';
import { z } from 'zod';

export interface ToolContext {
  sandboxHandle?: any;
  vfs?: Record<string, string>;
  transactionLog?: Array<{
    path: string;
    type: 'UPDATE' | 'CREATE' | 'DELETE';
    timestamp: number;
    originalContent?: string;
    newContent?: string;
    search?: string;
    replace?: string;
  }>;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  content?: string;
  error?: string;
  exitCode?: number;
  blocked?: boolean;
}

/**
 * Note: These tool definitions are designed to be used with the ToolExecutor.
 * When called directly through AI SDK's streamText/generateText, they return
 * structured responses that the agent can interpret.
 * 
 * For actual execution with sandboxHandle, use ToolExecutor.execute() instead.
 */

export const readFileTool = tool({
  description: `Read the contents of a file in the sandbox workspace.

USE CASES:
- Understand existing code before making changes
- Check file contents during discovery phase
- Verify changes after editing

TIP: Use list_files first to discover file paths if you're unsure.`,
  parameters: z.object({
    path: z.string().describe('File path relative to workspace root'),
  }),
  execute: async ({ path }, { messages, toolCallId }) => {
    // When called through AI SDK, the actual execution happens via ToolExecutor
    // This is a fallback that provides guidance
    return {
      type: 'file_read_request',
      path,
      message: `To read ${path}, ensure you have sandbox context. The ToolExecutor will handle actual file reading.`,
    };
  },
});

export const listFilesTool = tool({
  description: `List files and directories at the given path.

USE CASES:
- Discover project structure
- Find files matching a pattern
- Explore unknown codebases

EXAMPLE:
{
  "path": "src/components",
  "pattern": "*.tsx"
}`,
  parameters: z.object({
    path: z.string().optional().describe('Directory path (default: root)'),
    pattern: z.string().optional().describe('Glob pattern to filter files (e.g., "*.ts", "*.tsx")'),
  }),
  execute: async ({ path, pattern }) => {
    return {
      type: 'list_files_request',
      path: path || '.',
      pattern,
      message: 'File listing will be provided by ToolExecutor with sandbox context',
    };
  },
});

export const createFileTool = tool({
  description: `Create a NEW file in the sandbox workspace.

USE CASES:
- Create new component files
- Add configuration files
- Generate test files

IMPORTANT: Only use for NEW files. For existing files, use apply_diff.`,
  parameters: z.object({
    path: z.string().describe('File path where the new file will be created'),
    content: z.string().describe('Complete file content'),
  }),
  execute: async ({ path, content }) => {
    return {
      type: 'create_file_request',
      path,
      content,
      message: `File creation request for ${path}. ToolExecutor will handle actual creation.`,
    };
  },
});

export const applyDiffTool = tool({
  description: `Surgically edit a file by replacing specific code blocks.

USE THIS for existing files - it prevents context truncation and is more reliable.

HOW TO USE:
1. Read the file first to understand its content
2. Copy the EXACT code you want to replace (including whitespace)
3. Provide the new code to replace it with
4. Explain your reasoning in the "thought" parameter

EXAMPLE:
{
  "path": "src/utils.ts",
  "search": "function oldName() {\\n  return 1;\\n}",
  "replace": "function newName() {\\n  return 2;\\n}",
  "thought": "Renaming function to match new API convention"
}

TIPS:
- Include 3-5 lines of context for unique identification
- Match exact whitespace and indentation
- Be specific to avoid accidental matches`,
  parameters: z.object({
    path: z.string().describe('File path to edit'),
    search: z.string().describe('Exact code to find and replace (include context)'),
    replace: z.string().describe('New code to insert'),
    thought: z.string().describe('Explain WHY this change is needed and WHAT it does'),
  }),
  execute: async ({ path, search, replace, thought }) => {
    return {
      type: 'apply_diff_request',
      path,
      search,
      replace,
      thought,
      message: `Diff application request for ${path}. ToolExecutor will validate and apply the change.`,
    };
  },
});

export const execShellTool = tool({
  description: `Execute a shell command in the sandbox.

USE CASES:
- Run build commands (npm run build)
- Execute tests (npm test)
- Install dependencies (npm install)
- Run scripts

SECURITY: Some dangerous commands are blocked:
- rm -rf /
- mkfs commands
- Direct disk access

EXAMPLE:
{
  "command": "npm run build",
  "cwd": "/workspace/my-project"
}`,
  parameters: z.object({
    command: z.string().describe('Shell command to execute'),
    cwd: z.string().optional().describe('Working directory (default: sandbox root)'),
  }),
  execute: async ({ command, cwd }) => {
    return {
      type: 'exec_shell_request',
      command,
      cwd,
      message: `Shell execution request: ${command}. ToolExecutor will execute with security checks.`,
    };
  },
});

export const syntaxCheckTool = tool({
  description: `Run syntax validation on modified files.

USE CASES:
- Verify changes compile correctly
- Catch syntax errors before committing
- Validate JSON/YAML files

SUPPORTED: TypeScript, JavaScript, JSON, YAML, HTML, CSS`,
  parameters: z.object({
    paths: z.array(z.string()).describe('Array of file paths to check'),
  }),
  execute: async ({ paths }) => {
    return {
      type: 'syntax_check_request',
      paths,
      message: `Syntax check requested for ${paths.length} files. ToolExecutor will validate.`,
    };
  },
});

export const requestApprovalTool = tool({
  description: `Request human approval for sensitive operations.

USE CASES:
- Deleting files
- Overwriting critical files
- Executing potentially destructive commands
- Creating files with secrets

This tool creates an approval request that must be resolved before proceeding.`,
  parameters: z.object({
    action: z.enum(['delete', 'overwrite', 'execute_destructive', 'create_secret']).describe('Type of action requiring approval'),
    target: z.string().describe('Target of the action (file path, command, etc.)'),
    reason: z.string().describe('Why this action is needed'),
    diff: z.string().optional().describe('Preview of changes (for edit operations)'),
  }),
  execute: async ({ action, target, reason, diff }) => {
    return {
      requires_approval: true,
      approval_request: {
        id: crypto.randomUUID(),
        action,
        target,
        reason,
        diff,
        requested_at: new Date().toISOString(),
        status: 'pending',
      },
      message: `Waiting for approval to ${action} ${target}`,
    };
  },
});

export const discoveryTool = tool({
  description: `Analyze project files to understand current state.

USE THIS at the start of any task to:
- Understand project structure
- Identify relevant files
- Plan your approach

Call this before making any changes.`,
  parameters: z.object({
    files_to_analyze: z.array(z.string()).describe('List of file paths to analyze'),
    proposed_task: z.string().describe('Description of the task you plan to do'),
  }),
  execute: async ({ files_to_analyze, proposed_task }) => {
    return {
      type: 'discovery_request',
      files_to_analyze,
      proposed_task,
      message: `Discovery phase: Will analyze ${files_to_analyze.length} files for task: ${proposed_task}`,
    };
  },
});

export const createPlanTool = tool({
  description: `Create a structured plan file - REQUIRED before making edits.

This tool helps you think through changes systematically:
1. Define the task clearly
2. List all files involved
3. Determine execution order
4. Plan for rollback if needed

Call this after discovery and before any edits.`,
  parameters: z.object({
    task: z.string().describe('Clear description of what needs to be done'),
    files: z.array(z.object({
      path: z.string(),
      action: z.enum(['read', 'edit', 'create', 'delete']),
      reason: z.string(),
    })).describe('List of files to modify with actions'),
    execution_order: z.array(z.string()).describe('Ordered list of file paths to process'),
    rollback_plan: z.string().describe('How to revert if something goes wrong'),
  }),
  execute: async ({ task, files, execution_order, rollback_plan }) => {
    return {
      success: true,
      plan: {
        version: '1.0',
        created_at: new Date().toISOString(),
        task,
        files,
        execution_order,
        rollback_plan,
      },
    };
  },
});

export const commitTool = tool({
  description: 'Commit VFS changes to production storage.',
  parameters: z.object({
    session_id: z.string().describe('Session identifier'),
    message: z.string().describe('Commit message describing the changes'),
  }),
  execute: async ({ session_id, message }) => {
    return {
      type: 'commit_request',
      session_id,
      message,
      note: 'Commit will be processed by ShadowCommitManager',
    };
  },
});

export const rollbackTool = tool({
  description: 'Rollback to a previous commit state.',
  parameters: z.object({
    session_id: z.string().describe('Session identifier'),
    commit_id: z.string().describe('Commit ID to rollback to'),
  }),
  execute: async ({ session_id, commit_id }) => {
    return {
      type: 'rollback_request',
      session_id,
      commit_id,
      note: 'Rollback will be processed by ShadowCommitManager',
    };
  },
});

export const historyTool = tool({
  description: 'Get commit history for a session.',
  parameters: z.object({
    session_id: z.string().describe('Session identifier'),
    limit: z.number().optional().describe('Maximum number of commits to return (default: 10)'),
  }),
  execute: async ({ session_id, limit }) => {
    return {
      type: 'history_request',
      session_id,
      limit,
      note: 'History will be retrieved from ShadowCommitManager',
    };
  },
});

export const allTools = {
  readFile: readFileTool,
  listFiles: listFilesTool,
  createFile: createFileTool,
  applyDiff: applyDiffTool,
  execShell: execShellTool,
  syntaxCheck: syntaxCheckTool,
  requestApproval: requestApprovalTool,
  discovery: discoveryTool,
  createPlan: createPlanTool,
  commit: commitTool,
  rollback: rollbackTool,
  history: historyTool,
};
