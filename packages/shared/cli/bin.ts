#!/usr/bin/env node

/**
 * binG CLI - Agentic Workspace Command Line Interface
 *
 * A powerful CLI tool that integrates all binG features:
 * - Chat with AI agents (OpenAI, Anthropic, Google, Mistral, GitHub, NVIDIA NIM, etc.)
 * - Sandbox management (Daytona, E2B, Blaxel, Sprites, CodeSandbox, WebContainer, OpenSandbox, etc.)
 * - Filesystem operations (read, write, sync, snapshots, VFS)
 * - Voice features (TTS, speech-to-text)
 * - Image generation (Replicate, Mistral)
 * - Tool execution (Composio, Nango, Arcade, Smithery, MCP)
 * - Workflow orchestration (Mastra, n8n)
 * - OAuth integrations (GitHub, Google, Notion, etc.)
 * - Multi-provider fallback (automatic failover between providers)
 * - Circuit breaker protection for providers
 * - Quota management and cost tracking
 *
 * @see https://github.com/quazfenton/binG
 */

import { Command } from 'commander';
import { createInterface } from 'readline';
import { stdin as input, stdout as output, cwd } from 'process';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

// __dirname and __filename - works in both development and bundled (pkg) modes
// In bundled mode, process.execPath points to the executable, so we use that
// In development mode, __dirname is available from tsx/ts-node
function getDirname(): string {
  // Check if we're in a bundled environment (pkg sets PKG_EXECPATH)
  if (process.env.PKG_EXECPATH) {
    return path.dirname(process.execPath);
  }
  // Check for Windows executable path in the execPath
  if (process.platform === 'win32' && process.execPath.includes('.exe')) {
    return path.dirname(process.execPath);
  }
  // Standard __dirname from CommonJS or tsx
  return __dirname;
}

const __dirname = getDirname();
const __filename = process.argv[1] || '';
import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import FormData from 'form-data';
import { Readable } from 'stream';

// RTK CLI Commands - Token-optimized command execution for LLM consumption
import { registerRTKCommands } from "./lib/rtk-cli-commands.js";

// Load environment variables
dotenv.config();

// ============================================================================
// Local Mode Detection (hoisted — used throughout the file)
// ============================================================================

const localMode = detectLocalMode();

function detectLocalMode(): { isLocal: boolean; isDesktop: boolean; workspace: string } {
  const isLocal = !process.env.VERCEL && !process.env.VERCEL_ENV && process.env.NODE_ENV !== "production";
  const isDesktop = !!process.env.DESKTOP_MODE || !!process.env.DESKTOP_LOCAL_EXECUTION;
  // Priority: INITIAL_CWD (set by Tauri sidecar) > DESKTOP_WORKSPACE_ROOT > WORKSPACE_ROOT > CWD fallback
  const workspace = process.env.INITIAL_CWD || process.env.DESKTOP_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT ||
    process.cwd();
  return { isLocal, isDesktop, workspace };
}

// CLI Configuration
const CLI_VERSION = '1.2.2';
const DEFAULT_API_BASE = process.env.BING_API_URL || 'http://localhost:3000/api';

// Config locations - prefer ~/.quaz for user data
const USER_HOME = process.env.HOME || process.env.USERPROFILE || '';
const QUAZ_DIR = path.join(USER_HOME, '.quaz');
const OLD_CONFIG_DIR = path.join(USER_HOME, '.bing-cli');
const CONFIG_DIR = fs.existsSync(QUAZ_DIR) ? QUAZ_DIR : (fs.existsSync(OLD_CONFIG_DIR) ? OLD_CONFIG_DIR : QUAZ_DIR);
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const KEYS_FILE = path.join(CONFIG_DIR, 'keys.json'); // BYOK keys storage

// Ensure config directory exists
fs.ensureDirSync(CONFIG_DIR);

// WebSocket Terminal - interactive terminal for sandboxes
// Supports both remote (server) and local (Tauri) modes
async function websocketTerminal(sandboxId: string, options?: { tauri?: boolean; cwd?: string }): Promise<void> {
  const auth = loadAuth();

  if (!sandboxId) {
    console.log(COLORS.error('Sandbox ID required'));
    process.exit(1);
  }

  console.log(chalk.cyanBright('\n=== binG WebSocket Terminal ===\n'));

  // Tauri mode: use PTY session via Tauri invoke
  if (options?.tauri || localMode.isDesktop) {
    try {
      // Dynamically import Tauri invoke if available
      const { invoke } = await import('@tauri-apps/api/core').catch(() => ({ invoke: null }));
      
      if (invoke) {
        console.log(COLORS.info('Using Tauri PTY session (local mode)'));
        
        // Create PTY session
        const ptyResult = await invoke<{ session_id: string; success: boolean; error?: string }>(
          'create_pty_session',
          { cols: 120, rows: 30, cwd: options?.cwd || getWorkspaceRoot(), shell: null }
        );
        
        if (!ptyResult.success || !ptyResult.session_id) {
          console.log(COLORS.error(`Failed to create PTY session: ${ptyResult.error}`));
          process.exit(1);
        }
        
        const sessionId = ptyResult.session_id;
        console.log(COLORS.success(`✓ PTY session created: ${sessionId}`));
        console.log(COLORS.info('Type commands and press Enter\n'));

        // Set up terminal input
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        
        process.stdin.on('data', async (data) => {
          try {
            await invoke('write_pty_input', { sessionId, data: data.toString() });
          } catch (err: unknown) {
            console.log(COLORS.error(`Write error: ${err}`));
          }
        });

        // Listen for PTY output via Tauri events (handled by Tauri sidecar)
        // For now, use polling approach with periodic output reads
        let active = true;
        const pollInterval = setInterval(async () => {
          if (!active) {
            clearInterval(pollInterval);
            return;
          }
          try {
            // Send empty input to trigger output read
            // In a full implementation, this would use event listeners
          } catch {
            // Ignore polling errors
          }
        }, 100);

        process.on('SIGINT', async () => {
          active = false;
          clearInterval(pollInterval);
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          try {
            await invoke('close_pty_session', { sessionId });
          } catch {}
          console.log(COLORS.info('\nPTY session closed'));
          process.exit(0);
        });

        return;
      }
    } catch (err: unknown) {
      console.log(COLORS.warning(`Tauri mode unavailable: ${err}`));
      console.log(COLORS.info('Falling back to server mode...'));
    }
  }

  // Server mode: use WebSocket via API
  console.log(COLORS.info(`Connecting to sandbox: ${sandboxId}`));

  try {
    const sessionResponse = await apiRequest('/sandbox/terminal', { method: 'POST', data: {} });
    const sessionId = sessionResponse.sessionId || sessionResponse.id;
    const actualSandboxId = sessionResponse.sandboxId || sandboxId;

    if (!sessionId) {
      console.log(COLORS.error('Failed to create terminal session'));
      process.exit(1);
    }

    const wsInfo = await apiRequest(
      `/sandbox/terminal/ws?sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(actualSandboxId)}`,
      { method: 'GET' }
    );

    const wsUrl = wsInfo.wsUrl || wsInfo.url || `ws://localhost:3001/ws?sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(actualSandboxId)}`;
    const ws = new WebSocket(wsUrl, { headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {} });

    ws.on('open', () => {
      console.log(COLORS.success('✓ Connected to terminal'));
      console.log(COLORS.info('Type commands and press Enter\n'));

      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'input', data: data.toString() }));
      });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pty' || msg.type === 'output') process.stdout.write(msg.data);
        else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        else if (msg.type === 'error') console.log(COLORS.error(msg.data));
      } catch { process.stdout.write(data.toString()); }
    });

    ws.on('close', () => {
      if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
      console.log(COLORS.info('\nDisconnected from terminal'));
      process.exit(0);
    });

    ws.on('error', (err) => { console.log(COLORS.error(`WebSocket error: ${err.message}`)); process.exit(1); });
    process.on('SIGINT', () => { if (process.stdin.isTTY) process.stdin.setRawMode(false); ws.close(); process.exit(0); });
  } catch (error: any) {
    console.log(COLORS.error(`Failed to connect: ${error.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Global Error Handling & Input Validation
// ============================================================================

function handleError(error: any, context?: string): void {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      if (status === 401) {
        console.log(COLORS.error('\nAuthentication required. Run: bing login'));
        return;
      }
      if (status === 403) {
        console.log(COLORS.error('\nAccess denied. You don\'t have permission for this operation.'));
        return;
      }
      if (status === 404) {
        console.log(COLORS.error('\nResource not found. Check the name/id and try again.'));
        return;
      }
      if (status === 422) {
        console.log(COLORS.error(`\nInvalid input: ${data?.error?.message || data?.message || JSON.stringify(data)}`));
        return;
      }
      if (status === 429) {
        console.log(COLORS.warning('\nRate limited. Wait a moment and try again.'));
        return;
      }
      if (status >= 500) {
        console.log(COLORS.error('\nServer error. Try again later.'));
        return;
      }
      console.log(COLORS.error(`\nAPI Error (${status}): ${data?.error || data?.message || error.message}`));
      return;
    }
    if (error.code === 'ECONNREFUSED') {
      console.log(COLORS.error('\nCannot connect to server. Is it running?'));
      console.log(COLORS.info(`Expected: ${DEFAULT_API_BASE}`));
      return;
    }
    if (error.code === 'ETIMEDOUT') {
      console.log(COLORS.error('\nRequest timed out. The server is taking too long to respond.'));
      return;
    }
  }
  if (error instanceof SyntaxError) {
    console.log(COLORS.error('\nInvalid JSON response from server.'));
    return;
  }
  if (context) {
    console.log(COLORS.error(`\nError ${context}: ${error.message}`));
    return;
  }
  console.log(COLORS.error(`\nError: ${error.message}`));
}

function validateRequired(value: any, name: string, description?: string): boolean {
  if (!value || (typeof value === 'string' && !value.trim())) {
    console.log(COLORS.error(`\nError: ${name} is required${description ? '. ' + description : ''}`));
    return false;
  }
  return true;
}

function validatePath(filePath: string, mustExist = false): boolean {
  if (!filePath || !filePath.trim()) {
    console.log(COLORS.error('\nError: Path cannot be empty.'));
    return false;
  }
  if (mustExist && !fs.existsSync(filePath)) {
    console.log(COLORS.error(`\nError: File not found: ${filePath}`));
    return false;
  }
  return true;
}

function safeParseJSON(input: string): any | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ============================================================================
// Local VFS Manager Integration (reuses existing lib/local-vfs-manager.ts)
// ============================================================================

const LOCAL_VFS_LIB = path.join(__dirname, 'lib', 'local-vfs-manager.ts');

let localVFSManager: any = null;

async function getLocalVFS() {
  if (!localVFSManager) {
    try {
      const { LocalVFSManager } = await import(LOCAL_VFS_LIB);
      localVFSManager = new LocalVFSManager(process.cwd());
    } catch {
      return null;
    }
  }
  return localVFSManager;
}

// ============================================================================
// SSE Event Parsing for CLI (matches file-edit-parser.ts and sse-event-schema.ts)
// ============================================================================

const SSE_EVENT_TYPES = {
  TOKEN: 'token',
  FILE_EDIT: 'file_edit',
  DONE: 'done',
  ERROR: 'error',
  STEP: 'step',
  FILESYSTEM: 'filesystem',
  DIFFS: 'diffs',
  TOOL_INVOCATION: 'tool_invocation',
  REASONING: 'reasoning',
  PRIMARY_DONE: 'primary_done',
  HEARTBEAT: 'heartbeat',
};

interface FileEditEvent {
  path: string;
  content?: string;
  search?: string;
  replace?: string;
  type?: 'create' | 'update' | 'delete';
}

// ============================================================================
// VFS MCP Tools Initialization (reuses web/lib/mcp/vfs-mcp-tools.ts)
// ============================================================================

// Resolve vfs-mcp-tools.ts from multiple candidate locations to handle both
// source (packages/shared/cli/) and compiled (packages/shared/cli/dist/) layouts.
// VFS MCP tools path resolution - tries multiple candidate locations
const MCP_TOOLS_PATH = (() => {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'web', 'lib', 'mcp', 'vfs-mcp-tools.ts'),   // source layout
    path.join(__dirname, '..', '..', '..', '..', 'web', 'lib', 'mcp', 'vfs-mcp-tools.ts'), // dist layout
    path.join(__dirname, '..', '..', '..', '..', 'web', 'lib', 'mcp', 'vfs-mcp-tools.js'), // compiled js
  ];
  // Use fs.existsSync directly (not require) for ESM compatibility
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
})();

let vfsToolsInitialized = false;
let vfsToolDefs: any[] = [];

async function initializeVFSMCP(userId: string, sessionId: string): Promise<void> {
  if (vfsToolsInitialized) return;
  
  console.log(COLORS.info('Initializing VFS MCP tools...'));
  
  try {
    const { getVFSToolDefinitions, initializeVFSTools } = await import(MCP_TOOLS_PATH);
    initializeVFSTools(userId, sessionId, process.cwd());
    vfsToolDefs = getVFSToolDefinitions();
    vfsToolsInitialized = true;
    console.log(COLORS.success('✓ VFS MCP tools initialized'));
    console.log(COLORS.info(`  Workspace: ${getWorkspaceRoot()}`));
    console.log(COLORS.info(`  Tools: ${vfsToolDefs.length} available`));
  } catch (err) {
    console.log(COLORS.warning('⚠ VFS MCP tools initialization failed'));
    console.log(COLORS.muted(`  Error: ${(err as Error).message}`));
    console.log(COLORS.muted(`  Path: ${MCP_TOOLS_PATH}`));
    console.log(COLORS.info('  Note: CLI will use direct filesystem operations instead'));
  }
}

function getVFSTools(): any[] {
  return vfsToolDefs;
}

// ============================================================================
// Emit filesystem events to server (for unified frontend handling)
// ============================================================================

async function emitFilesystemEvent(eventData: {
  path: string;
  type: 'create' | 'update' | 'delete';
  content?: string;
  source: string;
}): Promise<void> {
  // In desktop/CLI local modes, only commit to local git history in ~/.quaz/
  // Do NOT save user files to the server database — privacy, storage, and load concerns.
  if (localMode.isLocal || localMode.isDesktop) {
    try {
      const vfs = await getLocalVFS();
      if (vfs && eventData.content !== undefined) {
        await vfs.commitToHistory(eventData.path, eventData.content);
      }
    } catch {
      // Local history commit failed — non-critical
    }
    return; // Do NOT push to server DB in local modes
  }
  // Web mode: push to server for cross-session sync
  try {
    const config = loadConfig();
    await apiRequest('/filesystem/events/push', {
      method: 'POST',
      data: {
        path: eventData.path,
        type: eventData.type,
        source: eventData.source,
        applied: { content: eventData.content },
        emittedAt: Date.now(),
        sessionId: 'cli-session',
      },
    });
  } catch {
    // Non-critical - continue even if event emission fails
  }
}

// ============================================================================
// Text-Mode Fallback Prompt for non-MCP-capable models
// ============================================================================

const TEXT_MODE_FALLBACK_PROMPT = `
IMPORTANT - If MCP tools fail, use these BASH commands instead:

FILE OPERATIONS:
- Write file: \`echo "content" > /path/to/file\`
- Read file: \`cat /path/to/file\`
- Create dir: \`mkdir -p /path/to/dir\`
- Delete file: \`rm /path/to/file\`
- Delete dir: \`rm -rf /path/to/dir\`
- List dir: \`ls -la /path/to/dir\`
- Search: \`grep -r "pattern" /path\`

DIFF/PATCH:
- Apply diff: \`patch -p1 < /path/to/diff\`
- Diff files: \`diff -u oldfile newfile\`

Use ABSOLUTE paths from workspace root. Write then verify with \`cat\`.
`;

interface PendingFileEdit {
  path: string;
  originalContent?: string;
  newContent: string;
  timestamp: number;
  committed: boolean | string;
}

const pendingFileEdits: PendingFileEdit[] = [];
// Also tracked under alias pendingEdits for backward-compat
const pendingEdits: PendingFileEdit[] = pendingFileEdits;

function parseSSELine(line: string): { type: string; data: any } | null {
  if (!line.startsWith('event:') && !line.startsWith('data:')) return null;
  
  const typeMatch = line.match(/^event:\s*(\w+)/);
  const dataMatch = line.match(/^data:\s*(.+)/);
  
  if (!dataMatch) return null;
  
  try {
    const data = JSON.parse(dataMatch[1]);
    return { type: typeMatch ? typeMatch[1] : 'message', data };
  } catch {
    return { type: typeMatch ? typeMatch[1] : 'message', data: dataMatch[1] };
  }
}

function processFileEditEvent(data: FileEditEvent): void {
  if (!data.path) return;
  
  const editIndex = pendingFileEdits.findIndex(e => e.path === data.path);
  
  if (editIndex >= 0) {
    pendingFileEdits[editIndex].newContent = data.content || '';
  } else {
    pendingFileEdits.push({
      path: data.path,
      newContent: data.content || '',
      timestamp: Date.now(),
      committed: false, // Pending server confirmation
    });
  }
  
  displayFileDiffIncoming(data.path, data.content || '');
}

function displayFileDiffIncoming(path: string, content: string): void {
  const fileName = path.split(/[/\\]/).pop() || path;
  const lines = content.split('\n').slice(0, 12);
  
  console.log(`\n${COLORS.primary('═'.repeat(55))}`);
  console.log(`${COLORS.primary('📝')} ${COLORS.secondary(fileName)} ${COLORS.muted(`(${content.length} bytes)`)}`);
  console.log(`${COLORS.info(`[o] ${path}`)} ${COLORS.warning('[r] revert')}`);
  
  const maxLines = 8;
  lines.slice(0, maxLines).forEach((line, i) => {
    const prefix = line.startsWith('+') ? COLORS.success('+ ') : 
                 line.startsWith('-') ? COLORS.error('- ') : 
                 COLORS.info('  ');
    console.log(`${prefix}${line}`);
  });
  
  if (lines.length > maxLines) {
    console.log(`${COLORS.muted(`  ... ${lines.length - maxLines} more lines`)}`);
  }
  console.log(COLORS.primary('═'.repeat(55)));
}

function openFileInEditor(filePath: string): void {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'start' : 'xdg-open';
  
  spawn(cmd, [filePath], { stdio: 'inherit', shell: true })
    .on('error', () => {
      console.log(COLORS.warning(`Could not open ${filePath}`));
      console.log(COLORS.info(`Open manually: ${filePath}`));
    });
}

async function processSSEStream(response: AsyncIterable<any>): Promise<string> {
  let fullResponse = '';
  let collectedDiffs: Array<{ path: string; diff: string; changeType: string }> = new Array<{ path: string; diff: string; changeType: string }>();
  
  try {
    for await (const chunk of response) {
      const line = chunk.trim();
      if (!line) continue;
      
      const event = parseSSELine(line);
      if (!event) {
        fullResponse += line.replace(/^data:\s*/, '');
        continue;
      }
      
      switch (event.type) {
        case 'file_edit':
          case SSE_EVENT_TYPES.FILE_EDIT:
            processFileEditEvent(event.data);
            break;
          case 'done':
          case 'primary_done':
          case SSE_EVENT_TYPES.PRIMARY_DONE:
            // Return immediately — do NOT wait for stream to close
            if (pendingFileEdits.length > 0 || fullResponse) {
              console.log(`\n\n${COLORS.success('═'.repeat(55))}`);
              console.log(`${COLORS.accent('📁 File Edits:')} ${pendingFileEdits.length} file(s) modified`);
              pendingFileEdits.forEach((edit, i) => {
                const fileName = edit.path.split(/[/\\]/).pop() || edit.path;
                const shortPath = edit.path.length > 40 ? '...' + edit.path.slice(-37) : edit.path;
                console.log(`  ${i}: ${COLORS.primary(fileName)} ${COLORS.muted(shortPath)} [r] revert`);
              });
              console.log(COLORS.success('═'.repeat(55)));
              pendingFileEdits.splice(0, pendingFileEdits.length);
            }
            return fullResponse;
          }
        case 'token':
          process.stdout.write(event.data);
          fullResponse += event.data;
          break;
        case 'error':
        case SSE_EVENT_TYPES.ERROR:
          console.log(`\n${COLORS.error('Error:')} ${event.data.message || event.data}`);
          break;
        case 'step':
        case SSE_EVENT_TYPES.STEP:
          process.stdout.write(`${COLORS.info('→')} ${event.data?.step || event.data?.message || ''}\r`);
          break;
        case 'filesystem':
        case SSE_EVENT_TYPES.FILESYSTEM:
          // Filesystem mutation notification — track for post-stream diff display
          if (event.data?.path) {
            displayFileDiffIncoming(event.data.path, event.data?.applied?.content || '');
          }
          break;
        case 'diffs':
        case SSE_EVENT_TYPES.DIFFS:
          // Git-style diffs — collect for post-stream display
          if (event.data?.files) {
            for (const f of event.data.files) {
              collectedDiffs.push({ path: f.path, diff: f.diff, changeType: f.changeType });
            }
          }
          break;
        case 'tool_invocation':
        case SSE_EVENT_TYPES.TOOL_INVOCATION:
          // Tool invocation lifecycle — show tool name briefly
          if (event.data?.toolName && event.data?.state === 'call') {
            process.stdout.write(`${COLORS.accent('🔧')} ${event.data.toolName}\r`);
          }
          break;
        case 'reasoning':
        case SSE_EVENT_TYPES.REASONING:
          // Chain-of-thought — show in muted color
          if (event.data?.reasoning) {
            process.stdout.write(`${COLORS.muted('💭 ' + event.data.reasoning.slice(0, 80))}\r`);
          }
          break;
        case 'heartbeat':
        case SSE_EVENT_TYPES.HEARTBEAT:
          // Keep-alive — no action needed
          break;
        default:
          break;
      }
    }
  } catch (err: unknown) {
    // Stream errored — return what we have
    console.log(`\n${COLORS.error('Stream error:')} ${err instanceof Error ? err.message : err}`);
  }
  
  if (pendingFileEdits.length > 0) {
    console.log(`\n\n${COLORS.success('═'.repeat(55))}`);
    console.log(`${COLORS.accent('📁 File Edits:')} ${pendingFileEdits.length} file(s) modified`);
    
    // Show collected diffs (from diffs event) if any
    if (collectedDiffs.length > 0) {
      console.log(`\n${COLORS.accent('━'.repeat(55))}`);
      console.log(`${COLORS.accent('📊 Diffs:')}${collectedDiffs.length} file(s) changed`);
      collectedDiffs.forEach((d, i) => {
        const fileName = d.path.split(/[/\\]/).pop() || d.path;
        console.log(`  ${COLORS.primary(fileName)} [${d.changeType}] [r] revert`);
        const diffLines = (d.diff || '').split('\n').slice(0, 5);
        diffLines.forEach(line => {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            console.log(`    ${COLORS.success(line)}`);
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            console.log(`    ${COLORS.error(line)}`);
          } else if (line.startsWith('@@')) {
            console.log(`    ${COLORS.info(line)}`);
          }
        });
      });
      console.log(COLORS.accent('━'.repeat(55)));
    }

    pendingFileEdits.forEach((edit, i) => {
      const fileName = edit.path.split(/[/\\]/).pop() || edit.path;
      const shortPath = edit.path.length > 40 ? '...' + edit.path.slice(-37) : edit.path;
      console.log(`  ${i}: ${COLORS.primary(fileName)} ${COLORS.muted(shortPath)} [r] revert`);
    });

    console.log(`${COLORS.info('  Press [r] then edit number to revert, e.g. "r 0"')}`);
    console.log(COLORS.success('═'.repeat(55)));

    // Prompt for revert if in interactive mode
    if (pendingFileEdits.length > 0) {
      const revertInput = await prompt(COLORS.muted('Revert? (r <num> / Enter to skip): '));
      const revertMatch = revertInput.trim().match(/^r\s*(\d+)/i);
      if (revertMatch) {
        const editIndex = parseInt(revertMatch[1]);
        await handleRevertEdit(editIndex);
      }
    }
    
    // CRITICAL FIX: Clear pendingFileEdits after stream processing completes
    // This prevents old edits from persisting across chat sessions
    pendingFileEdits.splice(0, pendingFileEdits.length);
  }

  return fullResponse;
}

async function handleRevertEdit(editIndex: number): Promise<void> {
  const edit = pendingFileEdits[editIndex];
  if (!edit) {
    console.log(COLORS.error('Edit not found'));
    return;
  }
  
  const vfs = await getLocalVFS();
  if (vfs) {
    const success = await vfs.revertFile(edit.path);
    if (success) {
      console.log(COLORS.success(`Reverted: ${edit.path}`));
      return;
    }
  }
  
  console.log(COLORS.warning(`Note: Could not auto-revert ${edit.path}`));
  console.log(COLORS.info(`Restore from: VFS history or git`));
}

function renderDiffColor(filePath: string, content: string): string {
  const lines = content.split('\n').slice(0, 10);
  let output = `\n${COLORS.primary('╔─')} ${filePath} ${COLORS.primary('─╗')}\n`;
  
  lines.forEach((line, i) => {
    if (line.startsWith('+') || line.startsWith('-')) {
      const color = line.startsWith('+') ? COLORS.success : COLORS.error;
      output += `  ${color(line)}\n`;
    } else {
      output += `  ${COLORS.info(line)}\n`;
    }
  });
  
  return output;
}

async function runLocalCommand(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, { shell: true, cwd: cwd || process.cwd() });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code || 0 }));
    proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: 1 }));
  });
}

