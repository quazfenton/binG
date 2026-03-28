#!/usr/bin/env node

/**
 * binG CLI - Agentic Workspace Command Line Interface
 * 
 * A powerful CLI tool that integrates all binG features:
 * - Chat with AI agents (V1 API, V2 OpenCode, StatefulAgent)
 * - Sandbox management (Daytona, E2B, Modal.com, Sprites, etc.)
 * - Filesystem operations (read, write, sync, snapshots)
 * - Voice features (TTS, speech-to-text)
 * - Image generation (Mistral, Replicate)
 * - Tool execution (Composio, Nango, Arcade, Smithery, MCP)
 * - Workflow orchestration (Mastra, LangGraph)
 * - OAuth integrations (GitHub, Google, Notion, etc.)
 * 
 * @see https://github.com/quazfenton/binG
 */

import { Command } from 'commander';
import { createInterface } from 'readline';
import { stdin as input, stdout as output } from 'process';
import chalk from 'chalk';
import ora from 'ora';
import gradient from 'gradient-string';
import fs from 'fs-extra';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config();

// CLI Configuration
const CLI_VERSION = '1.0.0';
const DEFAULT_API_BASE = process.env.BING_API_URL || 'http://localhost:3000/api';
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.bing-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');

// Ensure config directory exists
fs.ensureDirSync(CONFIG_DIR);

// ANSI color codes
const COLORS = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  gradient: gradient(['#00c6ff', '#0072ff']),
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
    provider: process.env.DEFAULT_LLM_PROVIDER || 'mistral',
    model: process.env.DEFAULT_MODEL || 'mistral-large-latest',
    sandboxProvider: process.env.SANDBOX_PROVIDER || 'daytona',
  };
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
  fs.chmodSync(AUTH_FILE, 0o600); // Secure file permissions
}

/**
 * Make authenticated API request
 */
async function apiRequest(endpoint: string, options: any = {}): Promise<any> {
  const config = loadConfig();
  const auth = loadAuth();
  
  const url = `${config.apiBase}${endpoint}`;
  const headers: any = {
    'Content-Type': 'application/json',
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
      timeout: options.timeout || 120000, // 2 minute default timeout
    });
    
    return response.data;
  } catch (error: any) {
    if (error.response) {
      throw new Error(
        `API Error (${error.response.status}): ${error.response.data?.error || error.message}`
      );
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
  
  console.log(COLORS.gradient(`
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
  `);
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
      
      // Handle streaming response
      if (options.stream !== false && response.stream) {
        process.stdout.write(COLORS.success('\nAssistant: '));
        // Streaming would be handled here for SSE
        console.log(response.response || response.content);
      } else {
        console.log(COLORS.success('\nAssistant:'), response.response || response.content);
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
    const config = loadConfig();
    const sandboxId = options.sandbox || config.currentSandbox;
    
    const spinner = ora(`Reading ${path}...`).start();
    
    try {
      const result = await apiRequest('/filesystem/read', {
        method: 'POST',
        data: {
          path,
          sandboxId,
        },
      });
      
      spinner.stop();
      
      if (result.success) {
        console.log(COLORS.primary(`\nFile: ${result.data.path}`));
        console.log(COLORS.info(`Size: ${result.data.size} bytes`));
        console.log(COLORS.info(`Last modified: ${new Date(result.data.lastModified).toLocaleString()}`));
        console.log('\n--- Content ---\n');
        console.log(result.data.content);
        console.log('\n---------------\n');
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
  .command('file:write <path> [content]')
  .description('Write content to a file')
  .option('-s, --sandbox <id>', 'Sandbox ID')
  .option('-f, --force', 'Overwrite existing file without confirmation')
  .action(async (path, content, options) => {
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
        data: {
          path,
          content,
          sandboxId,
        },
      });
      
      spinner.stop();
      
      if (result.success) {
        console.log(COLORS.success(`\nFile written successfully: ${path}`));
        console.log(COLORS.info(`Size: ${result.data.size} bytes`));
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
  .command('tools:list')
  .description('List available tools')
  .action(async () => {
    const spinner = ora('Fetching tools...').start();
    
    try {
      const result = await apiRequest('/tools', {
        method: 'GET',
      });
      
      spinner.stop();
      
      if (result.tools && result.tools.length > 0) {
        console.log(COLORS.primary(`\nAvailable Tools (${result.tools.length}):`));
        console.table(
          result.tools.map((tool: any) => ({
            Name: tool.name,
            Provider: tool.provider,
            Description: tool.description?.substring(0, 50) + '...',
          }))
        );
      } else {
        console.log(COLORS.info('\nNo tools available'));
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
        provider: 'mistral',
        model: 'mistral-large-latest',
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
    console.log(COLORS.gradient('\n=== binG Authentication ===\n'));
    
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
    console.log(COLORS.gradient('\n=== binG System Status ===\n'));
    
    try {
      const [health, providers] = await Promise.all([
        apiRequest('/health', { method: 'GET' }).catch(() => null),
        apiRequest('/providers', { method: 'GET' }).catch(() => null),
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
      console.log(`  Provider: ${COLORS.info(config.provider)}`);
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
        console.log('\n' + COLORS.primary('Available Providers:'));
        providers.llm?.forEach((p: any) => {
          console.log(`  ${COLORS.success('✓')} ${p}`);
        });
        providers.sandbox?.forEach((p: any) => {
          console.log(`  ${COLORS.success('✓')} ${p}`);
        });
      }
      
    } catch (error: any) {
      console.log(COLORS.error(`Error: ${error.message}`));
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
    console.log(COLORS.gradient(`
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

program.addHelpText('after', `
${COLORS.primary('Examples:')}
  ${COLORS.info('bing chat')}                    Start interactive chat
  ${COLORS.info('bing ask "Explain quantum computing"')}  Quick question
  ${COLORS.info('bing sandbox:create --gpu H100')}        Create GPU sandbox
  ${COLORS.info('bing sandbox:exec python train.py')}     Execute command
  ${COLORS.info('bing file:read /workspace/app.py')}      Read file
  ${COLORS.info('bing image:generate "A cute cat"')}      Generate image
  ${COLORS.info('bing tools:list')}                List available tools
  ${COLORS.info('bing config --provider openai')}   Set default provider
  ${COLORS.info('bing status')}                    Check system status

${COLORS.primary('Documentation:')} https://github.com/quazfenton/binG/tree/main/docs
${COLORS.primary('Support:')} https://github.com/quazfenton/binG/issues
`);

// Parse and run
program.parse();
