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
import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';

// Load environment variables
dotenv.config();

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
// Local Execution Detection
// ============================================================================

function detectLocalMode(): { isLocal: boolean; isDesktop: boolean; workspace: string } {
  const isLocal = !process.env.VERCEL && !process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production';
  const isDesktop = !!process.env.DESKTOP_MODE || !!process.env.DESKTOP_LOCAL_EXECUTION;
  const workspace = process.env.DESKTOP_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT ||
    path.join(process.env.HOME || process.env.USERPROFILE || cwd(), 'workspace');
  return { isLocal, isDesktop, workspace };
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
};

/**
 * Load saved configuration
 */
function loadConfig(): any {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (error) {
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

  const impact: CommandImpact = {
    command: sanitized,
    estimatedImpact: 'low',
    filesAffected: [],
    sideEffects: [],
    warnings: [],
    confirmationRequired: false,
  };

  // Check for destructive commands
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      impact.estimatedImpact = 'high';
      impact.confirmationRequired = true;
      impact.warnings.push('This action is destructive and cannot be undone');
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
  } catch (error) {
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

/**
 * Interactive chat loop
 */
async function chatLoop(options: { agent?: string; stream?: boolean }): Promise<void> {
  const config = loadConfig();

  console.log(chalk.cyanBright(`
╔═══════════════════════════════════════════════════════════╗
║                    binG Chat Interface                     ║
║                                                           ║
║  Mode: ${options.agent || 'auto'}                                    ║
║  Provider: ${config.provider}                                      ║
║  Model: ${config.model}                                          ║
║                                                           ║
║  Type 'exit' or 'quit' to end the conversation            ║
║  Type 'clear' to clear conversation history               ║
║  Type 'help' for available commands                       ║
╚═══════════════════════════════════════════════════════════╝
  `));
  
  const messages: any[] = [];
  
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
      messages.length = 0;
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
      const response = await apiRequest('/chat', {
        method: 'POST',
        data: {
          messages,
          provider: config.provider,
          model: config.model,
          stream: options.stream !== false,
          agentMode: options.agent === 'auto' ? 'auto' : options.agent,
        },
      });
      
      spinner.stop();

      const content = response.response || response.content;

      // Handle streaming response with markdown rendering
      if (options.stream !== false) {
        process.stdout.write(COLORS.success('\nAssistant:\n'));
        if (content) {
          const rendered = renderMarkdown(content);
          console.log(rendered);
        }
      } else {
        console.log(COLORS.success('\nAssistant:'), content || response.content);
      }

      // Add assistant response to history
      messages.push({ 
        role: 'assistant', 
        content: response.response || response.content 
      });
      
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
  .description('Read a file from the workspace')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .action(async (path, options) => {
    if (!validateRequired(path, 'File path')) return;

    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;

    const spinner = ora(`Reading ${path}...`).start();

    try {
      const result = await apiRequest('/filesystem/read', {
        method: 'POST',
        data: { path, sandboxId },
      });

      spinner.stop();

      if (result.success) {
        console.log(COLORS.primary(`\nFile: ${result.data.path}`));
        console.log(COLORS.info(`Size: ${formatBytes(result.data.size)}`));
        console.log(COLORS.info(`Modified: ${new Date(result.data.lastModified).toLocaleString()}`));
        console.log('\n--- Content ---\n');
        // Limit output for large files
        const content = result.data.content;
        const maxDisplay = 50000;
        if (content.length > maxDisplay) {
          console.log(content.slice(0, maxDisplay));
          console.log(COLORS.warning(`\n... (${content.length - maxDisplay} more bytes)`));
        } else {
          console.log(content);
        }
        console.log('\n---------------\n');
      } else {
        handleError(new Error(result.error), 'Failed to read file');
        process.exit(1);
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Failed to read file');
      process.exit(1);
    }
  });

program
  .command('file:write <path> [content]')
  .description('Write content to a file')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .option('-f, --force', 'Overwrite existing file without confirmation')
  .option('-e, --encoding <encoding>', 'Content encoding', 'utf-8')
  .action(async (path, content, options) => {
    if (!validateRequired(path, 'File path')) return;

    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;

    // If no content provided, read from stdin or prompt
    if (!content) {
      content = await prompt(COLORS.primary('Enter file content (end with empty line): '));
      let line;
      while ((line = await prompt('')) !== '') {
        content += '\n' + line;
      }
    }

    const spinner = ora(`Writing ${path}...`).start();

    try {
      const result = await apiRequest('/filesystem/write', {
        method: 'POST',
        data: { path, content, sandboxId, encoding: options.encoding },
      });

      spinner.stop();

      if (result.success) {
        console.log(COLORS.success(`\nFile written: ${path}`));
        console.log(COLORS.info(`Size: ${formatBytes(result.data.size)}`));
        console.log(COLORS.info(`Time: ${formatDuration(result.data.writeTime || 0)}`));
      } else {
        handleError(new Error(result.error), 'Write failed');
        process.exit(1);
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Write failed');
      process.exit(1);
    }
  });

program
  .command('file:list [path]')
  .description('List directory contents')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .action(async (path, options) => {
    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;
    
    const spinner = ora(`Listing ${path || '/workspace'}...`).start();
    
    try {
      const result = await apiRequest('/filesystem/list', {
        method: 'POST',
        data: {
          path: path || '/workspace',
          sandboxId,
        },
      });
      
      spinner.stop();
      
      if (result.success) {
        console.log(COLORS.primary(`\nDirectory: ${result.data.path}`));
        console.log('\nFiles:');
        result.data.files.forEach((file: any) => {
          const icon = file.type === 'directory' ? '📁' : '📄';
          console.log(`  ${icon} ${file.name} (${file.size} bytes)`);
        });
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
  .command('agents:stop <agentId>')
  .description('Stop an agent')
  .action(async (agentId) => {
    if (!validateRequired(agentId, 'Agent ID')) return;

    const spinner = ora(`Stopping agent ${agentId}...`).start();
    try {
      await apiRequest(`/kernel/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
      spinner.stop();
      console.log(COLORS.success('\nAgent stopped'));
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Stop agent failed');
    }
  });

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

program
  .command('login')
  .description('Log in to binG')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .action(async (options) => {
    let email = options.email;
    let password = options.password;

    if (!email) {
      email = await prompt(COLORS.primary('Email: '));
    }
    if (!validateRequired(email, 'Email')) return;

    if (!password) {
      password = await prompt(COLORS.primary('Password: '));
    }
    if (!validateRequired(password, 'Password')) return;

    const spinner = ora('Logging in...').start();

    try {
      const response = await apiRequest('/auth/login', {
        method: 'POST',
        data: { email, password },
      });

      spinner.stop();

      if (response.token) {
        saveAuth({
          token: response.token,
          userId: response.userId,
          email,
          expiresAt: response.expiresAt,
        });

        console.log(COLORS.success('\nLogged in!'));
        console.log(COLORS.info(`Session expires: ${response.expiresAt ? new Date(response.expiresAt).toLocaleString() : 'N/A'}`));
      } else {
        console.log(COLORS.error(`\nLogin failed: ${response.error || 'Invalid credentials'}`));
        process.exit(1);
      }
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
  .command('login')
  .description('Authenticate with binG')
  .option('--email <email>', 'Email address')
  .option('--password <password>', 'Password')
  .action(async (options) => {
    console.log(chalk.cyanBright('\n=== binG Authentication ===\n'));
    
    let email = options.email;
    let password = options.password;
    
    if (!email) {
      email = await prompt(COLORS.primary('Email: '));
    }
    
    if (!password) {
      password = await prompt(COLORS.primary('Password: '));
    }
    
    const spinner = ora('Authenticating...').start();
    
    try {
      const result = await apiRequest('/auth/login', {
        method: 'POST',
        data: { email, password },
      });
      
      spinner.stop();
      
      if (result.token) {
        saveAuth({
          token: result.token,
          userId: result.userId,
          email: result.email,
        });
        
        console.log(COLORS.success('\n✓ Authentication successful!'));
        console.log(`  User: ${COLORS.info(result.email)}`);
        console.log(`  ID: ${COLORS.info(result.userId)}`);
      } else {
        console.log(COLORS.error('Authentication failed: No token received'));
        process.exit(1);
      }
      
    } catch (error: any) {
      spinner.stop();
      console.log(COLORS.error(`\nAuthentication failed: ${error.message}`));
      process.exit(1);
    }
  });

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
  .command('agents:list')
  .description('List available agent binaries')
  .action(() => {
    console.log(chalk.cyanBright('\n=== Available Agent Binaries ===\n'));
    for (const agent of AGENT_BINARIES) {
      const status = agent.supportsModels ? COLORS.success('✓ Models') : COLORS.warning('○');
      console.log(`${COLORS.primary(`${agent.id}:`)} ${agent.desc} ${status}`);
    }
  });

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
          const { findOpencodeBinary } = await import('../../web/lib/agent-bins/find-opencode-binary');
          binaryPath = await findOpencodeBinary();
        }
      } else if (normalized === 'pi') {
        const { findPiBinary } = await import('../../web/lib/agent-bins/find-pi-binary');
        binaryPath = await findPiBinary();
      } else if (normalized === 'codex') {
        const { findCodexBinary } = await import('../../web/lib/agent-bins/find-codex-binary');
        binaryPath = await findCodexBinary();
      } else if (normalized === 'amp') {
        const { findAmpBinary } = await import('../../web/lib/agent-bins/find-amp-binary');
        binaryPath = await findAmpBinary();
      } else if (normalized === 'claude-code') {
        const { findClaudeCodeBinary } = await import('../../web/lib/agent-bins/find-claude-code-binary');
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
        const { findOpencodeBinary } = await import('../../web/lib/agent-bins/find-opencode-binary');
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
        const { findCodexBinary } = await import('../../web/lib/agent-bins/find-codex-binary');
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
// STORAGE COMMANDS
// ============================================================================

program
  .command('storage:list')
  .description('List stored files')
  .option('-b, --bucket <bucket>', 'Bucket name')
  .action(async (options) => {
    const spinner = ora('Loading storage...').start();
    try {
      const result = await apiRequest(`/storage/files${options.bucket ? '?bucket=' + options.bucket : ''}`);
      spinner.stop();
      console.log(chalk.cyanBright('\n=== Storage Files ===\n'));
      for (const file of result.files || result) {
        console.log(COLORS.primary(`${file.key}:`) + ` ${formatBytes(file.size)}`);
        console.log(`  ${COLORS.info('Modified:')} ${file.modifiedAt}\n`);
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

program
  .command('storage:upload <path>')
  .description('Upload file to storage')
  .option('-b, --bucket <bucket>', 'Bucket name')
  .option('-k, --key <key>', 'Storage key')
  .action(async (path, options) => {
    if (!validateRequired(path, 'File path', 'Path to local file')) return;
    if (!validatePath(path, true)) return;

    const spinner = ora('Uploading file...').start();
    try {
      const content = fs.readFileSync(path);
      const result = await apiRequest('/storage/upload', {
        method: 'POST',
        data: {
          key: options.key || path,
          bucket: options.bucket,
          content: content.toString('base64'),
        },
      });
      spinner.stop();
      console.log(COLORS.success('\nFile uploaded!'));
      console.log(COLORS.info(`Key: ${result.key}`));
    } catch (error: any) {
      spinner.stop();
      handleError(error, 'Upload failed');
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

import { clearScreen, cursorHide, cursorShow, moveCursor } from 'ansi-escapes';

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
  particles: string[];
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
  { id: 'ask', label: 'Ask', icon: '❓', action: 'ask', description: 'Ask a quick question' },
  { id: 'sandbox', label: 'Sandbox', icon: '📦', action: 'sandbox:create', description: 'Create a development environment' },
  { id: 'file', label: 'Files', icon: '📁', action: 'file:list', description: 'Browse workspace files' },
  { id: 'image', label: 'Images', icon: '🖼️', action: 'image:generate', description: 'Generate AI images' },
  { id: 'agents', label: 'Agents', icon: '🤖', action: 'agents:list', description: 'Manage running agents' },
  { id: 'status', label: 'Status', icon: '📊', action: 'status', description: 'View system status' },
  { id: 'config', label: 'Config', icon: '⚙️', action: 'config', description: 'Configure settings' },
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

  async function promptAsync(question: string): Promise<string> {
    return new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer));
    });
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
        process.stdout.write(cursorShow + clearScreen + moveCursor(0, 0));
        console.log('\n');
      } else if (key === '\u001b') {
        process.stdout.write(cursorShow + clearScreen + moveCursor(0, 0));
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

const localMode = detectLocalMode();

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
  program.parse();
}
