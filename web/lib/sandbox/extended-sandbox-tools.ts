/**
 * Extended Sandbox Tools
 *
 * Extends `ENHANCED_SANDBOX_TOOLS` with:
 * - Terminal / PTY session management
 * - Project analysis (framework detection, script listing, dependency analysis)
 * - Port status checking
 *
 * These tools let the LLM:
 * - Start a dev server and monitor its output interactively
 * - Detect project structure and recommended commands
 * - Check listening ports and running processes
 * - Navigate TUIs and interactive programs
 */

import { ENHANCED_SANDBOX_TOOLS } from './enhanced-sandbox-tools';

/**
 * Tool definition format matching ENHANCED_SANDBOX_TOOLS.
 */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  validate?: (args: any, workspaceDir?: string) => { valid: boolean; reason?: string };
}

/**
 * Terminal / PTY session tools
 */
export const TERMINAL_TOOLS: ToolDefinition[] = [
  {
    name: 'terminal_create_session',
    description: 'Create a new interactive terminal session (PTY if available). ' +
      'Use for interactive tasks: running dev servers, navigating TUIs, monitoring long-running processes. ' +
      'Returns a sessionId for subsequent send_input/get_output calls.',
    parameters: {
      type: 'object',
      properties: {
        cols: { type: 'number', description: 'Terminal width in columns', default: 120 },
        rows: { type: 'number', description: 'Terminal height in rows', default: 30 },
        cwd: { type: 'string', description: 'Initial working directory' },
      },
      required: [],
    },
  },
  {
    name: 'terminal_send_input',
    description: 'Send keystrokes or input to an active terminal session. ' +
      'Use for interactive programs: answering prompts, navigating menus, sending Ctrl+C. ' +
      'Include \\n in the input for Enter.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Terminal session ID from terminal_create_session' },
        input: { type: 'string', description: 'Input to send (include \\n for Enter)' },
      },
      required: ['sessionId', 'input'],
    },
  },
  {
    name: 'terminal_get_output',
    description: 'Read recent output from a terminal session. ' +
      'Can optionally wait for a specific pattern to appear in the output (e.g., "listening on port 3000").',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Terminal session ID' },
        lines: { type: 'number', description: 'Number of recent lines to retrieve', default: 100 },
        waitForPattern: { type: 'string', description: 'Wait until this pattern appears in output' },
        timeoutMs: { type: 'number', description: 'Max wait time for pattern in milliseconds', default: 30000 },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'terminal_resize',
    description: 'Resize a terminal session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Terminal session ID' },
        cols: { type: 'number', description: 'New width in columns' },
        rows: { type: 'number', description: 'New height in rows' },
      },
      required: ['sessionId', 'cols', 'rows'],
    },
  },
  {
    name: 'terminal_close_session',
    description: 'Close/terminate an active terminal session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Terminal session ID to close' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'terminal_list_sessions',
    description: 'List all active terminal sessions with their status and detected ports.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

/**
 * Project analysis tools
 */
export const PROJECT_ANALYSIS_TOOLS: ToolDefinition[] = [
  {
    name: 'project_analyze',
    description: 'Analyze the project at the workspace root. ' +
      'Detects framework, package manager, entry points, config files, dependencies, ' +
      'and returns recommended commands for install/run/test/build. ' +
      'Use this before running commands to understand the project structure.',
    parameters: {
      type: 'object',
      properties: {
        includeDependencies: {
          type: 'boolean',
          description: 'Include full dependency list in output',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'project_list_scripts',
    description: 'List all runnable scripts/tasks in the project. ' +
      'Includes npm scripts, Makefile targets, pyproject.toml tasks, deno tasks, ' +
      'cargo commands, go tasks, turbo and nx tasks. ' +
      'Use this to discover what commands are available.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'project_dependencies',
    description: 'List installed dependencies and detect issues like missing packages, ' +
      'version conflicts, missing lock files.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'project_structure',
    description: 'Get the file tree of the project with semantic understanding. ' +
      'Returns a text summary of top-level structure and notable files (configs, entry points, docs).',
    parameters: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', description: 'Maximum tree depth', default: 5 },
        summaryOnly: {
          type: 'boolean',
          description: 'Return only text summary, not full tree',
          default: false,
        },
      },
      required: [],
    },
  },
];

/**
 * Port / network status tools
 */
export const PORT_TOOLS: ToolDefinition[] = [
  {
    name: 'port_status',
    description: 'Check which ports are listening in the sandbox and what processes own them. ' +
      'Use after starting a dev server to verify it is running.',
    parameters: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'Specific port to check (omit for all)' },
      },
      required: [],
    },
  },
];

/**
 * All extended sandbox tools (base + terminal + project analysis + port).
 */
export const EXTENDED_SANDBOX_TOOLS: ToolDefinition[] = [
  ...ENHANCED_SANDBOX_TOOLS,
  ...TERMINAL_TOOLS,
  ...PROJECT_ANALYSIS_TOOLS,
  ...PORT_TOOLS,
];

/**
 * Map extended tool names to capability IDs.
 * Includes all legacy tool mappings from the old toolNameToCapability function
 * in agent-loop.ts so nothing breaks.
 */
const EXTENDED_TOOL_TO_CAPABILITY: Record<string, string> = {
  // Legacy tool mappings (from old agent-loop.ts toolNameToCapability)
  exec_shell: 'sandbox.shell',
  write_file: 'file.write',
  read_file: 'file.read',
  list_dir: 'file.list',
  run_code: 'code.run',
  git_clone: 'repo.clone',
  git_status: 'repo.git',
  git_commit: 'repo.commit',
  git_push: 'repo.push',
  start_process: 'process.start',
  stop_process: 'process.stop',
  list_processes: 'process.list',
  search_files: 'file.search',
  sync_files: 'file.sync',
  mcp_list_tools: 'mcp.list',
  mcp_call_tool: 'mcp.call',
  computer_use_click: 'computer_use.click',
  computer_use_type: 'computer_use.type',
  computer_use_screenshot: 'computer_use.screenshot',
  computer_use_scroll: 'computer_use.scroll',
  get_previews: 'preview.get',
  forward_port: 'preview.forward_port',
  // New terminal / PTY tools
  terminal_create_session: 'terminal.create_session',
  terminal_send_input: 'terminal.send_input',
  terminal_get_output: 'terminal.get_output',
  terminal_resize: 'terminal.resize',
  terminal_close_session: 'terminal.close_session',
  terminal_list_sessions: 'terminal.list_sessions',
  // New project analysis tools
  project_analyze: 'project.analyze',
  project_list_scripts: 'project.list_scripts',
  project_dependencies: 'project.dependencies',
  project_structure: 'project.structure',
  // New port status tool
  port_status: 'terminal.get_port_status',
};

/**
 * Resolve capability ID for a tool name, falling back to the tool name itself.
 */
export function mapToolToCapability(toolName: string): string {
  return EXTENDED_TOOL_TO_CAPABILITY[toolName] || toolName;
}

/**
 * Get the description for a tool (for system prompt injection).
 */
export function getToolDescription(toolName: string): string | undefined {
  const allTools = [...TERMINAL_TOOLS, ...PROJECT_ANALYSIS_TOOLS, ...PORT_TOOLS];
  return allTools.find(t => t.name === toolName)?.description;
}