async function readLocalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function writeLocalFile(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

async function listLocalDir(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries;
  } catch {
    return [];
  }
}

// ============================================================================
// BYOK Key Management (Bring Your Own Keys)
// ============================================================================

interface StoredKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
  mistral?: string;
  github?: string;
  cohere?: string;
  huggingface?: string;
  replicate?: string;
  [key: string]: string | undefined;
}

function loadKeys(): StoredKeys {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return {};
}

function saveKeys(keys: StoredKeys): void {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  fs.chmodSync(KEYS_FILE, 0o600);
}

function setKey(provider: string, apiKey: string): boolean {
  const keys = loadKeys();
  keys[provider.toLowerCase()] = apiKey;
  saveKeys(keys);
  return true;
}

function getKey(provider: string): string | undefined {
  const keys = loadKeys();
  return keys[provider.toLowerCase()];
}

function deleteKey(provider: string): boolean {
  const keys = loadKeys();
  delete keys[provider.toLowerCase()];
  saveKeys(keys);
  return true;
}

function listKeys(): { provider: string; hasKey: boolean }[] {
  const keys = loadKeys();
  const supported = ['openai', 'anthropic', 'google', 'mistral', 'github', 'cohere', 'huggingface', 'replicate'];
  return supported.map(p => ({ provider: p, hasKey: !!keys[p.toLowerCase()] }));
}

// ============================================================================
// Circuit Breaker for Provider Fallback
// ============================================================================

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  resetTimeout: number;
}

class CircuitBreaker {
  private state: CircuitBreakerState;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenAttempts: number;
  private halfOpenSuccesses: number;

  constructor(failureThreshold = 5, resetTimeout = 30000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.halfOpenAttempts = 2;
    this.state = { failures: 0, lastFailure: 0, isOpen: false, resetTimeout };
    this.halfOpenSuccesses = 0;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.isOpen) {
      if (Date.now() - this.state.lastFailure >= this.state.resetTimeout) {
        this.state.isOpen = false;
        this.halfOpenSuccesses = 0;
        console.log(COLORS.info('⚡ Circuit breaker: trying half-open state'));
      } else {
        throw new Error(`Circuit breaker OPEN. Retry in ${Math.ceil((this.state.resetTimeout - (Date.now() - this.state.lastFailure)) / 1000)}s`);
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error: unknown) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state.isOpen) {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.halfOpenAttempts) {
        this.state.failures = 0;
        this.state.isOpen = false;
        this.halfOpenSuccesses = 0;
        console.log(COLORS.success('✓ Circuit breaker: CLOSED (recovered)'));
      }
    } else {
      this.state.failures = 0;
    }
  }

  private onFailure(): void {
    this.state.failures++;
    this.state.lastFailure = Date.now();
    if (this.state.failures >= this.failureThreshold) {
      this.state.isOpen = true;
      console.log(COLORS.warning(`⚠ Circuit breaker: OPEN after ${this.state.failures} failures`));
    }
  }

  getState(): { isOpen: boolean; failures: number; lastFailure: number } {
    return { isOpen: this.state.isOpen, failures: this.state.failures, lastFailure: this.state.lastFailure };
  }

  reset(): void { this.state.failures = 0; this.state.isOpen = false; this.halfOpenSuccesses = 0; }
}

const providerCircuitBreakers: Map<string, CircuitBreaker> = new Map<string, CircuitBreaker>();

function getCircuitBreaker(provider: string): CircuitBreaker {
  if (!providerCircuitBreakers.has(provider)) {
    providerCircuitBreakers.set(provider, new CircuitBreaker(5, 60000));
  }
  return providerCircuitBreakers.get(provider)!;
}

function resetAllCircuitBreakers(): void {
  for (const cb of providerCircuitBreakers.values()) cb.reset();
  console.log(COLORS.info('All circuit breakers reset'));
}

// Multi-provider execution with circuit breaker fallback
async function executeWithProviderFallback<T>(
  providers: string[],
  fn: (provider: string) => Promise<T>,
): Promise<T> {
  const errors: string[] = [];
  for (const provider of providers) {
    const breaker = getCircuitBreaker(provider);
    try {
      console.log(COLORS.muted(`  Trying ${provider}...`));
      const result = await breaker.execute(() => fn(provider));
      console.log(COLORS.success(`  ✓ ${provider} succeeded`));
      return result;
    } catch (error: any) {
      errors.push(`${provider}: ${error.message}`);
      console.log(COLORS.warning(`  ✗ ${provider} failed: ${error.message}`));
    }
  }
  throw new Error(`All providers failed:\n  ${errors.join('\n  ')}`);
}

// ============================================================================
// Modal.com Sandbox Provider (stubbed - requires API key configuration)
// ============================================================================

interface ModalSandboxInstance {
  sandboxId: string;
  sessionId: string;
  wsUrl: string;
  status: 'creating' | 'running' | 'stopped' | 'error';
}

async function getModalComProvider(): Promise<{
  create: (config: any) => Promise<ModalSandboxInstance>;
  execute: (sandboxId: string, command: string) => Promise<{ output: string; exitCode: number }>;
  destroy: (sandboxId: string) => Promise<void>;
  status: (sandboxId: string) => Promise<{ status: string }>;
} | null> {
  const keys = loadKeys();
  if (!keys.modal_com) {
    console.log(COLORS.warning('⚠ Modal.com not configured. Set key with: bing keys:set modal_com <api_key>'));
    return null;
  }
  return {
    async create(config: any): Promise<ModalSandboxInstance> {
      const spinner = ora('Creating Modal.com sandbox...').start();
      try {
        const result = await apiRequest('/sandbox', { method: 'POST', data: { provider: 'modal-com', ...config } });
        spinner.stop();
        console.log(COLORS.success('✓ Modal.com sandbox created'));
        return { sandboxId: result.sandboxId, sessionId: result.sessionId, wsUrl: result.wsUrl, status: 'running' };
      } catch (error: any) { spinner.stop(); throw error; }
    },
    async execute(sandboxId: string, command: string): Promise<{ output: string; exitCode: number }> {
      return await apiRequest('/sandbox/execute', { method: 'POST', data: { sandboxId, command } });
    },
    async destroy(sandboxId: string): Promise<void> {
      await apiRequest('/sandbox', { method: 'DELETE', data: { sandboxId } });
    },
    async status(sandboxId: string): Promise<{ status: string }> {
      return await apiRequest(`/sandbox/${sandboxId}/status`);
    },
  };
}

// ============================================================================
// Provider/Model Selection
// ============================================================================

interface Provider {
  id: string;
  name: string;
  models: string[];
  supportsOAuth: boolean;
  oauthUrl?: string;
  isAgent?: boolean;
}

const AVAILABLE_PROVIDERS: Provider[] = [
  { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'], supportsOAuth: true, oauthUrl: 'https://platform.openai.com/account/connections' },
  { id: 'anthropic', name: 'Anthropic', models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku', 'claude-3-sonnet'], supportsOAuth: false },
  { id: 'google', name: 'Google Gemini', models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'], supportsOAuth: true, oauthUrl: 'https://makersuite.google.com/app' },
  { id: 'mistral', name: 'Mistral', models: ['mistral-large', 'mistral-small', 'mistral-medium'], supportsOAuth: false },
  { id: 'github', name: 'GitHub Models', models: ['gpt-4o', 'gpt-4o-mini', 'claude-3.5-sonnet'], supportsOAuth: true, oauthUrl: 'https://github.com/settings/connections' },
  { id: 'cohere', name: 'Cohere', models: ['command-r-plus', 'command-r'], supportsOAuth: false },
  { id: 'huggingface', name: 'Hugging Face', models: ['llama-3.1-70b', 'llama-3.1-8b', 'mixtral-8x7b'], supportsOAuth: true, oauthUrl: 'https://huggingface.co/settings' },
  { id: 'replicate', name: 'Replicate', models: ['llama-3.1-70b', 'flux-pro', 'flux-schnell'], supportsOAuth: true, oauthUrl: 'https://replicate.com/account' },
  { id: 'opencode', name: 'OpenCode Agent', models: ['claude-3-5-sonnet', 'claude-3-opus', 'gpt-4o', 'gpt-4o-mini'], supportsOAuth: false, isAgent: true },
  { id: 'pi', name: 'Pi Agent', models: [], supportsOAuth: false, isAgent: true },
  { id: 'codex', name: 'Codex CLI', models: ['claude-3.5-sonnet-20241022', 'gpt-4o'], supportsOAuth: false, isAgent: true },
  { id: 'amp', name: 'Amp Agent', models: ['claude-3-5-sonnet', 'gpt-4o'], supportsOAuth: false, isAgent: true },
  { id: 'claude-code', name: 'Claude Code', models: ['claude-3-5-sonnet', 'claude-3-opus'], supportsOAuth: false, isAgent: true },
];

function getProvider(id: string): Provider | undefined {
  return AVAILABLE_PROVIDERS.find(p => p.id === id);
}

function getModels(providerId: string): string[] {
  const provider = getProvider(providerId);
  return provider?.models || [];
}

// ============================================================================
// Markdown & Code Highlighting for Terminal
// ============================================================================

const MD_CODE_COLORS = [
  '#ff79c6', '#8be9fd', '#50fa7b', '#ffb86c', '#f1fa8c', '#bd93f9', '#ff5555', '#6272a4',
];

function highlightCode(code: string, maxLines?: number): string {
  const lines = code.split('\n');
  const displayLines = maxLines ? lines.slice(0, maxLines) : lines;
  let highlighted = '';

  displayLines.forEach((line, i) => {
    const color = MD_CODE_COLORS[i % MD_CODE_COLORS.length];
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    const indent = line.match(/^(\s*)/)?.[1] || '';
    const content = line.trim();

    if (content) {
      highlighted += `\x1b[${30 + i};${r};${g};${b}m${indent}${content}\x1b[0m\n`;
    } else {
      highlighted += '\n';
    }
  });

  if (maxLines && lines.length > maxLines) {
    highlighted += `\x1b[38;2;100;100;100m... ${lines.length - maxLines} more lines\x1b[0m`;
  }

  return highlighted;
}

function renderMarkdown(md: string): string {
  let output = md;

  output = output.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return '\n' + highlightCode(code.trim(), 20) + '\n';
  });

  output = output.replace(/`([^`]+)`/g, `\x1b[38;2;255;121;198m$1\x1b[0m`);

  output = output.replace(/^### (.+)$/gm, `\x1b[1;38;2;139;233;219m$1\x1b[0m`);
  output = output.replace(/^## (.+)$/gm, `\x1b[1;38;2;0;255;255m$1\x1b[0m`);
  output = output.replace(/^# (.+)$/gm, `\x1b[1;38;2;255;0;255m$1\x1b[0m`);

  output = output.replace(/\*\*([^*]+)\*\*/g, `\x1b[1m$1\x1b[0m`);
  output = output.replace(/\*([^*]+)\*/g, `\x1b[3m$1\x1b[0m`);

  output = output.replace(/\[([^\]]+)\]\([^)]+\)/g, `\x1b[38;2;0;255;255m$1\x1b[0m`);

  return output;
}

function streamText(text: string, delay = 20): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) {
        process.stdout.write(text[i]);
        i++;
      } else {
        clearInterval(interval);
        resolve();
      }
    }, delay);
  });
}

function renderDiff(diff: string): string {
  const lines = diff.split('\n');
  let output = '';

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const content = line.slice(1);
      output += `\x1b[38;2;80;250;80m+ ${content}\x1b[0m\n`;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      const content = line.slice(1);
      output += `\x1b[38;2;255;85;85m- ${content}\x1b[0m\n`;
    } else if (line.startsWith('@@')) {
      output += `\x1b[38;2;100;150;255m${line}\x1b[0m\n`;
    } else {
      output += line + '\n';
    }
  }

  return output;
}

// ANSI color codes
const COLORS = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  accent: chalk.magenta,
  secondary: chalk.magenta,
  muted: chalk.gray,
};

/**
 * Load saved configuration
 */
function loadConfig(): any {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (error: unknown) {
    console.warn(COLORS.warning('Warning: Could not load config file'));
  }
  return {
    apiBase: DEFAULT_API_BASE,
    provider: process.env.DEFAULT_LLM_PROVIDER || 'anthropic',
    model: process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-latest',
    sandboxProvider: process.env.SANDBOX_PROVIDER || 'daytona',
  };
}

// ============================================================================
// Command Preview System
// ============================================================================

interface CommandImpact {
  command: string;
  estimatedImpact: 'low' | 'medium' | 'high';
  filesAffected: string[];
  sideEffects: string[];
  warnings: string[];
  confirmationRequired: boolean;
}

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf/i,
  /del\s+\/f/i,
  /format/i,
  /drop\s+table/i,
  /truncate/i,
  /reset\s+--hard/i,
  /push\s+--force/i,
  /push\s+-f/i,
];

/**
 * Filesystem operations considered destructive for workspace boundary checks.
 * These modify or remove data and should require confirmation when
 * targeting paths outside the workspace root.
 */
const WORKSPACE_DESTRUCTIVE_OPS = new Set([
  'delete', 'write', 'move', 'overwrite', 'apply_diff', 'rename', 'mkdir',
]);

/**
 * Resolve the workspace root from environment variables.
 * Uses the same priority chain as the web/agent bins:
 * INITIAL_CWD > DESKTOP_WORKSPACE_ROOT > WORKSPACE_ROOT > process.cwd()
 */
function getWorkspaceRoot(): string {
  return process.env.INITIAL_CWD ||
    process.env.DESKTOP_WORKSPACE_ROOT ||
    process.env.WORKSPACE_ROOT ||
    process.cwd();
}

/**
 * Check if a target path is outside the workspace root.
 * Normalizes both paths and checks if the target starts with the root prefix.
 */
function isOutsideWorkspace(targetPath: string): boolean {
  const root = getWorkspaceRoot();
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normTarget = targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normTarget) return false;
  return !(normTarget.startsWith(normRoot + '/') || normTarget === normRoot);
}

/**
 * Check if a destructive file operation requires workspace-boundary confirmation.
 * Returns a reason string if confirmation is needed, or null if it's safe.
 */
function requiresWorkspaceBoundaryConfirmation(
  operation: string,
  targetPath: string,
): string | null {
  if (!WORKSPACE_DESTRUCTIVE_OPS.has(operation)) return null;
  if (!isOutsideWorkspace(targetPath)) return null;
  const root = getWorkspaceRoot();
  return `Operation '${operation}' targets path '${targetPath}' outside workspace root '${root}'. This operation could affect system files or data outside the configured workspace.`;
}

/**
 * Prompt the user for confirmation when a destructive operation targets
 * a path outside the workspace root. Returns true if the user approves.
 * Resolves automatically if --force flag is set or if the operation is safe.
 */
async function confirmWorkspaceBoundary(
  operation: string,
  targetPath: string,
  forceFlag?: boolean,
): Promise<boolean> {
  const reason = requiresWorkspaceBoundaryConfirmation(operation, targetPath);
  if (!reason) return true;  // Safe — inside workspace
  
  const workspaceRoot = getWorkspaceRoot();
  
  if (forceFlag) {
    console.warn(COLORS.warning('⚠ Workspace boundary bypassed with --force'));
    console.warn(COLORS.muted(`  Operation: ${operation}`));
    console.warn(COLORS.muted(`  Target: ${targetPath}`));
    console.warn(COLORS.muted(`  Workspace: ${workspaceRoot}`));
    return true;
  }
  
  // Interactive confirmation prompt
  console.log('\n' + COLORS.error('━'.repeat(60)));
  console.log(COLORS.error('⚠️  WORKSPACE BOUNDARY WARNING'));
  console.log(COLORS.error('━'.repeat(60)));
  console.log(COLORS.warning(`  Operation: ${operation}`));
  console.log(COLORS.warning(`  Target path: ${targetPath}`));
  console.log(COLORS.warning(`  Workspace root: ${workspaceRoot}`));
  console.log();
  console.log(COLORS.info('This operation will affect files outside the configured workspace.'));
  console.log(COLORS.info('This could potentially access or modify system files.'));
  console.log();
  
  // Use readline directly to avoid double prompt text
  const rl = createInterface({ input, output });
  const answer = await new Promise<string>((resolve) => rl.question('Do you want to proceed? [yes/no]: ', (a) => resolve(a)));
  rl.close();
  const confirmed = answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y';
  
  if (!confirmed) {
    console.log(COLORS.muted('Operation cancelled - workspace boundary protection'));
  }
  
  return confirmed;
}

const FILESYSTEM_PATTERNS = [
  { pattern: /delete\s+(.+)/i, type: 'delete', targetGroup: 1 },
  { pattern: /rm\s+(-[rf]+\s+)?(.+)/i, type: 'delete', targetGroup: 2 },
  { pattern: /del\s+(.+)/i, type: 'delete', targetGroup: 1 },
  { pattern: /write\s+(.+)/i, type: 'write', targetGroup: 1 },
  { pattern: /mv\s+(.+)\s+(.+)/i, type: 'move', targetGroup: [1, 2] },
  { pattern: /cp\s+(.+)\s+(.+)/i, type: 'copy', targetGroup: [1, 2] },
];

function analyzeCommandImpact(command: string): CommandImpact {
  // Sanitize input - limit length and strip control chars
  const sanitized = command
    .slice(0, 1000)
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()

  if (!sanitized) {
    return {
      command: '',
      estimatedImpact: 'low',
      filesAffected: [],
      sideEffects: [],
      warnings: ['Empty command'],
      confirmationRequired: false,
    }
  }

  // In desktop/CLI local modes, adjust severity thresholds:
  // LOW = most known commands (cat, ls, echo, mkdir, npm, git status, etc.)
  // MEDIUM = unknown/unpredictable new commands (requires Enter approval)
  // HIGH = explicitly destructive (rm -rf, format, etc.) — extra warning in red
  const isLocalMode = localMode.isLocal || localMode.isDesktop;
  const LOCAL_SAFE_COMMANDS = /^\s*(cat|ls|dir|echo|pwd|mkdir|touch|head|tail|grep|find|wc|sort|uniq|npm|pnpm|yarn|bun|npx|node|python|pip|git\s+(?:status|log|diff|branch|show))\b/i;

  const impact: CommandImpact = {
    command: sanitized,
    estimatedImpact: isLocalMode ? (LOCAL_SAFE_COMMANDS.test(sanitized) ? 'low' : 'medium') : 'low',
    filesAffected: [],
    sideEffects: [],
    warnings: [],
    confirmationRequired: isLocalMode ? !LOCAL_SAFE_COMMANDS.test(sanitized) : false,
  };

  // Check for destructive commands — always HIGH regardless of mode
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      impact.estimatedImpact = 'high';
      impact.confirmationRequired = true;
      impact.warnings.push(isLocalMode
        ? '⚠️  HIGH SEVERITY: This action is destructive and cannot be undone'
        : 'This action is destructive and cannot be undone');
      break;
    }
  }

  // Extract filesystem targets
  for (const fp of FILESYSTEM_PATTERNS) {
    const match = command.match(fp.pattern);
    if (match) {
      if (Array.isArray(fp.targetGroup)) {
        impact.filesAffected = fp.targetGroup.map(g => match[g]);
      } else {
        impact.filesAffected.push(match[fp.targetGroup]);
      }
    }
  }

  // Set warnings for certain files
  if (impact.filesAffected.some(f => f.includes('node_modules'))) {
    impact.warnings.push('This will affect node_modules directory');
  }
  if (impact.filesAffected.some(f => f.includes('.git'))) {
    impact.warnings.push('This will affect git repository');
  }

  if (impact.estimatedImpact === 'low' && impact.filesAffected.length > 0) {
    impact.estimatedImpact = 'medium';
  }

  return impact;
}

/**
 * Save configuration
 */
function saveConfig(config: any): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Load authentication tokens
 */
function loadAuth(): any {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    }
  } catch (error: unknown) {
    console.warn(COLORS.warning('Warning: Could not load auth file'));
  }
  return { token: null, userId: null };
}

/**
 * Save authentication tokens
 */
function saveAuth(auth: any): void {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
  try {
    fs.chmodSync(AUTH_FILE, 0o600); // Secure file permissions
  } catch {
    // chmod not supported on Windows
  }
}

/**
 * Make authenticated API request
 */
async function apiRequest(endpoint: string, options: { method?: string; data?: any; headers?: any; timeout?: number; _rawResponse?: boolean } = {}): Promise<any> {
  const config = loadConfig();
  const auth = loadAuth();

  const url = `${config.apiBase}${endpoint}`;
  const headers: any = {
    'Content-Type': 'application/json',
    'User-Agent': `binG-CLI/${CLI_VERSION}`,
    ...options.headers,
  };

  // Add authentication
  if (auth.token) {
    headers['Authorization'] = `Bearer ${auth.token}`;
  }

  try {
    const response = await axios({
      url,
      method: options.method || 'GET',
      headers,
      data: options.data,
      timeout: options.timeout || 120000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500, // Don't throw on 4xx
    });

    // Handle HTTP errors
    if (response.status && response.status >= 400) {
      const data = response.data;
      const errorMsg = data?.error?.message || data?.message || data?.error || JSON.stringify(data).slice(0, 200);
      throw Object.assign(new Error(errorMsg), { response: { status: response.status, data } });
    }

    if (options._rawResponse) {
      return response;
    }
    return response.data;
  } catch (error: any) {
    if (error.response) {
      throw error;
    }
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw Object.assign(new Error('Cannot connect to server'), { code: error.code });
      }
      if (error.code === 'ETIMEDOUT') {
        throw Object.assign(new Error('Request timed out'), { code: error.code });
      }
    }
    throw error;
  }
}

/**
 * Create readline interface for interactive prompts
 */
const rl = createInterface({ input, output });

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function promptAsync(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

/**
 * Confirm a yes/no question
 */
async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(question + " (y/N): ");
  return answer.toLowerCase() === "y";
}

/**
 * Interactive chat loop
 */
async function chatLoop(options: { agent?: string; stream?: boolean }): Promise<void> {
  const config = loadConfig();
  const auth = loadAuth();
  const userId = auth.userId || 'cli-user';
  const sessionId = `cli-${Date.now()}`;

  // Initialize VFS MCP tools
  await initializeVFSMCP(userId, sessionId);

  // Initialize local history provider for decentralized chat history persistence
  // In desktop/CLI modes, chat history is saved to ~/.quaz/chat-history/ NOT to server DB
  let localHistory: any = null;
  try {
    const { LocalHistoryProvider } = await import('./lib/local-history-manager.js');
    localHistory = new LocalHistoryProvider(process.cwd());
  } catch {
    // Local history not available — continue without persistence
  }

  console.log(chalk.cyanBright(`
╔═══════════════════════════════════════════════════════════╗
║                    binG Chat Interface                     ║
║                                                           ║
║  Mode: ${options.agent || 'auto'}                                    ║
║  Provider: ${config.provider}                                      ║
║  Model: ${config.model}                                          ║
║  VFS Tools: ${vfsToolsInitialized ? COLORS.success('enabled') : COLORS.warning('disabled')}                                   ║
║                                                           ║
║  Type 'exit' or 'quit' to end the conversation            ║
║  Type 'clear' to clear conversation history               ║
║  Type 'help' for available commands                       ║
║  Type 'diff' for pending file edits                   ║
╚═══════════════════════════════════════════════════════════╝
  `));
  
  const messages: any[] = [];
  
  // Add system message with fallback prompt instructions
  messages.push({
    role: 'system',
    content: `You are running in CLI mode. ${vfsToolsInitialized ? 'VFS MCP tools are available.' : 'MCP tools are not available.'} ${TEXT_MODE_FALLBACK_PROMPT}`,
  });
  
  while (true) {
    const userMessage = await prompt(COLORS.primary('\nYou: '));
    
    if (!userMessage.trim()) continue;
    
    const lowerMessage = userMessage.toLowerCase().trim();
    
    // Handle commands
    if (lowerMessage === 'exit' || lowerMessage === 'quit') {
      console.log(COLORS.info('Goodbye!'));
      break;
    }
    
    if (lowerMessage === 'clear') {
      messages.splice(0, messages.length);
      console.log(COLORS.info('Conversation history cleared'));
      continue;
    }
    
    if (lowerMessage === 'help') {
      console.log(`
${COLORS.primary('Available Commands:')}
  exit, quit  - End the conversation
  clear       - Clear conversation history
  help        - Show this help message
  config      - Show current configuration
  stream      - Toggle streaming mode
  local       - Show local mode status
  diff        - Show last diff
  `);
      continue;
    }

    if (lowerMessage === 'local') {
      const mode = localMode;
      console.log(`${COLORS.primary('Local Mode:')} ${mode.isLocal ? COLORS.success('Yes') : 'No'}`);
      console.log(`${COLORS.primary('Desktop:')} ${mode.isDesktop ? COLORS.success('Yes') : 'No'}`);
      console.log(`${COLORS.primary('Workspace:')} ${mode.workspace}`);
      continue;
    }

    if (lowerMessage === 'config') {
      console.log(COLORS.info('Current Configuration:'));
      console.log(`  API Base: ${config.apiBase}`);
      console.log(`  Provider: ${config.provider}`);
      console.log(`  Model: ${config.model}`);
      console.log(`  Sandbox: ${config.sandboxProvider}`);
      continue;
    }
    
    // Add user message to history
    messages.push({ role: 'user', content: userMessage });
    
    const spinner = ora('Thinking...').start();
    
    try {
      let response: any;
      let content: string;
      
      // Use SSE streaming for real-time file edit display
      if (options.stream !== false) {
        const axiosMod = await import('axios'); const axios = axiosMod.default || axiosMod;
        const auth = loadAuth();
        
        const resp = await (axios as any)({
          url: `${config.apiBase}/chat`,
          method: 'POST',
          data: {
            messages,
            provider: config.provider,
            model: config.model,
            stream: true,
            agentMode: options.agent === 'auto' ? 'auto' : options.agent,
            tools: getVFSTools(),
          },
          responseType: 'stream',
          headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
        });
        
        spinner.stop();
        
        // Process SSE stream
        content = await processSSEStream(resp.data);
        
        // Also add final markdown rendering
        if (content) {
          const rendered = renderMarkdown(content);
          console.log(rendered);
        }
        
        response = { content };
      } else {
        response = await apiRequest('/chat', {
          method: 'POST',
          data: {
            messages,
            provider: config.provider,
            model: config.model,
            stream: false,
            agentMode: options.agent === 'auto' ? 'auto' : options.agent,
          },
        });
        
        spinner.stop();
        content = response.response || response.content;
        console.log(COLORS.success('\nAssistant:'), content);
      }

      // Add assistant response to history
      messages.push({ role: 'assistant', content });

      // Save interaction to local history (desktop/CLI decentralized storage)
      if (localHistory) {
        try {
          await localHistory.saveInteraction({
            user: userMessage,
            assistant: content,
            timestamp: Date.now(),
          });
        } catch {
          // History save failed — non-critical
        }
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`\nError: ${error.message}`));
      
      // Remove last user message on error
      messages.pop();
    }
  }
  
  rl.close();
}

/**
 * CLI Program Setup
 */
const program = new Command();

program
  .name('bing')
  .description('binG - Agentic Workspace CLI')
  .version(CLI_VERSION);

// ============================================================================
// CHAT COMMANDS
// ============================================================================

program
  .command('chat')
  .description('Start an interactive chat session with AI agents')
  .option('-a, --agent <mode>', 'Agent mode: v1, v2, auto (default: auto)')
  .option('-s, --stream', 'Enable streaming (default: true)')
  .option('-p, --provider <provider>', 'LLM provider (default: from config)')
  .option('-m, --model <model>', 'Model name (default: from config)')
  .action(async (options) => {
    const config = loadConfig();
    
    if (options.provider) config.provider = options.provider;
    if (options.model) config.model = options.model;
    
    await chatLoop({
      agent: options.agent,
      stream: options.stream !== false,
    });
  });

program
  .command('ask <message>')
  .description('Ask a single question and get a response')
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-m, --model <model>', 'Model name')
  .action(async (message, options) => {
    if (!validateRequired(message, 'Ask message')) return;

    const config = loadConfig();

    const spinner = ora('Getting answer...').start();

    try {
      const response = await apiRequest('/chat', {
        method: 'POST',
        data: {
          messages: [{ role: 'user', content: message }],
          provider: options.provider || config.provider,
          model: options.model || config.model,
          stream: false,
        },
      });
      
      spinner.stop();
      console.log(COLORS.success('\nAnswer:'), response.response || response.content);
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// ============================================================================
// SANDBOX COMMANDS
// ============================================================================

program
  .command('sandbox:create')
  .description('Create a new sandbox workspace')
  .option('-p, --provider <provider>', 'Sandbox provider (daytona, e2b, modal-com, etc.)')
  .option('-i, --image <image>', 'Base image (default: python:3.13)')
  .option('--gpu <type>', 'GPU type (H100, A100, etc.)')
  .option('--cpu <count>', 'Number of CPUs')
  .option('--memory <MB>', 'Memory in MB')
  .action(async (options) => {
    const config = loadConfig();
    const provider = options.provider || config.sandboxProvider;
    
    const spinner = ora(`Creating ${provider} sandbox...`).start();
    
    try {
      const result = await apiRequest('/sandbox', {
        method: 'POST',
        data: {
          provider,
          image: options.image || 'python:3.13',
          gpu: options.gpu,
          cpu: options.cpu ? parseInt(options.cpu) : undefined,
          memory: options.memory ? parseInt(options.memory) : undefined,
        },
      });
      
      spinner.stop();
      console.log(COLORS.success('\nSandbox created successfully!'));
      console.log(`  ID: ${COLORS.info(result.sessionId)}`);
      console.log(`  Sandbox ID: ${COLORS.info(result.sandboxId)}`);
      console.log(`  Provider: ${COLORS.info(result.provider)}`);
      console.log(`  Workspace: ${COLORS.info(result.workspacePath || '/workspace')}`);
      
      // Save sandbox ID for subsequent commands
      saveConfig({ ...config, currentSandbox: result.sandboxId });
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`\nError: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('sandbox:exec <command...>')
  .description('Execute a command in the sandbox')
  .option('-s, --sandbox <id>', 'Sandbox ID (default: current)')
  .option('-c, --cwd <path>', 'Working directory')
  .action(async (command, options) => {
    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;
    
    if (!sandboxId) {
      console.log(COLORS.error('No sandbox specified. Use -s or create one first.'));
      process.exit(1);
    }
    
    const spinner = ora(`Executing: ${command.join(' ')}`).start();
    
    try {
      const result = await apiRequest('/sandbox/execute', {
        method: 'POST',
        data: {
          sandboxId,
          command: command.join(' '),
          cwd: options.cwd,
        },
      });
      
      spinner.stop();
      
      if (result.success) {
        if (result.output) {
          console.log(COLORS.success('\nOutput:'));
          console.log(result.output);
        }
        if (result.error) {
          console.log(COLORS.warning('\nErrors:'));
          console.log(result.error);
        }
        console.log(COLORS.info(`\nExit code: ${result.exitCode}`));
        console.log(COLORS.info(`Duration: ${result.executionTime}ms`));
      } else {
        console.log(COLORS.error(`\nCommand failed: ${result.error}`));
        process.exit(1);
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`\nError: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('sandbox:destroy [id]')
  .description('Destroy a sandbox')
  .option('-f, --force', 'Force destroy without confirmation')
  .action(async (id, options) => {
    const config = loadConfig();
    const sandboxId = id || config.currentSandbox;
    
    if (!sandboxId) {
      console.log(COLORS.error('No sandbox specified'));
      process.exit(1);
    }
    
    // Workspace boundary check before destructive destroy
    const boundaryOk = await confirmWorkspaceBoundary('delete', sandboxId, options.force);
    if (!boundaryOk) {
      console.log(COLORS.muted('Destroy cancelled — path is outside workspace.'));
      return;
    }

    if (!options.force) {
      const answer = await prompt(COLORS.warning(`Are you sure you want to destroy sandbox ${sandboxId}? (y/N): `));
      if (answer.toLowerCase() !== 'y') {
        console.log(COLORS.info('Cancelled'));
        return;
      }
    }
    
    const spinner = ora('Destroying sandbox...').start();
    
    try {
      await apiRequest('/sandbox', {
        method: 'DELETE',
        data: { sandboxId },
      });
      
      spinner.stop();
      console.log(COLORS.success('Sandbox destroyed successfully'));
      
      if (config.currentSandbox === sandboxId) {
        delete config.currentSandbox;
        saveConfig(config);
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('sandbox:terminal')
  .description('Connect to interactive WebSocket terminal')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .action(async (options) => {
    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;
    if (!sandboxId) {
      console.log(COLORS.error('No sandbox specified. Use -s or create one first.'));
      process.exit(1);
    }
    await websocketTerminal(sandboxId);
  });

program
  .command('sandbox:list')
  .description('List active sandboxes')
  .action(async () => {
    const spinner = ora('Fetching sandboxes...').start();
    
    try {
      const result = await apiRequest('/sandbox/session', {
        method: 'POST',
      });
      
      spinner.stop();
      
      if (result.sessions && result.sessions.length > 0) {
        console.log(COLORS.primary('\nActive Sandboxes:'));
        console.table(
          result.sessions.map((s: any) => ({
            ID: s.sandboxId,
            Session: s.sessionId,
            Provider: s.provider,
            Status: s.status,
            Created: new Date(s.createdAt).toLocaleString(),
          }))
        );
      } else {
        console.log(COLORS.info('\nNo active sandboxes'));
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// ============================================================================
// FILESYSTEM COMMANDS
// ============================================================================

program
  .command('file:read <path>')
  .description('Read a file from local workspace')
  .action(async (path) => {
    if (!validateRequired(path, 'File path')) return;

    const vfs = await getLocalVFS();
    if (!vfs) {
      console.log(COLORS.error('Local VFS not available'));
      return;
    }

    try {
      const content = await vfs.readWorkspaceFile(path);
      if (content !== null) {
        console.log(content);
      } else {
        console.log(COLORS.error(`File not found: ${path}`));
        process.exit(1);
      }
    } catch (error: any) {
      handleError(error, 'Failed to read file');
      process.exit(1);
    }
  });

program
  .command('file:write <path> [content]')
  .description('Write content to a local file')
  .option('-f, --force', 'Overwrite existing file without confirmation')
  .option('-e, --encoding <encoding>', 'Content encoding', 'utf-8')
  .action(async (path, content, options) => {
    if (!validateRequired(path, 'File path')) return;

    const vfs = await getLocalVFS();
    if (!vfs) {
      console.log(COLORS.error('Local VFS not available'));
      return;
    }

    if (!content) {
      content = await prompt(COLORS.primary('Enter file content (end with empty line): '));
      let line;
      while ((line = await prompt('')) !== '') {
        content += '\n' + line;
      }
    }

    try {
      const result = await vfs.commitFile(path, content);
      console.log(COLORS.success(`\nFile written: ${path}`));
    } catch (error: any) {
      handleError(error, 'Failed to write file');
      process.exit(1);
    }
  });

program
  .command('file:list [path]')
  .description('List files in local workspace')
  .action(async (path) => {
    const vfs = await getLocalVFS();
    if (!vfs) {
      console.log(COLORS.error('Local VFS not available'));
      return;
    }

    try {
      const files = await vfs.listWorkspaceFiles(path || '');
      if (files.length === 0) {
        console.log(COLORS.warning(`No files found${path ? ` in ${path}` : ''}`));
        return;
      }

      console.log(COLORS.primary(`\nFiles${path ? ` in ${path}` : ''}:`));
      files.forEach((file: any) => {
        const icon = file.isDirectory ? COLORS.info('📁') : '📄';
        const sizeStr = file.size > 0 ? ` (${file.size} bytes)` : '';
        console.log(`  ${icon} ${file.path}${sizeStr}`);
      });
    } catch (error: any) {
      handleError(error, 'Failed to list files');
      process.exit(1);
    }
  });

program
  .command('file:revert <path>')
  .description('Revert file using local VFS history')
  .action(async (filePath) => {
    const vfs = await getLocalVFS();
    if (!vfs) {
      console.log(COLORS.error('Local VFS not available'));
      return;
    }

    try {
      const success = await vfs.revertFile(filePath);
      if (success) {
        console.log(COLORS.success(`File reverted: ${filePath}`));
      } else {
        console.log(COLORS.warning(`No history found for: ${filePath}`));
      }
    } catch (error: any) {
      console.log(COLORS.error(`Error reverting file: ${error.message}`));
    }
  });

program
  .command('history:prune')
  .description('Prune old chat history')
  .option('--days <number>', 'Days to keep', '30')
  .action(async (options) => {
    const spinner = ora('Pruning history...').start();
    try {
      const { LocalHistoryProvider } = await import('./lib/local-history-manager.js');
      const history = new LocalHistoryProvider(process.cwd());
      await history.pruneHistory(parseInt(options.days));
      spinner.stop();
      console.log(COLORS.success('History pruned successfully!'));
    } catch (error: any) { spinner.stop(); console.log(COLORS.error(`Error: ${error.message}`)); }
  });

program
  .command('file:history <path>')
  .description('Show file edit history')
  .action(async (filePath) => {
    const vfs = await getLocalVFS();
    if (!vfs) {
      console.log(COLORS.error('Local VFS not available'));
      return;
    }

    console.log(COLORS.primary(`\nEdit history for: ${filePath}`));
    const edits = pendingEdits.filter(e => e.path === filePath);
    
    if (edits.length === 0) {
      console.log(COLORS.warning('No edits found in session'));
      return;
    }

    edits.forEach((edit, i) => {
      const status = edit.committed ? COLORS.success('[]') : COLORS.warning('[pending]');
      console.log(`  ${i}: ${new Date(edit.timestamp).toISOString()} ${status}`);
    });
  });

// ============================================================================
// LOCAL FILE COMMANDS (standalone, no server connection)
// ============================================================================

program
  .command('rollback')
  .description('Interactive commit rollback selector with arrow key navigation')
  .option('-l, --limit <number>', 'Maximum number of commits to show (default: 20)')
  .action(async (options) => {
    const { handleRollbackCommand } = await import('./commit-tui.js');
    await handleRollbackCommand([]);
  });

// ============================================================================
// IMAGE GENERATION COMMANDS
// ============================================================================

program
  .command('image:generate <prompt>')
  .description('Generate an image from a text prompt')
  .option('-p, --provider <provider>', 'Provider (mistral, replicate)')
  .option('-q, --quality <quality>', 'Quality (low, medium, high, ultra)')
  .option('-a, --aspect <ratio>', 'Aspect ratio (1:1, 16:9, 9:16, etc.)')
  .option('-o, --output <file>', 'Output file path')
  .action(async (prompt, options) => {
    const spinner = ora('Generating image...').start();
    
    try {
      const result = await apiRequest('/image/generate', {
        method: 'POST',
        data: {
          prompt,
          provider: options.provider,
          quality: options.quality || 'high',
          aspectRatio: options.aspect,
        },
        timeout: 180000, // 3 minutes for image generation
      });
      
      spinner.stop();
      
      if (result.success) {
        console.log(COLORS.success('\nImage generated successfully!'));
        console.log(`  Provider: ${COLORS.info(result.provider)}`);
        console.log(`  Model: ${COLORS.info(result.model)}`);
        console.log(`  URL: ${COLORS.info(result.imageUrl)}`);
        
        if (options.output) {
          // Workspace boundary check before writing to output path
          const outputBoundaryOk = await confirmWorkspaceBoundary('write', options.output, false);
          if (!outputBoundaryOk) {
            console.log(COLORS.muted('Write cancelled — output path is outside workspace.'));
            return;
          }

          // Download and save image
          const imageBuffer = await axios.get(result.imageUrl, { responseType: 'arraybuffer' });
          fs.writeFileSync(options.output, imageBuffer.data);
          console.log(COLORS.success(`  Saved to: ${COLORS.info(options.output)}`));
        }
      } else {
        console.log(COLORS.error(`Error: ${result.error}`));
        process.exit(1);
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// ============================================================================
// VOICE COMMANDS
// ============================================================================

program
  .command('tts <text>')
  .description('Convert text to speech')
  .option('-v, --voice <voice>', 'Voice name')
  .option('-m, --model <model>', 'TTS model')
  .option('-o, --output <file>', 'Output audio file path')
  .action(async (text, options) => {
    const spinner = ora('Generating speech...').start();
    
    try {
      const result = await apiRequest('/tts', {
        method: 'POST',
        data: {
          text,
          voice: options.voice,
          model: options.model,
        },
      });
      
      spinner.stop();
      
      if (result.success && result.audioData) {
        console.log(COLORS.success('\nSpeech generated successfully!'));
        console.log(`  Voice: ${COLORS.info(result.voice)}`);
        console.log(`  Model: ${COLORS.info(result.model)}`);
        
        if (options.output) {
          // Workspace boundary check before writing audio output
          const audioBoundaryOk = await confirmWorkspaceBoundary('write', options.output, false);
          if (!audioBoundaryOk) {
            console.log(COLORS.muted('Write cancelled - output path is outside workspace.'));
            return;
          }
          // Save audio data
          const audioBuffer = Buffer.from(result.audioData, 'base64');
          fs.writeFileSync(options.output, audioBuffer);
          console.log(COLORS.success(`  Saved to: ${COLORS.info(options.output)}`));
        }
      } else {
        console.log(COLORS.error(`Error: ${result.error}`));
        process.exit(1);
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// ============================================================================
// TOOL COMMANDS
// ============================================================================

program
  .command('providers:list')
  .description('List available LLM and sandbox providers')
  .action(async () => {
    const spinner = ora('Fetching providers...').start();
    
    try {
      const result = await apiRequest('/providers', {
        method: 'GET',
      });
      
      spinner.stop();
      
      if (result.llm && result.llm.length > 0) {
        console.log(COLORS.primary(`\nAvailable LLM Providers (${result.llm.length}):`));
        console.table(
          result.llm.map((p: any) => ({
            Provider: p.id || p,
            Status: p.isAvailable ? COLORS.success('Available') : COLORS.warning('Not configured'),
            Models: p.models?.length || 'N/A',
          }))
        );
      }
      
      if (result.sandbox && result.sandbox.length > 0) {
        console.log(COLORS.primary(`\nAvailable Sandbox Providers (${result.sandbox.length}):`));
        console.table(
          result.sandbox.map((p: any) => ({
            Provider: p.id || p,
            Status: p.isAvailable ? COLORS.success('Available') : COLORS.warning('Not configured'),
            Priority: p.priority || 'N/A',
          }))
        );
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('quota')
  .description('Show quota usage for all providers')
  .action(async () => {
    const spinner = ora('Fetching quota information...').start();
    
    try {
      const result = await apiRequest('/quota', { method: 'GET' });

      spinner.stop();

      if (result.success && result.quotas) {
        console.log(chalk.cyanBright('\n=== Provider Quotas ===\n'));
        
        result.quotas.forEach((q: any) => {
          const percentage = q.percentageUsed.toFixed(1);
          const status = q.isDisabled 
            ? COLORS.error('DISABLED')
            : q.percentageUsed > 90
              ? COLORS.error('CRITICAL')
              : q.percentageUsed > 70
                ? COLORS.warning('WARNING')
                : COLORS.success('OK');
          
          console.log(`${COLORS.primary(q.provider)}:`);
          console.log(`  Status: ${status}`);
          console.log(`  Used: ${q.used} / ${q.limit} (${percentage}%)`);
          console.log(`  Remaining: ${q.remaining}`);
          console.log();
        });
      } else {
        console.log(COLORS.info('\nNo quota information available'));
      }

    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('workflow:list')
  .description('List available workflows')
  .action(async () => {
    const spinner = ora('Fetching workflows...').start();
    
    try {
      const result = await apiRequest('/mastra/status', { method: 'GET' });
      
      spinner.stop();
      
      if (result.workflows && result.workflows.length > 0) {
        console.log(COLORS.primary('\nAvailable Workflows:'));
        console.table(
          result.workflows.map((w: any) => ({
            Name: w.name,
            Type: w.type,
            Status: w.status,
          }))
        );
      } else {
        console.log(COLORS.info('\nNo workflows available'));
      }

    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('workflow:run <workflowType>')
  .description('Run a Mastra workflow')
  .option('-i, --input <json>', 'Input data as JSON')
  .option('--wait', 'Wait for completion (default: stream)')
  .action(async (workflowType, options) => {
    const spinner = ora(`Running workflow: ${workflowType}`).start();

    try {
      let inputData = {};
      if (options.input) {
        inputData = JSON.parse(options.input);
      }

      const result = await apiRequest('/mastra/workflow', {
        method: 'POST',
        data: {
          workflowType,
          inputData,
          stream: !options.wait,
        },
        timeout: 300000,
      });

      spinner.stop();

      if (result.success) {
        console.log(COLORS.success(`\nWorkflow ${options.wait ? 'completed' : 'started'}!`));
        console.log(`  Run ID: ${COLORS.info(result.runId)}`);
        if (options.wait) {
          console.log('\nResult:');
          console.log(JSON.stringify(result.result, null, 2));
        }
      } else {
        console.log(COLORS.error(`Error: ${result.error}`));
        process.exit(1);
      }

    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// ============================================================================
// GIT COMMANDS
// ============================================================================

program
  .command('git:status')
  .description('Show Git status in sandbox')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .action(async (options) => {
    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;
    if (!sandboxId) { console.log(COLORS.error('No sandbox specified')); process.exit(1); }
    const spinner = ora('Getting Git status...').start();
    try {
      const result = await apiRequest('/sandbox/execute', {
        method: 'POST',
        data: { sandboxId, command: 'git status --porcelain -b' },
      });
      spinner.stop();
      console.log(COLORS.primary('\nGit Status:'));
      console.log(result.output || 'Working tree clean');
    } catch (error: any) { spinner.stop(); console.log(COLORS.error(`Error: ${error.message}`)); }
  });

program
  .command('git:commit <message>')
  .description('Commit changes in sandbox')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .option('-a, --all', 'Stage all changes')
  .action(async (message, options) => {
    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;
    if (!sandboxId) { console.log(COLORS.error('No sandbox specified')); process.exit(1); }
    const spinner = ora('Committing changes...').start();
    try {
      if (options.all) await apiRequest('/sandbox/execute', { method: 'POST', data: { sandboxId, command: 'git add -A' } });
      const escapedMessage = message.replace(/'/g, "'\\''");
      const result = await apiRequest('/sandbox/execute', { method: 'POST', data: { sandboxId, command: `git commit -m '${escapedMessage}'` } });
      spinner.stop();
      console.log(result.success ? COLORS.success('\nChanges committed!') : COLORS.error(`Error: ${result.error}`));
    } catch (error: any) { spinner.stop(); console.log(COLORS.error(`Error: ${error.message}`)); }
  });

program
  .command('git:push')
  .description('Push changes to remote')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .option('-r, --remote <name>', 'Remote name (default: origin)')
  .option('-b, --branch <name>', 'Branch name')
  .action(async (options) => {
    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;
    if (!sandboxId) { console.log(COLORS.error('No sandbox specified')); process.exit(1); }
    if (!await confirm('Are you sure you want to push changes?')) { console.log(COLORS.info('Cancelled')); return; }
    const spinner = ora('Pushing changes...').start();
    try {
      const remote = options.remote || 'origin';
      const target = [remote, options.branch].filter(Boolean).join(' ');
      const result = await apiRequest('/sandbox/execute', { method: 'POST', data: { sandboxId, command: `git push ${target}`.trim() } });
      spinner.stop();
      console.log(result.success ? COLORS.success('\nChanges pushed!') : COLORS.error(`Error: ${result.error}`));
    } catch (error: any) { spinner.stop(); console.log(COLORS.error(`Error: ${error.message}`)); }
  });

// ============================================================================
// STORAGE COMMANDS
// ============================================================================

program
  .command('storage:upload <localPath> <remotePath>')
  .description('Upload file to cloud storage')
  .action(async (localPath, remotePath) => {
    if (!fs.existsSync(localPath)) { console.log(COLORS.error(`File not found: ${localPath}`)); process.exit(1); }
    const spinner = ora('Uploading file...').start();
    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(localPath));
      formData.append('path', remotePath);
      const config = loadConfig();
      const auth = loadAuth();
      const contentLength = await new Promise<number>((resolve, reject) => {
        formData.getLength((err, length) => { if (err) reject(err); else resolve(length); });
      });
      const response = await axios.post(`${config.apiBase}/storage/upload`, formData, {
        headers: { ...formData.getHeaders(), 'Content-Length': contentLength, ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) },
      });
      spinner.stop();
      if (response.data.success) {
        console.log(COLORS.success('\nFile uploaded!'));
        console.log(`  URL: ${COLORS.info(response.data.data.url)}`);
      } else { console.log(COLORS.error(`Error: ${response.data.error}`)); process.exit(1); }
    } catch (error: any) { spinner.stop(); console.log(COLORS.error(`Error: ${error.message}`)); }
  });

program
  .command('storage:list [path]')
  .description('List cloud storage files')
  .action(async (path) => {
    const spinner = ora('Fetching files...').start();
    try {
      const result = await apiRequest('/storage/list', { method: 'POST', data: { prefix: path || '' } });
      spinner.stop();
      if (result.success && result.data?.length > 0) {
        console.log(COLORS.primary('\nCloud Storage Files:'));
        result.data.forEach((file: string) => console.log(`  📄 ${file}`));
      } else { console.log(COLORS.info('\nNo files found')); }
    } catch (error: any) { spinner.stop(); console.log(COLORS.error(`Error: ${error.message}`)); }
  });

program
  .command('storage:usage')
  .description('Show storage usage')
  .action(async () => {
    const spinner = ora('Fetching usage...').start();
    try {
      const result = await apiRequest('/storage/usage', { method: 'GET' });
      spinner.stop();
      if (result.success) {
        const used = Math.round(result.data.used / 1024 / 1024);
        const limit = Math.round(result.data.limit / 1024 / 1024);
        const percentage = Math.round((result.data.used / result.data.limit) * 100);
        console.log(COLORS.primary('\nStorage Usage:'));
        console.log(`  Used: ${COLORS.info(`${used} MB`)} / ${COLORS.info(`${limit} MB`)}`);
        console.log(`  Percentage: ${COLORS.info(`${percentage}%`)}`);
        const barLength = 30;
        const filled = Math.max(0, Math.min(barLength, Math.round((percentage / 100) * barLength)));
        console.log(`  [${'█'.repeat(filled)}${'░'.repeat(barLength - filled)}]`);
      } else { console.log(COLORS.error(`Error: ${result.error}`)); }
    } catch (error: any) { spinner.stop(); console.log(COLORS.error(`Error: ${error.message}`)); }
  });

// ============================================================================
// SYNC COMMAND
// ============================================================================

program
  .command('sync <localPath> <remotePath>')
  .description('Sync local file/directory to sandbox')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .option('-d, --delete-local', 'Delete local file after sync')
  .option('-r, --reverse', 'Sync from sandbox to local')
  .action(async (localPath, remotePath, options) => {
    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;
    if (!sandboxId) { console.log(COLORS.error('No sandbox specified')); process.exit(1); }
    if (!options.reverse && !fs.existsSync(localPath)) { console.log(COLORS.error(`Local path not found: ${localPath}`)); process.exit(1); }
    const spinner = ora(`Syncing ${localPath} to ${remotePath}...`).start();
    try {
      const data: any = { localPath, remotePath, sandboxId };
      if (options.deleteLocal) data.deleteLocal = true;
      if (options.reverse) data.reverse = true;
      const result = await apiRequest('/sandbox/sync', { method: 'POST', data });
      spinner.stop();
      if (result.success) {
        console.log(COLORS.success('\nSync complete!'));
        console.log(`  Synced: ${result.syncedItems.join(', ')}`);
      } else { console.log(COLORS.error(`Error: ${result.error}`)); process.exit(1); }
    } catch (error: any) { spinner.stop(); console.log(COLORS.error(`Error: ${error.message}`)); }
  });

// ============================================================================
// INTEGRATIONS COMMAND
// ============================================================================

program
  .command('integrations:list')
  .description('List OAuth integrations')
  .action(async () => {
    const spinner = ora('Fetching integrations...').start();
    
    try {
      const result = await apiRequest('/user/integrations/status', { method: 'GET' });
      
      spinner.stop();
      
      if (result.integrations && result.integrations.length > 0) {
        console.log(COLORS.primary('\nConnected Integrations:'));
        console.table(
          result.integrations.map((i: any) => ({
            Provider: i.provider,
            Status: i.connected ? COLORS.success('Connected') : COLORS.warning('Not Connected'),
            Account: i.account || '-',
          }))
        );
      } else {
        console.log(COLORS.info('\nNo integrations configured'));
      }

    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('oauth:complete')
  .description('Complete OAuth authentication for a provider')
  .option('-p, --provider <provider>', 'OAuth provider (github, google, openai, huggingface)')
  .option('-c, --code <code>', 'Authorization code from OAuth callback')
  .option('--port <port>', 'Local server port for callback', '3847')
  .action(async (options) => {
    if (!options.provider) {
      console.log(COLORS.error('\nError: --provider is required'));
      console.log(COLORS.info('Available providers: github, google, openai, huggingface'));
      process.exit(1);
    }

    const spinner = ora(`Completing OAuth for ${options.provider}...`).start();
    
    try {
      // In CLI mode, use direct API exchange if code is provided
      if (options.code) {
        const result = await apiRequest('/auth/oauth/callback', {
          method: 'POST',
          data: {
            provider: options.provider,
            code: options.code,
          },
        });
        
        spinner.stop();
        
        if (result.success) {
          console.log(COLORS.success(`\n✓ ${options.provider} OAuth completed successfully!`));
          console.log(COLORS.info(`  Account: ${result.account || 'authenticated'}`));
        } else {
          console.log(COLORS.error(`\n✗ OAuth failed: ${result.error}`));
          process.exit(1);
        }
      } else {
        // Start local OAuth callback server
        console.log(COLORS.info('\nStarting OAuth callback server...'));
        console.log(COLORS.info(`  URL: http://localhost:${options.port}/callback`));
        console.log(COLORS.info('  Waiting for browser to complete authentication...'));
        
        const { startOAuthServer } = await import('./lib/oauth-callback-server.js');
        const serverResult = await startOAuthServer(options.provider, parseInt(options.port));
        
        spinner.stop();
        
        if (serverResult.success) {
          console.log(COLORS.success(`\n✓ ${options.provider} OAuth completed successfully!`));
          console.log(COLORS.info(`  Account: ${serverResult.account || 'authenticated'}`));
        } else {
          console.log(COLORS.error(`\n✗ OAuth failed: ${serverResult.error}`));
          process.exit(1);
        }
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('oauth:init <provider>')
  .description('Start OAuth flow for a provider (opens browser)')
  .option('-p, --port <port>', 'Callback port', '3847')
  .action(async (provider, options) => {
    const supported = ['github', 'google', 'openai', 'huggingface'];
    if (!supported.includes(provider.toLowerCase())) {
      console.log(COLORS.error(`\nError: Unsupported provider '${provider}'`));
      console.log(COLORS.info(`Supported providers: ${supported.join(', ')}`));
      process.exit(1);
    }

    const spinner = ora(`Starting ${provider} OAuth flow...`).start();
    
    try {
      // Get OAuth URL from server
      const result = await apiRequest('/auth/oauth/url', {
        method: 'POST',
        data: { provider, callbackPort: parseInt(options.port) },
      });
      
      spinner.stop();
      
      if (result.url) {
        console.log(COLORS.success(`\n✓ Opening OAuth URL for ${provider}...`));
        console.log(COLORS.info(`  URL: ${result.url}`));
        console.log(COLORS.info(`  Callback: http://localhost:${options.port}/callback`));
        
        // Open browser
        const open = process.platform === 'win32' ? 'start' : 'open';
        spawn(open, [result.url], { detached: true, stdio: 'ignore' });
        
        // Start callback server
        const { startOAuthServer } = await import('./lib/oauth-callback-server.js');
        const serverResult = await startOAuthServer(provider, parseInt(options.port));
        
        if (serverResult.success) {
          console.log(COLORS.success(`\n✓ ${provider} OAuth completed successfully!`));
        } else {
          console.log(COLORS.error(`\n✗ OAuth failed: ${serverResult.error}`));
          process.exit(1);
        }
      } else {
        console.log(COLORS.error(`\n✗ Failed to get OAuth URL: ${result.error}`));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('tools:execute <tool> [args...]')
  .description('Execute a tool')
  .option('--json <json>', 'Arguments as JSON string')
  .action(async (tool, args, options) => {
    let input;
    
    if (options.json) {
      input = JSON.parse(options.json);
    } else if (args.length > 0) {
      input = { args };
    } else {
      input = {};
    }
    
    const spinner = ora(`Executing ${tool}...`).start();
    
    try {
      const result = await apiRequest('/tools/execute', {
        method: 'POST',
        data: {
          toolKey: tool,
          input,
        },
      });
      
      spinner.stop();
      
      if (result.success) {
        console.log(COLORS.success('\nTool executed successfully!'));
        console.log(COLORS.primary('Output:'));
        console.log(JSON.stringify(result.output, null, 2));
      } else {
        console.log(COLORS.error(`Error: ${result.error?.message || result.error}`));
        process.exit(1);
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// ============================================================================
// SKILLS COMMANDS
// ============================================================================

program
  .command('skills:list')
  .description('List available skills')
  .action(async () => {
    const spinner = ora('Loading skills...').start();
    try {
      const result = await apiRequest('/skills');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Available Skills ===\n'));
      for (const skill of result.skills || result) {
        console.log(COLORS.primary(`${skill.name || skill.id}:`) + ` ${skill.description || 'No description'}`);
        console.log(`  ${COLORS.info('Commands:')} ${skill.commands?.join(', ') || 'N/A'}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('mem0:search <query>')
  .description('Search mem0 memories')
  .option('-l, --limit <limit>', 'Maximum results', '10')
  .action(async (query, options) => {
    const spinner = ora('Searching memories...').start();
    try {
      const result = await apiRequest('/memory/search', {
        method: 'POST',
        data: { query, limit: parseInt(options.limit) },
      });
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Memory Results ===\n'));
      for (const mem of result.memories || []) {
        console.log(COLORS.primary(`${mem.id}:${mem.timestamp ? ' (' + mem.timestamp + ')' : ''}`));
        console.log(`  ${mem.content}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('mem0:remember <content>')
  .description('Store a memory in mem0')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (content, options) => {
    const spinner = ora('Storing memory...').start();
    try {
      const result = await apiRequest('/memory/add', {
        method: 'POST',
        data: { content, tags: options.tags?.split(',') },
      });
      spinner.stop();
      console.log(COLORS.success('\nMemory stored successfully!'));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// PLAYWRIGHT COMMANDS
// ============================================================================

program
  .command('playwright:run <file>')
  .description('Run Playwright tests')
  .option('-h, --headed', 'Run in headed mode')
  .option('-r, --reporter <reporter>', 'Reporter (list, line, json)', 'list')
  .option('--grep <pattern>', 'Filter tests by pattern')
  .action(async (file, options) => {
    const spinner = ora('Running tests...').start();
    try {
      const result = await apiRequest('/code/playwright/run', {
        method: 'POST',
        data: {
          file,
          headed: options.headed,
          reporter: options.reporter,
          grep: options.grep,
        },
      });
      spinner.stop();
      console.log(COLORS.success(`\nTests: ${result.passed} passed, ${result.failed} failed`));
      if (result.failed > 0) {
        console.log(COLORS.error(`Failures: ${result.failures}`));
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('playwright:record')
  .description('Start Playwright recording session')
  .option('-u, --url <url>', 'Starting URL', 'http://localhost:3000')
  .action(async (options) => {
    const spinner = ora('Starting recorder...').start();
    try {
      const result = await apiRequest('/code/playwright/record', {
        method: 'POST',
        data: { url: options.url },
      });
      spinner.stop();
      console.log(COLORS.success('\nRecording session started'));
      console.log(COLORS.info(`URL: ${result.recordingUrl}`));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('playwright:sessions:list')
  .description('List Playwright recording sessions')
  .action(async () => {
    const spinner = ora('Loading sessions...').start();
    try {
      const result = await apiRequest('/code/playwright/sessions');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Recording Sessions ===\n'));
      for (const s of result.sessions || []) {
        console.log(COLORS.primary(`${s.id}:`) + ` ${s.url} (${s.status})`);
        console.log(`  ${COLORS.info('Created:')} ${s.createdAt}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// MCP COMMANDS
// ============================================================================

program
  .command('mcp:list')
  .description('List available MCP servers')
  .action(async () => {
    const spinner = ora('Loading MCP servers...').start();
    try {
      const result = await apiRequest('/mcp/store');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== MCP Servers ===\n'));
      for (const server of result.servers || result) {
        console.log(COLORS.primary(`${server.name}:`) + ` ${server.description || 'No description'}`);
        console.log(`  ${COLORS.info('Tools:')} ${server.tools?.join(', ') || 'N/A'}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('mcp:add <name>')
  .description('Add an MCP server')
  .option('-c, --config <config>', 'Configuration as JSON')
  .option('-u, --url <url>', 'MCP server URL')
  .action(async (name, options) => {
    if (!validateRequired(name, 'Server name')) return;

    const spinner = ora(`Adding MCP server ${name}...`).start();
    let config: any = { url: options.url };

    if (options.config) {
      const parsed = safeParseJSON(options.config);
      if (!parsed) {
        spinner.stop();
        console.log(COLORS.error('\nError: Invalid JSON in --config'));
        return;
      }
      config = parsed;
    } else if (!options.url) {
      spinner.stop();
      console.log(COLORS.error('\nError: Either --config or --url is required'));
      return;
    }

    try {
      const result = await apiRequest('/mcp/store', {
        method: 'POST',
        data: { name, ...config },
      });
      spinner.stop();
      console.log(COLORS.success('\nMCP server added!'));
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Add MCP server failed');
    }
  });

program
  .command('mcp:start <name>')
  .description('Start an MCP server')
  .action(async (name) => {
    const spinner = ora(`Starting MCP server ${name}...`).start();
    try {
      const result = await apiRequest(`/mcp/store/${name}/start`, { method: 'POST' });
      spinner.stop();
      console.log(COLORS.success(`\nMCP server ${name} started`));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// CHECKPOINT COMMANDS
// ============================================================================

program
  .command('checkpoint:create [label]')
  .description('Create a checkpoint')
  .option('-s, --session <sessionId>', 'Session ID')
  .action(async (label, options) => {
    const spinner = ora('Creating checkpoint...').start();
    try {
      const result = await apiRequest('/sandbox/checkpoints', {
        method: 'POST',
        data: { label, sessionId: options.session },
      });
      spinner.stop();
      console.log(COLORS.success(`\nCheckpoint created: ${result.checkpointId}`));
      console.log(COLORS.info(`Session: ${result.sessionId}`));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('checkpoint:list')
  .description('List checkpoints')
  .option('-s, --session <sessionId>', 'Session ID')
  .option('-l, --limit <limit>', 'Maximum results', '10')
  .action(async (options) => {
    const spinner = ora('Loading checkpoints...').start();
    try {
      const result = await apiRequest(`/sandbox/checkpoints?sessionId=${options.session || ''}&limit=${options.limit || 10}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Checkpoints ===\n'));
      for (const cp of result.checkpoints || []) {
        console.log(COLORS.primary(`${cp.checkpointId}:`) + ` ${cp.label || 'No label'}`);
        console.log(`  ${COLORS.info('Created:')} ${new Date(cp.timestamp).toISOString()}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('checkpoint:restore <checkpointId>')
  .description('Restore a checkpoint')
  .action(async (checkpointId) => {
    const spinner = ora(`Restoring checkpoint ${checkpointId}...`).start();
    try {
      const result = await apiRequest(`/sandbox/checkpoints/${checkpointId}/restore`, { method: 'POST' });
      spinner.stop();
      console.log(COLORS.success('\nCheckpoint restored successfully!'));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('checkpoint:delete <checkpointId>')
  .description('Delete a checkpoint')
  .action(async (checkpointId) => {
    const spinner = ora(`Deleting checkpoint ${checkpointId}...`).start();
    try {
      await apiRequest(`/sandbox/checkpoints/${checkpointId}`, { method: 'DELETE' });
      spinner.stop();
      console.log(COLORS.success('\nCheckpoint deleted'));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// AGENTS COMMANDS
// ============================================================================

program
  .command('agents:list')
  .description('List running agents')
  .action(async () => {
    const spinner = ora('Loading agents...').start();
    try {
      const result = await apiRequest('/kernel/agents/list');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Running Agents ===\n'));
      for (const agent of result.agents || result) {
        console.log(COLORS.primary(`${agent.id}:`) + ` ${agent.status} (${agent.type})`);
        console.log(`  ${COLORS.info('Started:')} ${agent.startedAt}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('agents:create <type>')
  .description('Create a new agent')
  .option('-n, --name <name>', 'Agent name')
  .option('-p, --provider <provider>', 'Provider to use')
  .option('-m, --model <model>', 'Model to use')
  .action(async (type, options) => {
    const spinner = ora('Creating agent...').start();
    try {
      const result = await apiRequest('/kernel/agents', {
        method: 'POST',
        data: { type, name: options.name, provider: options.provider, model: options.model },
      });
      spinner.stop();
      console.log(COLORS.success(`\nAgent created: ${result.agentId}`));
      console.log(COLORS.info(`Type: ${result.type}`));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program

// ============================================================================
// EVENTS / CRON COMMANDS
// ============================================================================

program
  .command('events:list')
  .description('List events')
  .option('-t, --type <type>', 'Filter by type')
  .option('-s, --status <status>', 'Filter by status')
  .option('-l, --limit <limit>', 'Limit results', '20')
  .action(async (options) => {
    const spinner = ora('Loading events...').start();
    try {
      const params = new URLSearchParams({ limit: options.limit || '20' });
      if (options.type) params.append('type', options.type);
      if (options.status) params.append('status', options.status);
      const result = await apiRequest(`/events?${params}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Events ===\n'));
      for (const event of result.events || result) {
        console.log(COLORS.primary(`${event.id}:`) + ` ${event.type} (${event.status})`);
        console.log(`  ${COLORS.info('Created:')} ${event.createdAt}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('events:stream')
  .description('Stream events in real-time (SSE)')
  .option('-t, --type <type>', 'Filter by event type')
  .action(async (options) => {
    console.log(chalk.cyanBright('\n=== Streaming Events (Ctrl+C to stop) ===\n'));
    try {
      const config = loadConfig();
      const url = `${config.apiBase}/events/stream${options.type ? '?type=' + options.type : ''}`;
      const auth = loadAuth();
      const response = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        console.log(COLORS.info(decoder.decode(value)));
      }
    } catch (error: any) {
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('cron:list')
  .description('List scheduled tasks')
  .action(async () => {
    const spinner = ora('Loading scheduled tasks...').start();
    try {
      const result = await apiRequest('/automations/n8n/workflows');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Scheduled Tasks ===\n'));
      for (const task of result.workflows || result) {
        console.log(COLORS.primary(`${task.id}:`) + ` ${task.name}`);
        console.log(`  ${COLORS.info('Schedule:')} ${task.schedule || 'N/A'} | ${COLORS.info('Status:')} ${task.status}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('cron:run <workflowId>')
  .description('Run a scheduled task manually')
  .action(async (workflowId) => {
    const spinner = ora(`Running workflow ${workflowId}...`).start();
    try {
      const result = await apiRequest(`/automations/n8n/workflows/${workflowId}/run`, { method: 'POST' });
      spinner.stop();
      console.log(COLORS.success(`\nWorkflow started: ${result.executionId}`));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// KERNEL / SYSTEM COMMANDS
// ============================================================================

program
  .command('kernel:stats')
  .description('Get kernel statistics')
  .action(async () => {
    const spinner = ora('Loading kernel stats...').start();
    try {
      const result = await apiRequest('/kernel/stats');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Kernel Statistics ===\n'));
      console.log(`${COLORS.primary('Agents:')} ${result.agents?.running || 0} running / ${result.agents?.total || 0} total`);
      console.log(`${COLORS.primary('Memory:')} ${result.memory?.used || 0}MB / ${result.memory?.total || 0}MB`);
      console.log(`${COLORS.primary('CPU:')} ${result.cpu?.percent || 0}%`);
      console.log(`${COLORS.primary('Events:')} ${result.events?.queued || 0} queued`);
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// DESKTOP COMMANDS
// ============================================================================

program
  .command('desktop:start')
  .description('Start desktop app')
  .option('-p, --port <port>', 'Port', '3000')
  .action(async (options) => {
    const spinner = ora('Starting desktop app...').start();
    try {
      const result = await apiRequest('/backend/start', {
        method: 'POST',
        data: { port: options.port },
      });
      spinner.stop();
      console.log(COLORS.success('\nDesktop app started'));
      console.log(COLORS.info(`URL: ${result.url}`));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('desktop:status')
  .description('Check desktop app status')
  .action(async () => {
    const spinner = ora('Checking desktop status...').start();
    try {
      const result = await apiRequest('/backend/status');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Desktop Status ===\n'));
      console.log(`${COLORS.primary('Status:')} ${result.running ? COLORS.success('Running') : COLORS.warning('Not running')}`);
      if (result.running) {
        console.log(`${COLORS.primary('URL:')} ${result.url}`);
        console.log(`${COLORS.primary('Version:')} ${result.version}`);
        console.log(`${COLORS.primary('Workspace:')} ${result.workspace}`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('desktop:stop')
  .description('Stop desktop app')
  .action(async () => {
    const spinner = ora('Stopping desktop app...').start();
    try {
      await apiRequest('/backend/stop', { method: 'POST' });
      spinner.stop();
      console.log(COLORS.success('\nDesktop app stopped'));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('desktop:open <path>')
  .description('Open file/folder in desktop app')
  .action(async (path) => {
    const spinner = ora('Opening in desktop...').start();
    try {
      const result = await apiRequest('/backend/open', {
        method: 'POST',
        data: { path },
      });
      spinner.stop();
      console.log(COLORS.success('\nOpened in desktop app'));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// PROMPTS COMMANDS
// ============================================================================

program
  .command('prompts:list')
  .description('List available prompts')
  .action(async () => {
    const spinner = ora('Loading prompts...').start();
    try {
      const result = await apiRequest('/prompts');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Available Prompts ===\n'));
      for (const prompt of result.prompts || result) {
        console.log(COLORS.primary(`${prompt.name}:`) + ` ${prompt.description || 'No description'}`);
        console.log(`  ${COLORS.info('Parameters:')} ${Object.keys(prompt.parameters || {}).join(', ') || 'None'}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('prompts:compose <name>')
  .description('Compose a prompt with parameters')
  .option('-p, --params <params>', 'Parameters as JSON')
  .action(async (name, options) => {
    const spinner = ora('Composing prompt...').start();
    try {
      const params = options.params ? JSON.parse(options.params) : {};
      const result = await apiRequest('/prompts/compose', {
        method: 'POST',
        data: { name, ...params },
      });
      spinner.stop();
      console.log(COLORS.success('\nPrompt composed:'));
      console.log(result.prompt);
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// PLUGINS COMMANDS
// ============================================================================

program
  .command('plugins:list')
  .description('List available plugins')
  .action(async () => {
    const spinner = ora('Loading plugins...').start();
    try {
      const result = await apiRequest('/plugins');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Available Plugins ===\n'));
      for (const plugin of result.plugins || result) {
        console.log(COLORS.primary(`${plugin.name}:`) + ` ${plugin.description || 'No description'}`);
        console.log(`  ${COLORS.info('Category:')} ${plugin.category} | ${COLORS.info('Enabled:')} ${plugin.enabled ? 'Yes' : 'No'}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('plugins:enable <name>')
  .description('Enable a plugin')
  .action(async (name) => {
    const spinner = ora(`Enabling plugin ${name}...`).start();
    try {
      await apiRequest(`/plugins/${name}/enable`, { method: 'POST' });
      spinner.stop();
      console.log(COLORS.success('\nPlugin enabled'));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('plugins:disable <name>')
  .description('Disable a plugin')
  .action(async (name) => {
    const spinner = ora(`Disabling plugin ${name}...`).start();
    try {
      await apiRequest(`/plugins/${name}/disable`, { method: 'POST' });
      spinner.stop();
      console.log(COLORS.success('\nPlugin disabled'));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// CODE EXECUTION COMMANDS
// ============================================================================

program
  .command('code:run <code>')
  .description('Run code snippet')
  .option('-l, --language <language>', 'Language', 'javascript')
  .action(async (code, options) => {
    const spinner = ora('Running code...').start();
    try {
      const result = await apiRequest('/code/run', {
        method: 'POST',
        data: { code, language: options.language },
      });
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Output ===\n'));
      console.log(result.output || result.result);
      if (result.error) {
        console.log(COLORS.error(`\nError: ${result.error}`));
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('code:snippet:list')
  .description('List saved code snippets')
  .action(async () => {
    const spinner = ora('Loading snippets...').start();
    try {
      const result = await apiRequest('/code/snippets');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Code Snippets ===\n'));
      for (const snippet of result.snippets || result) {
        console.log(COLORS.primary(`${snippet.name}:`) + ` ${snippet.language}`);
        console.log(`  ${snippet.code.slice(0, 100)}...\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// MODEL COMMANDS
// ============================================================================

program
  .command('models:list')
  .description('List available models')
  .option('-p, --provider <provider>', 'Filter by provider')
  .action(async (options) => {
    const spinner = ora('Loading models...').start();
    try {
      const result = await apiRequest(`/models${options.provider ? '?provider=' + options.provider : ''}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Available Models ===\n'));
      for (const model of result.models || result) {
        console.log(COLORS.primary(`${model.name}:`) + ` ${model.provider}`);
        console.log(`  ${COLORS.info('Context:')} ${model.contextLength || 'N/A'} | ${COLORS.info('Price:')} $${model.inputPrice}/1M tokens\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('models:compare')
  .description('Compare model performance')
  .option('-p, --prompt <prompt>', 'Test prompt')
  .option('-m, --models <models>', 'Comma-separated model names')
  .action(async (options) => {
    const spinner = ora('Comparing models...').start();
    try {
      const result = await apiRequest('/models/compare', {
        method: 'POST',
        data: {
          prompt: options.prompt,
          models: options.models?.split(','),
        },
      });
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Model Comparison ===\n'));
      for (const comparison of result.comparisons || []) {
        console.log(COLORS.primary(`${comparison.model}:`));
        console.log(`  ${COLORS.info('Response:')} ${comparison.response?.slice(0, 100)}...`);
        console.log(`  ${COLORS.info('Time:')} ${comparison.time?.toFixed(2)}ms | ${COLORS.info('Tokens:')} ${comparison.tokens}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// INTEGRATIONS COMMANDS
// ============================================================================

program
  .command('integrations:figma')
  .description('Figma integration commands')
  .option('-a, --action <action>', 'Action: list, export, files')
  .option('-f, --file <fileId>', 'Figma file ID')
  .option('-n, --node <nodeId>', 'Figma node ID')
  .action(async (options) => {
    const spinner = ora('Loading Figma integration...').start();
    try {
      const endpoint = options.action === 'export' ? `/integrations/figma/export` : `/integrations/figma/files`;
      const data = options.file ? { fileId: options.file, nodeId: options.node } : {};
      const result = await apiRequest(endpoint, { method: 'POST', data });
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Figma Results ===\n'));
      console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('integrations:github')
  .description('GitHub integration commands')
  .option('-a, --action <action>', 'Action: repos, issues, prs')
  .option('-r, --repo <repo>', 'Repository')
  .action(async (options) => {
    const spinner = ora('Loading GitHub integration...').start();
    try {
      const result = await apiRequest(`/integrations/github/${options.action || 'repos'}${options.repo ? '/' + options.repo : ''}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== GitHub Results ===\n'));
      for (const item of result.data || result) {
        console.log(COLORS.primary(`${item.name || item.title}:`) + ` ${item.description || ''}`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('integrations:nango')
  .description('Nango integration commands')
  .option('-a, --action <action>', 'Action: connections, sync')
  .option('-p, --provider <provider>', 'Provider name')
  .action(async (options) => {
    const spinner = ora('Loading Nango integration...').start();
    try {
      const result = await apiRequest(`/integrations/nango/${options.action || 'connections'}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Nango Connections ===\n'));
      for (const conn of result.connections || result) {
        console.log(COLORS.primary(`${conn.provider}:`) + ` ${conn.status} (${conn.accountId})`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// CONTENT PANELS COMMANDS
// ============================================================================

program
  .command('music:search <query>')
  .description('Search music')
  .option('-l, --limit <limit>', 'Results limit', '10')
  .action(async (query, options) => {
    const spinner = ora('Searching music...').start();
    try {
      const result = await apiRequest(`/music/search?q=${encodeURIComponent(query)}&limit=${options.limit || 10}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Music Results ===\n'));
      for (const track of result.tracks || result) {
        console.log(COLORS.primary(`${track.name}:`) + ` ${track.artist}`);
        console.log(`  ${COLORS.info('Album:')} ${track.album} | ${COLORS.info('Duration:')} ${track.duration}s\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('music:playlist <name>')
  .description('Create or list playlists')
  .option('-c, --create', 'Create new playlist')
  .action(async (name, options) => {
    const spinner = ora(options.create ? 'Creating playlist...' : 'Loading playlists...').start();
    try {
      const endpoint = options.create ? '/music/playlist' : '/music/playlists';
      const result = options.create 
        ? await apiRequest(endpoint, { method: 'POST', data: { name } })
        : await apiRequest(endpoint);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Playlists ===\n'));
      for (const playlist of result.playlists || result) {
        console.log(COLORS.primary(`${playlist.name}:`) + ` ${playlist.trackCount} tracks`);
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

program
  .command('art:gallery')
  .description('List art gallery')
  .option('-c, --category <category>', 'Filter by category')
  .option('-l, --limit <limit>', 'Results limit', '20')
  .action(async (options) => {
    const spinner = ora('Loading gallery...').start();
    try {
      const result = await apiRequest(`/art-gallery${options.category ? '?category=' + options.category : ''}&limit=${options.limit || 20}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Art Gallery ===\n'));
      for (const art of result.artworks || result) {
        console.log(COLORS.primary(`${art.title}:`) + ` ${art.artist}`);
        console.log(`  ${COLORS.info('Category:')} ${art.category} | ${COLORS.info('Likes:')} ${art.likes}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// OAuth handler — lazy-loaded because the module may not exist in CLI-only installs
let oauthHandler: any = null;
// Lazy-loaded: dynamic import() fails gracefully if module doesn't exist
// Cannot use top-level await in CommonJS — init lazily on first access
async function getOauthHandler(): Promise<any> {
  if (!oauthHandler) {
    try {
      // @ts-expect-error — module may not exist in CLI-only install
      const mod = await import('./src/oauth-handler');
      oauthHandler = mod.default || mod;
    } catch {
      // oauth-handler not available; login will use email/password only
      oauthHandler = null;
    }
  }
  return oauthHandler;
}

program
  .command('login')
  .description('Log in to binG')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .option('--provider <provider>', 'OAuth provider (e.g., github)')
  .action(async (options) => {
    console.log(chalk.cyanBright('\n=== binG Authentication ===\n'));
    
    let email = options.email;
    let password = options.password;
    let provider = options.provider;

    const auth = loadAuth();

    // Check if already logged in and prompt for re-login
    if (auth.token && auth.expiresAt && new Date(auth.expiresAt) > new Date()) {
        const shouldRelogin = await confirm(`Already logged in as ${auth.email}. Relogin?`);
        if (!shouldRelogin) {
            console.log(COLORS.info('Skipping login.'));
            return;
        }
        console.log(COLORS.info('Clearing existing session...'));
        saveAuth({ token: null, userId: null, email: null });
    }

    // Prompt for auth method if not fully provided via options
    if (!provider && !options.email && !options.password) {
        const authMethodChoice = await prompt(
            COLORS.primary('Enter email/password manually, or press Enter to use OAuth: ')
        );

        if (authMethodChoice.trim()) {
            email = authMethodChoice;
            password = await prompt(COLORS.primary('Password: '));
        } else {
            provider = 'github'; 
            console.log(COLORS.info(`Initiating OAuth flow via ${provider}...`));
        }
    } else if (options.provider) {
        provider = options.provider;
    }

    const spinner = ora('Authenticating...').start();

    try {
        let authResult;
        if (provider) {
            authResult = await (await getOauthHandler()).performOauthLogin(provider);
            saveAuth({
                token: authResult.token,
                userId: authResult.userId,
                email: authResult.email,
                expiresAt: authResult.expiresAt,
            });
            console.log(COLORS.success('\n✓ Authentication successful via OAuth!'));
            console.log(`  User: ${COLORS.info(authResult.email)}`);
        } else {
            if (!email) email = await prompt(COLORS.primary('Email: '));
            if (!password) password = await prompt(COLORS.primary('Password: '));
            if (!validateRequired(email, 'Email')) return;
            if (!validateRequired(password, 'Password')) return;

            authResult = await apiRequest('/auth/login', {
                method: 'POST',
                data: { email, password },
            });
            
            saveAuth({
                token: authResult.token,
                userId: authResult.userId,
                email: email,
                expiresAt: authResult.expiresAt,
            });

            console.log(COLORS.success('\n✓ Authentication successful!'));
            console.log(`  User: ${COLORS.info(email)}`);
        }
        spinner.stop();
    } catch (error: any) {
        spinner.stop();
        handleError(error, 'Login failed');
        process.exit(1);
    }
  });

program
  .command('bookmarks:list')
  .description('List bookmarks')
  .option('-c, --category <category>', 'Filter by category')
  .action(async (options) => {
    const spinner = ora('Loading bookmarks...').start();
    try {
      const result = await apiRequest(`/bookmarks${options.category ? '?category=' + options.category : ''}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Bookmarks ===\n'));
      for (const bm of result.bookmarks || result) {
        console.log(COLORS.primary(`${bm.title}:`) + ` ${bm.url}`);
        console.log(`  ${COLORS.info('Tags:')} ${bm.tags?.join(', ') || 'None'}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('bookmarks:add <url> <title>')
  .description('Add bookmark')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (url, title, options) => {
    const spinner = ora('Adding bookmark...').start();
    try {
      await apiRequest('/bookmarks', {
        method: 'POST',
        data: { url, title, tags: options.tags?.split(',') },
      });
      spinner.stop();
      console.log(COLORS.success('\nBookmark added!'));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('news:latest')
  .description('Get latest news')
  .option('-s, --source <source>', 'News source')
  .option('-l, --limit <limit>', 'Results limit', '10')
  .action(async (options) => {
    const spinner = ora('Loading news...').start();
    try {
      const result = await apiRequest(`/news/latest?source=${options.source || ''}&limit=${options.limit || 10}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Latest News ===\n'));
      for (const article of result.articles || result) {
        console.log(COLORS.primary(`${article.title}:`));
        console.log(`  ${article.summary?.slice(0, 100)}...`);
        console.log(`  ${COLORS.info('Source:')} ${article.source} | ${article.publishedAt}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('mindmap:create <topic>')
  .description('Create mind map')
  .option('-d, --depth <depth>', 'Depth level', '3')
  .action(async (topic, options) => {
    const spinner = ora('Creating mind map...').start();
    try {
      const result = await apiRequest('/mind-map/create', {
        method: 'POST',
        data: { topic, depth: parseInt(options.depth) },
      });
      spinner.stop();
      console.log(COLORS.success('\nMind map created!'));
      console.log(COLORS.info(`Nodes: ${result.nodeCount}`));
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

// ============================================================================
// CONFIGURATION COMMANDS
// ============================================================================

program
  .command('config')
  .description('Show or edit configuration')
  .option('-p, --provider <provider>', 'Set default LLM provider')
  .option('-m, --model <model>', 'Set default model')
  .option('-s, --sandbox <provider>', 'Set default sandbox provider')
  .option('-a, --api <url>', 'Set API base URL')
  .option('--reset', 'Reset to defaults')
  .action(async (options) => {
    let config = loadConfig();
    
    if (options.reset) {
      config = {
        apiBase: DEFAULT_API_BASE,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        sandboxProvider: 'daytona',
      };
      saveConfig(config);
      console.log(COLORS.success('Configuration reset to defaults'));
    } else {
      if (options.provider) config.provider = options.provider;
      if (options.model) config.model = options.model;
      if (options.sandbox) config.sandboxProvider = options.sandbox;
      if (options.api) config.apiBase = options.api;
      
      saveConfig(config);
    }
    
    console.log(COLORS.primary('\nCurrent Configuration:'));
    console.log(`  API Base: ${COLORS.info(config.apiBase)}`);
    console.log(`  Provider: ${COLORS.info(config.provider)}`);
    console.log(`  Model: ${COLORS.info(config.model)}`);
    console.log(`  Sandbox: ${COLORS.info(config.sandboxProvider)}`);
    if (config.currentSandbox) {
      console.log(`  Current Sandbox: ${COLORS.info(config.currentSandbox)}`);
    }
  });

program

program
  .command('logout')
  .description('Logout and clear authentication')
  .action(() => {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
      console.log(COLORS.success('Logged out successfully'));
    } else {
      console.log(COLORS.info('Not logged in'));
    }
  });

program
  .command('status')
  .description('Show system status')
  .action(async () => {
    console.log(chalk.cyanBright('\n=== binG System Status ===\n'));
    
    try {
      const [health, providers, quota] = await Promise.all([
        apiRequest('/health', { method: 'GET' }).catch(() => null),
        apiRequest('/providers', { method: 'GET' }).catch(() => null),
        apiRequest('/quota', { method: 'GET' }).catch(() => null),
      ]);

      const auth = loadAuth();
      const config = loadConfig();

      console.log(COLORS.primary('Authentication:'));
      console.log(`  Status: ${auth.token ? COLORS.success('Logged in') : COLORS.warning('Not logged in')}`);
      if (auth.email) {
        console.log(`  User: ${COLORS.info(auth.email)}`);
      }

      console.log('\n' + COLORS.primary('Configuration:'));
      console.log(`  API: ${COLORS.info(config.apiBase)}`);
      console.log(`  LLM Provider: ${COLORS.info(config.provider)}`);
      console.log(`  Model: ${COLORS.info(config.model)}`);
      console.log(`  Sandbox: ${COLORS.info(config.sandboxProvider)}`);

      console.log('\n' + COLORS.primary('System Health:'));
      if (health) {
        console.log(`  API: ${COLORS.success('Online')}`);
        console.log(`  Version: ${COLORS.info(health.version || 'unknown')}`);
      } else {
        console.log(`  API: ${COLORS.error('Offline')}`);
      }

      if (providers) {
        console.log('\n' + COLORS.primary('LLM Providers:'));
        if (providers.llm && providers.llm.length > 0) {
          providers.llm.forEach((p: any) => {
            const isAvailable = p.isAvailable !== false;
            console.log(`  ${isAvailable ? COLORS.success('✓') : COLORS.warning('○')} ${p.id || p} (${p.models?.length || '?'} models)`);
          });
        } else {
          console.log(`  ${COLORS.warning('No providers configured')}`);
        }

        console.log('\n' + COLORS.primary('Sandbox Providers:'));
        if (providers.sandbox && providers.sandbox.length > 0) {
          providers.sandbox.forEach((p: any) => {
            const isAvailable = p.isAvailable !== false;
            console.log(`  ${isAvailable ? COLORS.success('✓') : COLORS.warning('○')} ${p.id || p}`);
          });
        } else {
          console.log(`  ${COLORS.warning('No providers configured')}`);
        }
      }

      if (quota && quota.quotas) {
        console.log('\n' + COLORS.primary('Quota Status:'));
        quota.quotas.slice(0, 3).forEach((q: any) => {
          const pct = q.percentageUsed.toFixed(0);
          const status = q.percentageUsed > 90 ? COLORS.error('CRITICAL') : q.percentageUsed > 70 ? COLORS.warning('Warning') : COLORS.success('OK');
          console.log(`  ${q.provider}: ${status} (${pct}%)`);
        });
        if (quota.quotas.length > 3) {
          console.log(`  ${COLORS.info(`...and ${quota.quotas.length - 3} more`)}`);
        }
      }

    } catch (error: any) {
      handleError(error, 'Failed to get status');
    }
  });

// ============================================================================

// ============================================================================
// CONFIG COMMANDS

// Helper function to validate config file is valid JSON
function validateConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { valid: true };
    }
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content);
    return { valid: true, config };
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof SyntaxError 
        ? 'Invalid JSON syntax in config file' 
        : error.message 
    };
  }
}


// ============================================================================

program
  .command('config:show')
  .description('Show detailed configuration')
  .option('-j, --json', 'Output as JSON')
  .option('-a, --all', 'Show all including defaults and environment variables')
  .action(async (options) => {
    try {
      const config = loadConfig();
      const auth = loadAuth();

      // Get environment variables that affect the CLI
      const envConfig = {
        DEFAULT_LLM_PROVIDER: process.env.DEFAULT_LLM_PROVIDER || null,
        DEFAULT_MODEL: process.env.DEFAULT_MODEL || null,
        DEFAULT_TEMPERATURE: process.env.DEFAULT_TEMPERATURE || null,
        DEFAULT_MAX_TOKENS: process.env.DEFAULT_MAX_TOKENS || null,
        SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER || null,
        DESKTOP_MODE: process.env.DESKTOP_MODE === 'true' ? 'true' : null,
        DESKTOP_LOCAL_EXECUTION: process.env.DESKTOP_LOCAL_EXECUTION === 'true' ? 'true' : null,
        ENABLE_VOICE_FEATURES: null,
        ENABLE_IMAGE_GENERATION: null,
        ENABLE_CHAT_HISTORY: null,
        ENABLE_CODE_EXECUTION: null,
      };

      if (options.json) {
        // JSON output
        const output = options.all ? {
          configFile: CONFIG_FILE,
          configFileExists: fs.existsSync(CONFIG_FILE),
          config: config,
          auth: {
            email: auth?.email || null,
            provider: auth?.provider || null,
            expiresAt: auth?.expiresAt || null,
          },
          environmentVariables: envConfig,
          configDir: CONFIG_DIR,
        } : config;
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Formatted output
      const nl = '\n';
      console.log(nl + COLORS.primary('============================================================'));
      console.log(COLORS.primary('  binG CLI Configuration'));
      console.log(COLORS.primary('============================================================'));

      // Configuration file info
      console.log(nl + COLORS.info('Configuration Files:'));
      console.log('   Config Directory: ' + COLORS.success(CONFIG_DIR));
      console.log('   Config File: ' + CONFIG_FILE);
      console.log('   Config Exists: ' + (fs.existsSync(CONFIG_FILE) ? COLORS.success('Yes') : COLORS.warning('No (using defaults)')));
      if (auth?.email) {
        console.log('   Auth File: ' + COLORS.success(CONFIG_DIR.replace('~', process.env.HOME || '~') + '/auth.json'));
      }

      // Config values
      console.log(nl + COLORS.info('Current Configuration:'));
      console.log('   API Base:     ' + COLORS.success(config.apiBase));
      console.log('   LLM Provider: ' + COLORS.success(config.provider));
      console.log('   Model:        ' + COLORS.success(config.model));
      console.log('   Sandbox:      ' + COLORS.success(config.sandboxProvider));

      if (auth?.email) {
        console.log(nl + COLORS.info('Authentication:'));
        console.log('   Email:    ' + COLORS.success(auth.email));
        console.log('   Provider: ' + COLORS.success(auth.provider || 'email/password'));
        if (auth.expiresAt) {
          const expires = new Date(auth.expiresAt);
          const now = new Date();
          const isValid = expires > now;
          console.log('   Expires:  ' + (isValid ? COLORS.success(expires.toLocaleString()) : COLORS.error(expires.toLocaleString() + ' (expired)')));
        }
      }

      if (options.all) {
        // Show environment variables
        console.log(nl + COLORS.info('Environment Variables:'));
        const envKeys = Object.keys(envConfig).filter(k => envConfig[k] !== null);
        if (envKeys.length === 0) {
          console.log('   ' + COLORS.warning('None set'));
        } else {
          for (const key of envKeys) {
            console.log('   ' + key + ': ' + COLORS.success(String(envConfig[key])));
          }
        }

        // Show config structure
        console.log(nl + COLORS.info('Full Config Object:'));
        const configLines = JSON.stringify(config, null, 2).split('\n');
        for (const line of configLines) {
          console.log('   ' + line);
        }

        // Show defaults that would be used
        console.log(nl + COLORS.info('Defaults (when config not set):'));
        console.log('   API Base:     ' + COLORS.success(process.env.DEFAULT_API_BASE || 'https://api.bing.com'));
        console.log('   LLM Provider: ' + COLORS.success(process.env.DEFAULT_LLM_PROVIDER || 'anthropic'));
        console.log('   Model:        ' + COLORS.success(process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-latest'));
        console.log('   Sandbox:      ' + COLORS.success(process.env.SANDBOX_PROVIDER || 'daytona'));
      }

      console.log(nl + COLORS.primary('============================================================\n'));

    } catch (error) {
      handleError(error, 'Failed to show configuration');
    }
  });

program
  .command('config:edit')
  .description('Open config file in editor')
  .option('-e, --editor <editor>', 'Specify editor to use (e.g., vim, code, nano)')
  .action(async (options) => {
    try {
      const config = loadConfig();
      
      // Ensure config file exists
      if (!fs.existsSync(CONFIG_FILE)) {
        console.log(COLORS.info('Config file does not exist, creating with defaults...'));
        saveConfig(config);
      }

      const configPath = CONFIG_FILE;
      const editor = options.editor || process.env.EDITOR || process.env.VISUAL;

      if (editor) {
        console.log(COLORS.info('Opening config in editor: ' + editor));
        spawn(editor, [configPath], { stdio: 'inherit', shell: true });
      } else {
        console.log(COLORS.info('Opening config file: ' + configPath));
        openFileInEditor(configPath);
      }

      console.log(COLORS.success('Config file opened successfully'));
      console.log(COLORS.muted('Note: Edit the file and save to apply changes'));
    } catch (error) {
      handleError(error, 'Failed to open config file');
    }
  });




program
  .command('config:validate')
  .description('Validate config file JSON syntax')
  .action(async () => {
    const validation = validateConfigFile();
    if (validation.valid) {
      console.log(COLORS.success('Config file is valid!'));
      console.log(COLORS.info('Current configuration:'));
      console.log(JSON.stringify(validation.config || loadConfig(), null, 2));
    } else {
      console.log(COLORS.error('Config file is INVALID!'));
      console.log(COLORS.error('Error: ' + validation.error));
      console.log(COLORS.warning("The config file contains invalid JSON. You can:"));
      console.log(COLORS.info('  1. Run "bing config:edit" to fix it manually'));
      console.log(COLORS.info('  2. Delete the config file to reset to defaults'));
      console.log(COLORS.info('Config location: ' + CONFIG_FILE));
    }
  });

// PROVIDERS COMMANDS
// ============================================================================

program
  .command('providers:status')
  .description('Show provider status')
  .option('-p, --provider <provider>', 'Filter by provider')
  .action(async (options) => {
    const spinner = ora('Loading providers...').start();
    try {
      const result = await apiRequest(`/providers${options.provider ? '?provider=' + options.provider : ''}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Provider Status ===\n'));
      for (const p of result.providers || result) {
        const status = p.isAvailable ? COLORS.success('Available') : COLORS.warning('Unavailable');
        console.log(COLORS.primary(`${p.id || p.name}:`) + ` ${status}`);
        if (p.latency) console.log(`  ${COLORS.info('Latency:')} ${p.latency}ms`);
        if (p.quota) console.log(`  ${COLORS.info('Quota:')} ${p.quota.used}/${p.quota.limit}`);
        console.log();
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

program
  .command('providers:enable <provider>')
  .description('Enable a provider')
  .action(async (provider) => {
    if (!validateRequired(provider, 'Provider name')) return;
    const spinner = ora(`Enabling ${provider}...`).start();
    try {
      await apiRequest(`/providers/${provider}/enable`, { method: 'POST' });
      spinner.stop();
      console.log(COLORS.success(`\nProvider ${provider} enabled`));
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Enable provider failed');
    }
  });

program
  .command('providers:disable <provider>')
  .description('Disable a provider')
  .action(async (provider) => {
    if (!validateRequired(provider, 'Provider name')) return;
    const spinner = ora(`Disabling ${provider}...`).start();
    try {
      await apiRequest(`/providers/${provider}/disable`, { method: 'POST' });
      spinner.stop();
      console.log(COLORS.success(`\nProvider ${provider} disabled`));
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Disable provider failed');
    }
  });

// ============================================================================
// LOCAL EXECUTION COMMANDS (Desktop/Local Mode)
// ============================================================================

program
  .command('local:status')
  .description('Show local execution status')
  .action(async () => {
    const mode = localMode;
    console.log(chalk.cyanBright('\n=== Local Execution Status ===\n'));
    console.log(`${COLORS.primary('Mode:')} ${mode.isLocal ? COLORS.success('Local') : COLORS.warning('Hosted')}`);
    console.log(`${COLORS.primary('Desktop:')} ${mode.isDesktop ? COLORS.success('Yes') : COLORS.warning('No')}`);
    console.log(`${COLORS.primary('Workspace:')} ${COLORS.info(mode.workspace)}`);

    const workspaceExists = fs.existsSync(mode.workspace);
    console.log(`\n${COLORS.primary('Workspace exists:')} ${workspaceExists ? COLORS.success('Yes') : COLORS.warning('No')}`);

    if (workspaceExists) {
      try {
        const files = await listLocalDir(mode.workspace);
        console.log(`${COLORS.primary('Files:')} ${files.length}`);
        console.log(COLORS.info(`First 5: ${files.slice(0, 5).join(', ')}`));
      } catch (error: any) {
        console.log(COLORS.error(`Error listing: ${error.message}`));
      }
    }
  });

program
  .command('local:shell <command...>')
  .description('Run a local shell command')
  .option('-d, --cwd <directory>', 'Working directory')
  .option('-s, --stream', 'Stream output in real-time')
  .action(async (command, options) => {
    if (!localMode.isLocal && !localMode.isDesktop) {
      console.log(COLORS.warning('\nNote: Running local commands in hosted mode may have limited functionality.'));
    }

    const cmd = command.join(' ');
    console.log(COLORS.info(`\nExecuting: ${cmd}`));
    console.log(COLORS.info(`CWD: ${options.cwd || process.cwd()}\n`));

    if (options.stream) {
      const proc = spawn(cmd, { shell: true, cwd: options.cwd || process.cwd() });
      proc.stdout?.on('data', (data) => process.stdout.write(data.toString()));
      proc.stderr?.on('data', (data) => process.stderr.write(data.toString()));
      proc.on('close', (code) => process.exit(code || 0));
      proc.on('error', (err) => { console.log(COLORS.error(`Error: ${err.message}`)); process.exit(1); });
    } else {
      const spinner = ora('Running...').start();
      try {
        const result = await runLocalCommand(cmd, options.cwd);
        spinner.stop();
        console.log(result.stdout);
        if (result.stderr) {
          console.log(COLORS.error(result.stderr));
        }
        if (result.code !== 0) {
          console.log(COLORS.warning(`Exit code: ${result.code}`));
        }
      } catch (error: any) {
        spinner.stop();
        console.log(COLORS.error(`Error: ${error.message}`));
      }
    }
  });

program
  .command('local:exec <file> [args...]')
  .description('Execute a local script or binary')
  .option('-w, --workspace <path>', 'Workspace directory', localMode.workspace)
  .action(async (file, args, options) => {
    const workspace = options.workspace || localMode.workspace;
    const filePath = path.isAbsolute(file) ? file : path.join(workspace, file);

    if (!fs.existsSync(filePath)) {
      console.log(COLORS.error(`\nError: File not found: ${filePath}`));
      return;
    }

    const spinner = ora(`Executing ${file}...`).start();
    try {
      const result = await runLocalCommand(`"${filePath}" ${args.join(' ')}`, workspace);
      spinner.stop();
      console.log(result.stdout);
      if (result.stderr) console.log(COLORS.error(result.stderr));
      console.log(COLORS.info(`Exit code: ${result.code}`));
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Execution failed');
    }
  });

program
  .command('local:read <path>')
  .description('Read a local file')
  .option('-l, --lines <lines>', 'Limit to N lines', '100')
  .option('-h, --highlight', 'Enable code highlighting')
  .action(async (pathArg, options) => {
    const workspace = localMode.workspace;
    const filePath = path.isAbsolute(pathArg) ? pathArg : path.join(workspace, pathArg);

    const content = await readLocalFile(filePath);
    if (!content) {
      console.log(COLORS.error(`\nError: File not found: ${filePath}`));
      return;
    }

    const lines = content.split('\n').slice(0, parseInt(options.lines));
    const displayContent = lines.join('\n');

    console.log(chalk.cyanBright(`\n=== ${pathArg} ===\n`));
    console.log(COLORS.info(`Size: ${formatBytes(content.length)} | Lines: ${lines.length}\n`));

    if (options.highlight) {
      console.log(highlightCode(displayContent));
    } else {
      console.log(displayContent);
    }
  });

program
  .command('local:write <path>')
  .description('Write to a local file')
  .option('-c, --content <content>', 'Content to write')
  .option('-a, --append', 'Append instead of overwrite')
  .action(async (pathArg, options) => {
    const workspace = localMode.workspace;
    const filePath = path.isAbsolute(pathArg) ? pathArg : path.join(workspace, pathArg);

    let content = options.content;
    if (!content) {
      content = await promptAsync(COLORS.primary('Enter content (end with empty line): '));
      let line;
      while ((line = await promptAsync('')) !== '') {
        content += '\n' + line;
      }
    }

    const spinner = ora('Writing...').start();
    let success: boolean;

    if (options.append && fs.existsSync(filePath)) {
      const existing = await readLocalFile(filePath);
      success = await writeLocalFile(filePath, existing + '\n' + content);
    } else {
      success = await writeLocalFile(filePath, content);
    }

    spinner.stop();
    if (success) {
      console.log(COLORS.success(`\nWritten to: ${filePath}`));
    } else {
      console.log(COLORS.error('\nFailed to write file'));
    }
  });

program
  .command('local:ls [path]')
  .description('List local directory')
  .option('-a, --all', 'Show hidden files')
  .option('-l, --long', 'Long format')
  .action(async (pathArg, options) => {
    const workspace = localMode.workspace;
    const dirPath = pathArg ? (path.isAbsolute(pathArg) ? pathArg : path.join(workspace, pathArg)) : workspace;

    const files = await listLocalDir(dirPath);
    if (files.length === 0) {
      console.log(COLORS.warning('\nDirectory is empty'));
      return;
    }

    console.log(chalk.cyanBright(`\n=== ${pathArg || workspace} ===\n`));

    let displayFiles = files;
    if (!options.all) {
      displayFiles = files.filter(f => !f.startsWith('.'));
    }

    if (options.long) {
      for (const file of displayFiles) {
        const filePath = path.join(dirPath, file);
        const stat = await fs.stat(filePath);
        const isDir = stat.isDirectory();
        console.log(`${isDir ? COLORS.primary('d') : '-'} ${formatBytes(stat.size).padStart(8)} ${file}`);
      }
    } else {
      const cols = Math.floor((termWidth() || 80) / 20);
      for (let i = 0; i < displayFiles.length; i += cols) {
        const row = displayFiles.slice(i, i + cols).map(f => f.padEnd(18)).join(' ');
        console.log(row);
      }
    }
  });

program
  // ============================================================================
// BYOK KEY COMMANDS
// ============================================================================

program
  .command('keys:list')
  .description('List configured API keys')
  .action(() => {
    const keys = listKeys();
    console.log(chalk.cyanBright('\n=== Configured API Keys ===\n'));
    for (const { provider, hasKey } of keys) {
      const status = hasKey ? COLORS.success('✓ Configured') : COLORS.warning('✗ Not set');
      console.log(`${COLORS.primary(`${provider}:`)} ${status}`);
    }
  });

program
  .command('keys:set <provider> <apiKey>')
  .description('Set API key for a provider')
  .option('-e, --echo', 'Echo key for confirmation')
  .action(async (provider, apiKey, options) => {
    if (!validateRequired(provider, 'Provider name')) return;
    if (!validateRequired(apiKey, 'API key')) return;

    const normalized = provider.toLowerCase();
    const isValid = AVAILABLE_PROVIDERS.some(p => p.id === normalized);

    if (!isValid) {
      console.log(COLORS.error(`\nUnknown provider. Available: ${AVAILABLE_PROVIDERS.map(p => p.id).join(', ')}`));
      return;
    }

    setKey(normalized, apiKey);
    console.log(COLORS.success(`\nAPI key set for ${normalized}`));

    if (options.echo) {
      console.log(COLORS.info(`Key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`));
    }
  });

program
  .command('keys:delete <provider>')
  .description('Delete API key for a provider')
  .action(async (provider) => {
    if (!validateRequired(provider, 'Provider name')) return;

    deleteKey(provider.toLowerCase());
    console.log(COLORS.success(`\nAPI key removed for ${provider}`));
  });

program
  .command('keys:oauth <provider>')
  .description('Open OAuth URL for provider in browser')
  .action(async (provider) => {
    const p = getProvider(provider.toLowerCase());

    if (!p) {
      console.log(COLORS.error(`\nUnknown provider: ${provider}`));
      return;
    }

    if (!p.supportsOAuth) {
      console.log(COLORS.warning(`\n${p.name} does not support OAuth`));
      console.log(COLORS.info('Use: bing keys:set anthropic sk-... to set your key manually'));
      return;
    }

    console.log(chalk.cyanBright('\n=== OAuth Setup ===\n'));
    console.log(COLORS.info(`Opening: ${p.oauthUrl}`));
    console.log(COLORS.warning('After authorizing, paste the API key here:'));

    const newKey = await promptAsync('API Key: ');
    if (newKey.trim()) {
      setKey(provider.toLowerCase(), newKey.trim());
      console.log(COLORS.success('\nKey saved!'));
    }
  });

// ============================================================================
// AGENT BINARY COMMANDS (OpenCode, Pi, Codex, Amp, Claude Code)
// ============================================================================

const AGENT_BINARIES = [
  { id: 'opencode', name: 'OpenCode', desc: 'AI coding agent with SDK server', supportsModels: true },
  { id: 'pi', name: 'Pi', desc: 'Personal AI agent', supportsModels: false },
  { id: 'codex', name: 'Codex', desc: 'OpenAI Codex CLI', supportsModels: true },
  { id: 'amp', name: 'Amp', desc: 'Amp coding agent', supportsModels: true },
  { id: 'claude-code', name: 'Claude Code', desc: 'Anthropic Claude Code', supportsModels: true },
];

program

program
  .command('agents:detect <agent>')
  .description('Detect agent binary location')
  .action(async (agent) => {
    const normalized = agent.toLowerCase();
    const validAgents = AGENT_BINARIES.map(a => a.id);

    if (!validAgents.includes(normalized)) {
      console.log(COLORS.error(`\nUnknown agent: ${agent}`));
      console.log(COLORS.info(`Available: ${validAgents.join(', ')}`));
      return;
    }

    const spinner = ora(`Detecting ${normalized} binary...`).start();

    try {
      const axios = await import('axios');
      let binaryPath: string | null = null;

      if (normalized === 'opencode') {
        const result = await axios.default.get('http://localhost:11434/api/version').catch(() => null);
        if (result) {
          binaryPath = 'OpenCode server running';
        } else {
          let findOpencodeBinary: any = null;
// @ts-expect-error — module may not exist in CLI-only install
try { const mod = await import('../../web/lib/agent-bins/find-opencode-binary'); findOpencodeBinary = mod.findOpencodeBinary; } catch { findOpencodeBinary = null; };
          binaryPath = await findOpencodeBinary();
        }
      } else if (normalized === 'pi') {
        let findPiBinary: any = null;
// @ts-expect-error — module may not exist in CLI-only install
try { const mod = await import('../../web/lib/agent-bins/find-pi-binary'); findPiBinary = mod.findPiBinary; } catch { findPiBinary = null; };
        binaryPath = await findPiBinary();
      } else if (normalized === 'codex') {
        let findCodexBinary: any = null;
// @ts-expect-error — module may not exist in CLI-only install
try { const mod = await import('../../web/lib/agent-bins/find-codex-binary'); findCodexBinary = mod.findCodexBinary; } catch { findCodexBinary = null; };
        binaryPath = await findCodexBinary();
      } else if (normalized === 'amp') {
        let findAmpBinary: any = null;
// @ts-expect-error — module may not exist in CLI-only install
try { const mod = await import('../../web/lib/agent-bins/find-amp-binary'); findAmpBinary = mod.findAmpBinary; } catch { findAmpBinary = null; };
        binaryPath = await findAmpBinary();
      } else if (normalized === 'claude-code') {
        let findClaudeCodeBinary: any = null;
// @ts-expect-error — module may not exist in CLI-only install
try { const mod = await import('../../web/lib/agent-bins/find-claude-code-binary'); findClaudeCodeBinary = mod.findClaudeCodeBinary; } catch { findClaudeCodeBinary = null; };
        binaryPath = await findClaudeCodeBinary();
      }

      spinner.stop();

      if (binaryPath) {
        console.log(COLORS.success(`\n${normalized} found at:`));
        console.log(COLORS.info(binaryPath));
      } else {
        console.log(COLORS.warning(`\n${normalized} not found`));
        console.log(COLORS.info('Install: npm install -g @' + normalized + '/cli'));
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error detecting agent: ${error.message}`));
    }
  });

program
  .command('agents:start <agent>')
  .description('Start agent in server mode')
  .option('-p, --port <port>', 'Server port', '11434')
  .option('-m, --model <model>', 'Model to use')
  .action(async (agent, options) => {
    const normalized = agent.toLowerCase();
    const validAgents = AGENT_BINARIES.map(a => a.id);

    if (!validAgents.includes(normalized)) {
      console.log(COLORS.error(`\nUnknown agent: ${agent}`));
      return;
    }

    const config = loadConfig();

    const spinner = ora(`Starting ${normalized}...`).start();

    try {
      if (normalized === 'opencode') {
        let findOpencodeBinary: any = null;
// @ts-expect-error — module may not exist in CLI-only install
try { const mod = await import('../../web/lib/agent-bins/find-opencode-binary'); findOpencodeBinary = mod.findOpencodeBinary; } catch { findOpencodeBinary = null; };
        const binaryPath = await findOpencodeBinary();

        if (!binaryPath) {
          spinner.stop();
          console.log(COLORS.error('\nOpenCode not found. Install: npm install -g opencode'));
          return;
        }

        const args = ['serve', '--port', options.port];
        if (options.model) args.push('--model', options.model);

        const proc = spawn(binaryPath, args, { stdio: 'inherit', shell: true });
        proc.on('close', (code) => process.exit(code || 0));
        proc.on('error', (err) => {
          spinner.stop();
          console.log(COLORS.error(`Error: ${err.message}`));
        });

        spinner.stop();
        console.log(COLORS.success(`\nOpenCode server started on port ${options.port}`));
        console.log(COLORS.info(`API: http://localhost:${options.port}/api`));
      } else {
        spinner.stop();
        console.log(COLORS.warning(`\n${normalized} does not support server mode`));
        console.log(COLORS.info('Use: bing agents:run ' + normalized + ' <prompt>'));
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('agents:run <agent> <prompt>')
  .description('Run agent with a prompt')
  .option('-m, --model <model>', 'Model to use')
  .option('-s, --stream', 'Enable streaming')
  .action(async (agent, prompt, options) => {
    const normalized = agent.toLowerCase();
    const validAgents = AGENT_BINARIES.map(a => a.id);

    if (!validAgents.includes(normalized)) {
      console.log(COLORS.error(`\nUnknown agent: ${agent}`));
      return;
    }

    const spinner = ora(`Running ${normalized}...`).start();

    try {
      let result: any;

      if (normalized === 'opencode') {
        const response = await apiRequest('/chat', {
          method: 'POST',
          data: {
            messages: [{ role: 'user', content: prompt }],
            model: options.model || 'claude-3-5-sonnet',
            stream: options.stream !== false,
          },
        });
        result = response.response || response.content;
      } else if (normalized === 'codex') {
        let findCodexBinary: any = null;
// @ts-expect-error — module may not exist in CLI-only install
try { const mod = await import('../../web/lib/agent-bins/find-codex-binary'); findCodexBinary = mod.findCodexBinary; } catch { findCodexBinary = null; };
        const binaryPath = await findCodexBinary();

        if (!binaryPath) {
          spinner.stop();
          console.log(COLORS.error('\nCodex not found'));
          return;
        }

        const args = ['exec', '--prompt', prompt];
        if (options.model) args.push('--model', options.model);

        const { promisify } = await import('util');
        const execAsync = promisify(require('child_process').exec);

        result = (await execAsync(`"${binaryPath}" ${args.join(' ')}`)).stdout;
      } else {
        const { findAgentBinary } = await import('../../web/lib/agent-bins/find-' + normalized + '-binary');
        const binaryPath = await findAgentBinary();

        if (!binaryPath) {
          spinner.stop();
          console.log(COLORS.error(`\n${normalized} not found`));
          return;
        }

        const { promisify } = await import('util');
        const execAsync = promisify(require('child_process').exec);
        const args = [prompt];
        if (options.model) args.unshift('--model', options.model);

        result = (await execAsync(`"${binaryPath}" ${args.join(' ')}`)).stdout;
      }

      spinner.stop();

      if (options.stream) {
        console.log(COLORS.success('\n'));
        process.stdout.write(result);
      } else {
        console.log(COLORS.success('\n') + result);
      }
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`Error: ${error.message}`));
    }
  });

program
  .command('agents:stop <agent>')
  .description('Stop agent server')
  .action(async (agent) => {
    const normalized = agent.toLowerCase();

    if (normalized === 'opencode') {
      try {
        await axios.post('http://localhost:11434/api/shutdown');
        console.log(COLORS.success('\nOpenCode server stopped'));
      } catch {
        console.log(COLORS.warning('\nOpenCode server not running'));
      }
    } else {
      console.log(COLORS.warning(`\n${normalized} does not run as server`));
    }
  });

program
  .command('agents:models <agent>')
  .description('List models for agent')
  .action(async (agent) => {
    const normalized = agent.toLowerCase();
    const agentInfo = AGENT_BINARIES.find(a => a.id === normalized);

    if (!agentInfo) {
      console.log(COLORS.error(`\nUnknown agent: ${agent}`));
      return;
    }

    if (!agentInfo.supportsModels) {
      console.log(COLORS.warning(`\n${normalized} does not support model selection`));
      return;
    }

    const MODELS: Record<string, string[]> = {
      opencode: ['claude-3-5-sonnet', 'claude-3-opus', 'gpt-4o', 'gpt-4o-mini'],
      codex: ['claude-3.5-sonnet-20241022', 'gpt-4o'],
      'claude-code': ['claude-3-5-sonnet', 'claude-3-opus'],
      amp: ['claude-3-5-sonnet', 'gpt-4o'],
    };

    const models = MODELS[normalized] || [];
    console.log(chalk.cyanBright(`\n=== ${agentInfo.name} Models ===\n`));
    for (const model of models) {
      console.log(`  ${COLORS.primary(model)}`);
    }
  });

// ============================================================================
// PROVIDER/MODEL COMMANDS
// ============================================================================

program
  .command('providers:models <provider>')
  .description('List available models for a provider')
  .action(async (provider) => {
    if (!validateRequired(provider, 'Provider name')) return;

    const p = getProvider(provider.toLowerCase());
    if (!p) {
      console.log(COLORS.error(`\nUnknown provider: ${provider}`));
      console.log(COLORS.info(`Available: ${AVAILABLE_PROVIDERS.map(x => x.id).join(', ')}`));
      return;
    }

    console.log(chalk.cyanBright(`\n=== ${p.name} Models ===\n`));
    for (const model of p.models) {
      console.log(`  ${COLORS.primary(model)}`);
    }
  });

program
  .command('model:select <provider> <model>')
  .description('Set default model for a provider')
  .action(async (provider, model) => {
    const p = getProvider(provider.toLowerCase());
    if (!p) {
      console.log(COLORS.error(`\nUnknown provider: ${provider}`));
      return;
    }

    if (!p.models.includes(model)) {
      console.log(COLORS.error(`\nInvalid model: ${model}`));
      console.log(COLORS.info(`Available: ${p.models.join(', ')}`));
      return;
    }

    const config = loadConfig();
    config.model = model;
    saveConfig(config);
    console.log(COLORS.success(`\nDefault model set: ${provider}/${model}`));
  });

program
  .command('orchestration:modes')
  .description('List available orchestration modes')
  .action(() => {
    const MODES = [
      { id: 'unified-agent', desc: 'Default unified agent' },
      { id: 'task-router', desc: 'Task-based routing' },
      { id: 'stateful-agent', desc: 'Stateful conversation' },
      { id: 'agent-kernel', desc: 'Kernel-based execution' },
      { id: 'execution-graph', desc: 'Graph-based workflows' },
      { id: 'dual-process', desc: 'Dual process with classifier' },
      { id: 'dual-process:fast', desc: 'Fast dual process' },
      { id: 'cognitive-resonance', desc: 'Cognitive resonance' },
      { id: 'desktop', desc: 'Desktop-only mode' },
    ];

    console.log(chalk.cyanBright('\n=== Orchestration Modes ===\n'));
    for (const mode of MODES) {
      console.log(`${COLORS.primary(`${mode.id}:`)} ${mode.desc}`);
    }
    console.log(COLORS.info('\nUse header: X-Orchestration-Mode: <mode>'));
  });

program
  .command('session:mode <mode>')
  .description('Set default orchestration mode')
  .action(async (mode) => {
    if (!validateRequired(mode, 'Mode')) return;

    const validModes = ['unified-agent', 'task-router', 'stateful-agent', 'agent-kernel', 'execution-graph', 'dual-process', 'cognitive-resonance', 'desktop'];
    if (!validModes.includes(mode)) {
      console.log(COLORS.error(`\nInvalid mode: ${mode}`));
      console.log(COLORS.info(`Valid: ${validModes.join(', ')}`));
      return;
    }

    const config = loadConfig();
    config.orchestrationMode = mode;
    saveConfig(config);
    console.log(COLORS.success(`\nOrchestration mode set to: ${mode}`));
  });

program
  .command('local:mcp')
  .description('Start local MCP server')
  .option('-p, --port <port>', 'Port', '3001')
  .option('-s, --stdio', 'Use stdio transport')
  .action(async (options) => {
    console.log(chalk.cyanBright('\n=== Local MCP Server ===\n'));

    if (options.stdio) {
      console.log(COLORS.info('Starting in stdio mode...'));
      console.log(COLORS.info('Configure your client to connect via stdin/stdout'));
    } else {
      console.log(COLORS.info(`Starting on port ${options.port}...`));
    }

    try {
      const mcpPath = path.join(process.cwd(), 'node_modules', '@modelcontextprotocol', 'server.js');
      if (fs.existsSync(mcpPath)) {
        spawn('node', [mcpPath], { stdio: 'inherit', shell: true });
      } else {
        console.log(COLORS.warning('\nMCP server not found in node_modules'));
        console.log(COLORS.info('Install: npm install @modelcontextprotocol/server'));
      }
    } catch (error: any) {
      handleError(error, 'Failed to start MCP');
    }
  });

// ============================================================================
// POWERS COMMANDS
// ============================================================================

program
  .command('powers:list')
  .description('List available powers (skills)')
  .action(async () => {
    const spinner = ora('Loading powers...').start();
    try {
      const result = await apiRequest('/powers');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Available Powers ===\n'));
      for (const power of result.powers || result) {
        console.log(COLORS.primary(`${power.name}:`) + ` ${power.description}`);
        console.log(`  ${COLORS.info('Commands:')} ${power.commands?.join(', ') || 'N/A'}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

program
  .command('powers:use <power>')
  .description('Use a power')
  .option('-a, --args <args>', 'Power arguments as JSON')
  .action(async (power, options) => {
    if (!validateRequired(power, 'Power name')) return;
    const spinner = ora(`Running power ${power}...`).start();
    try {
      const args = options.args ? safeParseJSON(options.args) : {};
      const result = await apiRequest('/powers/use', {
        method: 'POST',
        data: { power, ...args },
      });
      spinner.stop();
      console.log(COLORS.success('\nPower executed:'));
      console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Power execution failed');
    }
  });

// ============================================================================
// OAUTH COMMANDS
// ============================================================================

program
  .command('oauth:list')
  .description('List OAuth connections')
  .action(async () => {
    const spinner = ora('Loading OAuth connections...').start();
    try {
      const result = await apiRequest('/oauth/connections');
      spinner.stop();
      console.log(chalk.cyanBright('\n=== OAuth Connections ===\n'));
      for (const conn of result.connections || result) {
        const status = conn.connected ? COLORS.success('Connected') : COLORS.warning('Disconnected');
        console.log(COLORS.primary(`${conn.provider}:`) + ` ${status}`);
        if (conn.account) console.log(`  ${COLORS.info('Account:')} ${conn.account}`);
        console.log();
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

program
  .command('oauth:connect <provider>')
  .description('Connect OAuth provider')
  .option('-s, --scopes <scopes>', 'Comma-separated scopes')
  .action(async (provider, options) => {
    if (!validateRequired(provider, 'Provider name')) return;
    const spinner = ora(`Connecting to ${provider}...`).start();
    try {
      const result = await apiRequest('/oauth/connect', {
        method: 'POST',
        data: { provider, scopes: options.scopes?.split(',') },
      });
      spinner.stop();
      console.log(COLORS.success('\nOAuth connection initiated'));
      if (result.url) {
        console.log(COLORS.info(`Please visit: ${result.url}`));
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'OAuth connect failed');
    }
  });

// ============================================================================
// START COMMAND
// ============================================================================

program
  .command('start')
  .description('Start the binG development server')
  .option('-p, --port <port>', 'Port number (default: 3000)')
  .option('--ws-port <port>', 'WebSocket port (default: 8080)')
  .action((options) => {
    console.log(chalk.cyanBright(`
╔═══════════════════════════════════════════════════════════╗
║              Starting binG Development Server              ║
║                                                           ║
║  HTTP Port: ${options.port || 3000}                                    ║
║  WebSocket Port: ${options.wsPort || 8080}                              ║
║                                                           ║
║  Opening http://localhost:${options.port || 3000}...                  ║
╚═══════════════════════════════════════════════════════════╝
    `));
    
    console.log(COLORS.info('\nStarting Next.js development server...'));
    console.log(COLORS.info('Starting WebSocket server...'));
    console.log(COLORS.warning('\nNote: This requires the binG project to be installed locally.'));
    console.log(COLORS.info('Run this command from the binG project directory.\n'));
  });

// ============================================================================
// HELP COMMAND
// ============================================================================

program
  .command('help [topic]')
  .description('Show help for a specific topic or command')
  .action(async (topic) => {
    if (!topic) {
      console.log(chalk.cyanBright(`
╔═══════════════════════════════════════════════════════════════════╗
║                        binG Help                                ║
╚═══════════════════════════════════════════════════════════════════╝

${COLORS.primary('Main Commands:')}
  chat (c)          - Start interactive chat with AI
  ask <message>      - Ask a single question
  sandbox:create     - Create a new sandbox
  sandbox:exec       - Execute command in sandbox
  file:read         - Read file content
  file:write        - Write file content
  file:list         - List directory

${COLORS.primary('Tools:')}
  image:generate    - Generate images
  voice:speak      - Text-to-speech
  providers:list   - List providers
  quota            - Show quotas

${COLORS.primary('Configuration:')}
  config            - View/set config
  auth             - Authentication
  status           - System status

${COLORS.primary('Getting Help:')}
  help <command>    - Help for specific command
  examples         - Usage examples

For more info: https://github.com/quazfenton/binG
`));
      return;
    }

    const helpTopics: Record<string, string> = {
      chat: `chat [options]

Start an interactive chat session with AI agents.

Options:
  -a, --agent <mode>   Agent mode: v1, v2, auto (default: auto)
  -s, --stream        Enable streaming (default: true)
  -p, --provider      LLM provider (default: from config)
  -m, --model        Model name (default: from config)

Examples:
  bing chat
  bing chat --provider anthropic
  bing chat -a v2 --stream`,

      sandbox: `sandbox <subcommand>

Manage sandbox workspaces.

Subcommands:
  sandbox:create     Create a new sandbox
  sandbox:exec      Execute a command
  sandbox:list       List sandboxes
  sandbox:delete    Delete sandbox

Examples:
  bing sandbox:create --gpu H100
  bing sandbox:exec "python train.py"
  bing sandbox:exec "npm install" --cwd /workspace/myapp`,

      preview: `preview <command>

Preview the impact of a command before executing it.

This helps you understand what a command will do before running it.

Examples:
  bing preview "rm -rf node_modules"
  bing preview "delete .env"
  bing preview "write /workspace/test.txt" -c "hello"`,
    };

    if (helpTopics[topic]) {
      console.log(helpTopics[topic]);
    } else {
      console.log(COLORS.warning(`No help available for: ${topic}`));
      console.log(COLORS.info('Try running: bing help'));
    }
  });

program
  .command('examples')
  .description('Show usage examples')
  .action(() => {
    console.log(chalk.cyanBright(`
╔═══════════════════════════════════════════════════════════════════╗
║                     binG Examples                            ║
╚═══════════════════════════════════════════════════════════════════╝

${COLORS.primary('Chat with AI:')}
  bing chat
  bing ask "How do I center a div in CSS?"

${COLORS.primary('Sandbox:')}
  bing sandbox:create -p daytona
  bing sandbox:exec "pip install numpy"
  bing sandbox:exec "python main.py" --cwd /workspace/myproject

${COLORS.primary('Files:')}
  bing file:read /workspace/app.py
  bing file:write /workspace/test.py -c "print('hello')"
  bing file:list /workspace

${COLORS.primary('Images:')}
  bing image:generate "A sunset over mountains"
  bing image:generate "A cute robot" -o robot.png -q high

${COLORS.primary('Voice:')}
  bing voice:speak "Hello world" -o hello.mp3

${COLORS.primary('Preview (Destructive Commands):')}
  bing preview "rm -rf node_modules"
  bing preview "delete .env"
`));
  });

program
  .command('preview <command...>')
  .description('Preview command impact before executing')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (command, options) => {
    const impact = analyzeCommandImpact(command.join(' '));

    console.log(chalk.cyanBright('\n=== Command Preview ===\n'));
    console.log(`${COLORS.primary('Command:')} ${impact.command}`);
    console.log(`${COLORS.primary('Impact:')} ${
      impact.estimatedImpact === 'high'
        ? COLORS.error('HIGH')
        : impact.estimatedImpact === 'medium'
          ? COLORS.warning('MEDIUM')
          : COLORS.success('LOW')
    }`);

    if (impact.filesAffected.length > 0) {
      console.log(`\n${COLORS.primary('Files affected:')}`);
      impact.filesAffected.forEach(f => console.log(`  - ${f}`));
    }

    if (impact.warnings.length > 0) {
      console.log(`\n${COLORS.warning('Warnings:')}`);
      impact.warnings.forEach(w => console.log(`  ⚠ ${w}`));
    }

    if (!options.yes && impact.confirmationRequired) {
      const answer = await prompt(COLORS.warning('\nContinue? (y/N) '));
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(COLORS.info('Cancelled'));
        return;
      }
    }

    console.log(COLORS.info('\nExecuting...'));
  });

program.addHelpText('after', `
${COLORS.primary('Examples:')}
  ${COLORS.info('bing chat')}                    Start interactive chat
  ${COLORS.info('bing ask "Explain quantum computing"')}  Quick question
  ${COLORS.info('bing sandbox:create --gpu H100')}        Create GPU sandbox
  ${COLORS.info('bing sandbox:exec python train.py')}     Execute command
  ${COLORS.info('bing file:read /workspace/app.py')}      Read file
  ${COLORS.info('bing image:generate "A cute cat"')}      Generate image
  ${COLORS.info('bing providers:list')}            List available providers
  ${COLORS.info('bing config --provider openai')}   Set default provider
  ${COLORS.info('bing status')}                    Check system status
  ${COLORS.info('bing quota')}                     Check provider quotas
  ${COLORS.info('bing workflow:list')}             List available workflows
  ${COLORS.info('bing workflow:run <type>')}       Run a workflow

${COLORS.primary('Documentation:')} https://github.com/quazfenton/binG/tree/main/docs
${COLORS.primary('Support:')} https://github.com/quazfenton/binG/issues
`);

// ============================================================================
// ADVANCED TUI - Interactive Visual Interface
// ============================================================================

import { clearScreen, cursorHide, cursorShow, cursorTo } from 'ansi-escapes';

interface TUITheme {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  muted: string;
}

const TUI_THEME: TUITheme = {
  primary: '#00f5d4',
  secondary: '#9b5de5',
  accent: '#f15bb5',
  background: '#0a0a0f',
  text: '#ffffff',
  muted: '#4a4a6a',
};

const NOEMOJI_THEME: TUITheme = {
  primary: '#ff6b6b',
  secondary: '#4ecdc4',
  accent: '#ffe66d',
  background: '#0d1117',
  text: '#e6edf3',
  muted: '#484f58',
};

interface AnimatedChar {
  char: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
}

interface TUIMenuItem {
  id: string;
  label: string;
  icon: string;
  action: string;
  description: string;
}

interface TUIDesign {
  name: string;
  useEmojis: boolean;
  theme: TUITheme;
  particles: string | string[];
  logo: string[];
  accent: string;
}

const DESIGNS: Record<string, TUIDesign> = {
  classic: {
    name: 'Classic',
    useEmojis: true,
    theme: TUI_THEME,
    particles: '◈◇◉○●◐◑◒◓※✦✧★☆⚡∮∞♪♫',
    logo: [
      '     █████╗ ███████╗ ██████╗ ███████╗',
      '    ██╔══██╗██╔════╝██╔════╝ ██╔════╝',
      '    ███████║█████╗  ██║  ███║█████╗ ',
      '    ██╔══██║██╔══╝  ██║  ███║██╔══╝ ',
      '    ██║  ██║███████╗╚██████╔╝███████╗',
      '    ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝',
      '  ███╗   ██╗ ██████╗ ██████╗ ██╗   ██╗',
      '  ████╗  ██║██╔════╝██╔═══██╗╚██╗ ██╔╝',
      '  ██╔██╗ ██║██║     ██║   ██║ ╚████╔╝ ',
      '  ██║╚██╗██║██║     ██║   ██║  ╚██╔╝  ',
      '  ██║ ╚████║╚██████╗╚██████╔╝   ██║   ',
      '  ╚═╝  ╚═══╝ ╚══════╝ ╚═════╝    ╚═╝   ',
    ],
    accent: '▸',
  },
  avantgarde: {
    name: 'Avant-Garde',
    useEmojis: false,
    theme: NOEMOJI_THEME,
    particles: '▓▒░█▪▫▬◆◇●○◐◑◒░▒▓█▓▒░',
    logo: [
      '     ╔═══════════════════════════════╗',
      '     ║   ███╗   ███╗███████╗██████╗  ║',
      '     ║   ████╗ ████║██╔════╝██╔══██╗ ║',
      '     ║   ██╔████╔██║█████╗  ██████╔╝ ║',
      '     ║   ██║╚██╔╝██║██╔══╝  ██╔══██╗ ║',
      '     ║   ██║ ╚═╝ ██║███████╗██║  ██║ ║',
      '     ║   ╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝ ║',
      '     ╚═══════════════════════════════╝',
      '     ╔═══════════════════════════════╗',
      '     ║  ████████╗ █████╗ ██████╗ ██╗  ║',
      '     ║  ╚═══██╔══╝██╔══██╗██╔══██╗██║  ║',
      '     ║     ██║   ███████║██████╔╝██║  ║',
      '     ║     ██║   ██╔══██║██╔══██╗██║  ║',
      '     ║     ██║   ██║  ██║██║  ██║█████╗',
      '     ║     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚════╝',
      '     ╚═══════════════════════════════╝',
    ],
    accent: '◆',
  },
  holochat: {
    name: 'HoloChat',
    useEmojis: false,
    theme: {
      primary: '#00ffff',
      secondary: '#ff00ff',
      accent: '#00ff88',
      background: '#050510',
      text: '#e0ffff',
      muted: '#406080',
    },
    particles: '◇◆◈▣▤▥▦▧▨▩◆◇◈▣▤▥◈◇',
    logo: [
      '  ╭───────────────────────────────────────╮',
      '  │  ╭╮     ╭╮     ╭╮     ╭╮     ╭╮   │',
      '  │ ╱│╰╮   ╱│╰╮   ╱│╰╮   ╱│╰╮   ╱│╰╮  │',
      '  ││ │╰╮ │ │╰╮ │ │╰╮ │ │╰╮ │ │╰╮ │',
      '  ││ │ ╰ ││ │ ╰ ││ │ ╰ ││ │ ╰ ││ │ ╰│',
      '  │╲│╱╲╯   ╲│╱╲╯   ╲│╱╲╯   ╲│╱╲╯  │',
      '  │ ╰╮     ╰╮     ╰╮     ╰╮     ╰╮ │',
      '  ╰───────────────────────────────────────╯',
      '  ┌───────────────────────────────────────┐',
      '  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│',
      '  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│',
      '  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│',
      '  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│',
      '  │▓▓▓▓░╲╱▓▓▓▓▓▓▓╱▓▓▓▓░╲╱▓▓▓▓▓│',
      '  │▓▓▓▓▓░╲╱░╲╱░╲╱░╲╱░╲╱░╲╱░╲╱▓▓▓▓│',
      '  │▓▓▓▓▓▓░╲╱░╲╱░╲╱░╲╱░╲╱░╲╱▓▓▓▓▓│',
      '  └───────────────────────────────────────┘',
    ],
    accent: '▓',
  },
};

let currentDesign = 'avantgarde';

function termWidth(): number {
  return process.stdout.columns || 80;
}

function termHeight(): number {
  return process.stdout.rows || 24;
}

function generateParticles(count: number, design: TUIDesign): AnimatedChar[] {
  const particles: AnimatedChar[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      char: design.particles[Math.floor(Math.random() * design.particles.length)],
      x: Math.random() * termWidth(),
      y: Math.random() * termHeight(),
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      color: [design.theme.primary, design.theme.secondary, design.theme.accent][Math.floor(Math.random() * 3)],
      life: Math.random() * 200,
    });
  }
  return particles;
}

function drawGradientBar(width: number, progress: number, colors: string[]): string {
  const filled = Math.floor(width * progress);
  let bar = '';
  for (let i = 0; i < width; i++) {
    const colorIdx = Math.floor((i / width) * colors.length);
    const color = colors[Math.min(colorIdx, colors.length - 1)];
    bar += i < filled ? `\x1b[38;2;${parseInt(color.slice(1, 3), 16)};${parseInt(color.slice(3, 5), 16)};${parseInt(color.slice(5, 7), 16)}m▀\x1b[0m` : '░';
  }
  return bar;
}

function colorize(text: string, color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function drawBox(lines: string[], x: number, y: number, theme: TUITheme, selected: boolean): string {
  let output = '';
  const maxLen = Math.max(...lines.map(l => l.length));
  const borderColor = selected ? theme.accent : theme.primary;
  const boxColor = selected ? theme.secondary : theme.muted;

  output += `\x1b[${y};${x}f${colorize('┌' + '─'.repeat(maxLen + 2) + '┐', borderColor)}`;
  for (let i = 0; i < lines.length; i++) {
    output += `\x1b[${y + i + 1};${x}f${colorize('│', boxColor)}`;
    output += ` ${colorize(lines[i].padEnd(maxLen), selected ? theme.text : theme.muted)} `;
    output += colorize('│', boxColor);
  }
  output += `\x1b[${y + lines.length + 1};${x}f${colorize('└' + '─'.repeat(maxLen + 2) + '┘', borderColor)}`;
  return output;
}

const MENU_ITEMS_NOEMOJI: TUIMenuItem[] = [
  { id: 'chat', label: 'Chat', icon: '', action: 'chat', description: 'Start an AI conversation' },
  { id: 'ask', label: 'Ask', icon: '', action: 'ask', description: 'Ask a quick question' },
  { id: 'provider', label: 'Provider', icon: '', action: 'providers:list', description: 'Select provider/model' },
  { id: 'keys', label: 'Keys', icon: '', action: 'keys:list', description: 'Manage API keys (BYOK)' },
  { id: 'sandbox', label: 'Sandbox', icon: '', action: 'sandbox:create', description: 'Create a development environment' },
  { id: 'file', label: 'Files', icon: '', action: 'file:list', description: 'Browse workspace files' },
  { id: 'image', label: 'Images', icon: '', action: 'image:generate', description: 'Generate AI images' },
  { id: 'agents', label: 'Agents', icon: '', action: 'agents:list', description: 'Manage running agents' },
  { id: 'status', label: 'Status', icon: '', action: 'status', description: 'View system status' },
  { id: 'config', label: 'Config', icon: '', action: 'config', description: 'Configure settings' },
  { id: 'modes', label: 'Modes', icon: '', action: 'orchestration:modes', description: 'Orchestration modes' },
];

const MENU_ITEMS_EMOJI: TUIMenuItem[] = [
  { id: 'chat', label: 'Chat', icon: '💬', action: 'chat', description: 'Start an AI conversation' },
  { id: 'ask', label: 'Ask', icon: '❓', action: 'ask', description: 'Ask a quick question' },
  { id: 'provider', label: 'Provider', icon: '🔑', action: 'providers:list', description: 'Select provider/model' },
  { id: 'keys', label: 'Keys', icon: '🔐', action: 'keys:list', description: 'Manage API keys (BYOK)' },
  { id: 'sandbox', label: 'Sandbox', icon: '📦', action: 'sandbox:create', description: 'Create a development environment' },
  { id: 'file', label: 'Files', icon: '📁', action: 'file:list', description: 'Browse workspace files' },
  { id: 'image', label: 'Images', icon: '🖼️', action: 'image:generate', description: 'Generate AI images' },
  { id: 'agents', label: 'Agents', icon: '🤖', action: 'agents:list', description: 'Manage running agents' },
  { id: 'status', label: 'Status', icon: '📊', action: 'status', description: 'View system status' },
  { id: 'config', label: 'Config', icon: '⚙️', action: 'config', description: 'Configure settings' },
  { id: 'modes', label: 'Modes', icon: '🔄', action: 'orchestration:modes', description: 'Orchestration modes' },
];

async function runTUI(designName: string = 'avantgarde'): Promise<void> {
  const design = DESIGNS[designName] || DESIGNS.avantgarde;
  const designItems = design.useEmojis ? MENU_ITEMS_EMOJI : MENU_ITEMS_NOEMOJI;

  process.stdout.write(cursorHide + clearScreen);
  let selectedIndex = 0;
  let tick = 0;
  let particles: AnimatedChar[] = [];
  let running = true;

  const rl = createInterface({ input, output });

  function setRawMode(enable: boolean): void {
    if (enable) {
      process.stdin.setRawMode?.(true);
    }
  }

  function renderDesign(): string {
    let output = clearScreen;
    const width = termWidth();
    const height = termHeight();
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const theme = design.theme;

    tick++;
    particles.push(...generateParticles(1, design));
    particles = particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      return p.life > 0 && p.x > 0 && p.x < width && p.y > 0 && p.y < height;
    });

    for (const p of particles) {
      const py = Math.floor(p.y);
      const px = Math.floor(p.x);
      const r = parseInt(p.color.slice(1, 3), 16);
      const g = parseInt(p.color.slice(3, 5), 16);
      const b = parseInt(p.color.slice(5, 7), 16);
      output += `\x1b[${py};${px}f\x1b[38;2;${r};${g};${b}m${p.char}\x1b[0m`;
    }

    const titleY = centerY - 12;
    const artHeight = design.logo.length;
    const artWidth = Math.max(...design.logo.map(l => l.length));
    const artStartX = centerX - Math.floor(artWidth / 2);

    for (let i = 0; i < artHeight; i++) {
      const wave = Math.sin(tick * 0.08 + i * 0.2) * (designName === 'avantgarde' ? 1 : 2);
      const colorIdx = (i + Math.floor(tick * 0.05)) % 3;
      const colors = [theme.primary, theme.secondary, theme.accent];
      const r = parseInt(colors[colorIdx].slice(1, 3), 16);
      const g = parseInt(colors[colorIdx].slice(3, 5), 16);
      const b = parseInt(colors[colorIdx].slice(5, 7), 16);
      output += `\x1b[${titleY + i};${artStartX + wave}f\x1b[38;2;${r};${g};${b}m${design.logo[i]}\x1b[0m`;
    }

    const version = `v${CLI_VERSION}`;
    output += `\x1b[${titleY - 2};${centerX - Math.floor(version.length / 2)}f${colorize(version, theme.muted)}`;

    const tagline = `${design.accent} AI-Powered Development Workspace ${design.accent}`;
    output += `\x1b[${titleY - 1};${centerX - Math.floor(tagline.length / 2)}f${colorize(tagline, theme.muted)}`;

    const menuStartY = centerY;
    const menuCol1X = centerX - 25;
    const menuCol2X = centerX + 5;

    const itemsPerCol = Math.ceil(designItems.length / 2);
    for (let i = 0; i < designItems.length; i++) {
      const item = designItems[i];
      const isSelected = i === selectedIndex;
      const col = i < itemsPerCol ? menuCol1X : menuCol2X;
      const row = menuStartY + (i % itemsPerCol) * 4;

      const prefix = isSelected ? '\x1b[7m' : '';
      const suffix = '\x1b[0m';
      const labelColor = isSelected ? theme.accent : theme.primary;
      const r = parseInt(labelColor.slice(1, 3), 16);
      const g = parseInt(labelColor.slice(3, 5), 16);
      const b = parseInt(labelColor.slice(5, 7), 16);

      const iconStr = design.useEmojis ? ` ${item.icon} ` : ` ${design.accent} `;
      const labelLine = `${prefix}\x1b[38;2;${r};${g};${b}m${iconStr}${item.label}${suffix}`;
      const descLine = `   \x1b[38;2;80;80;100m${item.description}${suffix}`;

      output += `\x1b[${row};${col}f${labelLine}\n`;
      output += `\x1b[${row + 1};${col}f${descLine}`;

      if (isSelected) {
        const barWidth = 25;
        const pct = (Math.sin(tick * 0.1) + 1) / 2;
        output += `\x1b[${row + 2};${col}f\x1b[38;2;${r};${g};${b}m${drawGradientBar(barWidth, pct, [theme.primary, theme.secondary, theme.accent])}\x1b[0m`;
      }
    }

    const designHint = designName === 'avantgarde' ? 'Emoji' : designName === 'classic' ? 'Holo' : 'Avant';
    const footerY = menuStartY + designItems.length * 2 + 3;
    const hints = ['↑↓ Navigate', 'Enter Select', 'Esc Exit', `\\ ${designHint}`, '/ Provider'];
    const hintWidth = Math.floor(width / hints.length);
    for (let i = 0; i < hints.length; i++) {
      output += `\x1b[${footerY};${i * hintWidth + 5}f\x1b[38;2;80;80;100m${hints[i]}\x1b[0m`;
    }

    const loading = tick % 4;
    const dots = loading === 0 ? '' : loading === 1 ? '.' : loading === 2 ? '..' : '...';
    output += `\x1b[${footerY + 1};${centerX - 5}f${colorize(`${design.accent} System Active${dots}`, theme.muted)}`;

    return output;
  }

  function handleInput(): void {
    setRawMode(true);
    process.stdin.once('data', (data: Buffer) => {
      const key = data.toString();
      const itemsPerCol = Math.ceil(designItems.length / 2);
      if (key === '\u001b[A' || key === 'k') {
        selectedIndex = Math.max(0, selectedIndex - 1);
      } else if (key === '\u001b[B' || key === 'j') {
        selectedIndex = Math.min(designItems.length - 1, selectedIndex + 1);
      } else if (key === '\r' || key === '\n') {
        running = false;
        process.stdout.write(cursorShow + clearScreen + cursorTo(0, 0));
        console.log('\n');
      } else if (key === '\u001b') {
        process.stdout.write(cursorShow + clearScreen + cursorTo(0, 0));
        running = false;
      } else if (key === '\\') {
        designName = designName === 'avantgarde' ? 'classic' : designName === 'classic' ? 'holochat' : 'avantgarde';
        selectedIndex = 0;
      } else if (key === '/') {
        const config = loadConfig();
        console.log(COLORS.info('\nAvailable providers:'));
        for (const p of AVAILABLE_PROVIDERS) {
          console.log(`  ${COLORS.primary(p.id)}: ${p.name}`);
        }
        console.log(COLORS.info('\nUse: bing providers:models <provider>'));
        console.log(COLORS.info('Use: bing model:select <provider> <model>'));
        running = false;
      } else if (key === '\t') {
        tick += 10;
      }
    });
  }

  let lastRender = '';
  while (running) {
    handleInput();
    const rendered = renderDesign();
    if (rendered !== lastRender) {
      process.stdout.write(rendered);
      lastRender = rendered;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  setRawMode(false);
  currentDesign = designName;
  const selected = designItems[selectedIndex];
  console.log(`\n${COLORS.success('Selected:')} ${selected.label}\n`);

  if (selected.id === 'chat') {
    await chatLoop({ agent: 'auto', stream: true });
  } else if (selected.id === 'ask') {
    const question = await promptAsync(COLORS.primary('Ask: '));
    if (question.trim()) {
      console.log(COLORS.info('\nThinking...'));
      try {
        const response = await apiRequest('/chat', {
          method: 'POST',
          data: { messages: [{ role: 'user', content: question }], stream: false }
        });
        console.log(`\n${COLORS.success('Answer:')}\n${response.response || response.content}\n`);
      } catch (error: any) {
        handleError(error, 'Failed to get answer');
      }
    }
  } else {
    console.log(`${COLORS.info(`Run: bing ${selected.action}`)}\n`);
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

const args = process.argv.slice(2);

// (localMode is hoisted to the top of the file)

if (args.length === 0) {
  if (localMode.isLocal || localMode.isDesktop) {
    runTUI('holochat').then(() => {
      process.exit(0);
    });
  } else {
    runTUI('holochat').then(() => {
      process.exit(0);
    });
  }
} else {
      try {
      registerRTKCommands(program);
    } catch (err) {
      console.warn('RTK commands not available:', err.message);
    }

program.parse();
}
