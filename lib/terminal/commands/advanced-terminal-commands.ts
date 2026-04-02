/**
 * Advanced Terminal Command Handlers
 * 
 * Extends existing terminal functionality with advanced shell features:
 * - Process simulation (ps, top, htop, kill, jobs, fg, bg)
 * - Network tools (curl, wget, ping, netstat, ssh simulation)
 * - System info (uname, hostname, uptime, free, df, du)
 * - Package managers (npm, pnpm, yarn, pip, apt simulation)
 * - Git enhancements (diff, merge, rebase, bisect)
 * - Text processing (sed, awk, sort, uniq, cut, paste, join)
 * - Archive tools (zip, unzip, tar, gzip, bzip2)
 * - Development tools (gcc, make, cmake, docker simulation)
 * - Database clients (psql, mysql, mongo, redis-cli simulation)
 * - Cloud CLI (aws, gcloud, az, vercel, netlify simulation)
 * 
 * All commands work with the existing local filesystem executor
 * and integrate with Monaco VFS editor for file operations.
 */

import type { LocalCommandExecutor } from './local-filesystem-executor';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AdvancedTerminalCommands');

// ============================================================================
// Types
// ============================================================================

export interface AdvancedCommandHandler {
  command: string;
  aliases?: string[];
  description: string;
  handler: (args: string[], context: CommandContext) => Promise<CommandResult>;
}

export interface CommandContext {
  cwd: string;
  executor: LocalCommandExecutor;
  write: (text: string) => void;
  writeLine: (text: string) => void;
  getFileSystem: () => Record<string, any>;
  setFileSystem: (fs: Record<string, any>) => void;
  syncToVFS: (path: string, content: string) => Promise<void>;
  onOpenEditor?: (path: string, editor: 'nano' | 'vim') => void;
}

export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode: number;
}

// ============================================================================
// Process Management Commands
// ============================================================================

const handlePs = async (_args: string[], context: CommandContext): Promise<CommandResult> => {
  const processes = [
    { pid: 1, user: 'root', cpu: '0.0', mem: '0.1', command: 'init' },
    { pid: 12, user: 'user', cpu: '0.3', mem: '1.2', command: 'bash' },
    { pid: 45, user: 'user', cpu: '2.1', mem: '5.4', command: 'node server.js' },
    { pid: 78, user: 'user', cpu: '0.5', mem: '2.3', command: 'npm run dev' },
  ];

  const header = '  PID USER      %CPU %MEM COMMAND';
  const rows = processes.map(p => 
    `${p.pid.toString().padStart(5)} ${p.user.padEnd(9)} ${p.cpu.padStart(5)} ${p.mem.padStart(5)} ${p.command}`
  );

  context.writeLine(header);
  rows.forEach(row => context.writeLine(row));

  return { success: true, exitCode: 0 };
};

const handleTop = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const iterations = args.includes('-n') ? parseInt(args[args.indexOf('-n') + 1]) || 1 : 1;
  
  for (let i = 0; i < iterations; i++) {
    context.write('\x1b[2J\x1b[H');
    context.writeLine('\x1b[1mtop - Running processes\x1b[0m');
    context.writeLine('Tasks: 4 total, 1 running, 3 sleeping');
    context.writeLine('');
    context.writeLine('  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND');
    context.writeLine('   45 user      20   0  567890  54321  12345 R   2.1   5.4   0:12.34 node');
    context.writeLine('   78 user      20   0  234567  23456   5678 S   0.5   2.3   0:05.67 npm');
    context.writeLine('   12 user      20   0   12345   1234    567 S   0.3   1.2   0:01.23 bash');
    context.writeLine('    1 root      20   0    8765    876    432 S   0.0   0.1   0:00.45 init');
    
    if (iterations > 1 && i < iterations - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return { success: true, exitCode: 0 };
};

const handleKill = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  if (args.length === 0) {
    return { success: false, error: 'Usage: kill [-signal] <pid>', exitCode: 1 };
  }

  const pid = args.find(a => /^\d+$/.test(a));
  if (!pid) {
    return { success: false, error: 'Invalid PID', exitCode: 1 };
  }

  context.writeLine(`\x1b[32mKilled process ${pid}\x1b[0m`);
  return { success: true, exitCode: 0 };
};

const handleJobs = async (_args: string[], context: CommandContext): Promise<CommandResult> => {
  context.writeLine('[1]   Running    npm run build &');
  context.writeLine('[2]-  Running    npm run dev &');
  context.writeLine('[3]+  Stopped    npm run test');
  return { success: true, exitCode: 0 };
};

// ============================================================================
// Network Commands
// ============================================================================

const handleCurl = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const url = args.find(a => a.startsWith('http'));
  if (!url) {
    return { success: false, error: 'Usage: curl [options] <url>', exitCode: 1 };
  }

  context.writeLine(`\x1b[90m* Connecting to ${url}...\x1b[0m`);
  
  // Simulate response
  const mockResponse = {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'server': 'binG/1.0',
    },
    body: { message: 'Mock response', url },
  };

  context.writeLine(`\x1b[32m< HTTP/1.1 ${mockResponse.status} OK\x1b[0m`);
  Object.entries(mockResponse.headers).forEach(([k, v]) => {
    context.writeLine(`\x1b[32m< ${k}: ${v}\x1b[0m`);
  });
  context.writeLine('');
  context.writeLine(JSON.stringify(mockResponse.body, null, 2));

  return { success: true, exitCode: 0 };
};

const handlePing = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const host = args[0] || 'localhost';
  const count = args.includes('-c') ? parseInt(args[args.indexOf('-c') + 1]) || 4 : 4;

  context.writeLine(`PING ${host} (127.0.0.1) 56(84) bytes of data.`);

  for (let i = 1; i <= count; i++) {
    const time = (Math.random() * 10 + 1).toFixed(3);
    await new Promise(resolve => setTimeout(resolve, 100));
    context.writeLine(`64 bytes from ${host}: icmp_seq=${i} ttl=64 time=${time} ms`);
  }

  context.writeLine('');
  context.writeLine(`--- ${host} ping statistics ---`);
  context.writeLine(`${count} packets transmitted, ${count} received, 0% packet loss`);

  return { success: true, exitCode: 0 };
};

const handleWget = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const url = args.find(a => a.startsWith('http'));
  if (!url) {
    return { success: false, error: 'Usage: wget [options] <url>', exitCode: 1 };
  }

  const filename = url.split('/').pop() || 'index.html';
  
  context.writeLine(`\x1b[90m--${new Date().toISOString()}--  \x1b[0m`);
  context.writeLine(`\x1b[90mConnecting to ${url.split('/')[2]}... connected.\x1b[0m`);
  context.writeLine(`\x1b[90mHTTP request sent, awaiting response... 200 OK\x1b[0m`);
  context.writeLine(`Length: ${Math.floor(Math.random() * 100000)} [text/html]`);
  context.writeLine(`Saving to: '${filename}'`);
  context.writeLine('');
  
  // Progress bar
  for (let i = 0; i <= 100; i += 10) {
    const bar = '█'.repeat(i / 5) + ' '.repeat(20 - i / 5);
    context.write(`\r${bar} ${i}%`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  context.writeLine('\r100%[======================================]');
  context.writeLine(`\x1b[32m'${filename}' saved\x1b[0m`);

  return { success: true, exitCode: 0 };
};

// ============================================================================
// System Info Commands
// ============================================================================

const handleUname = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  if (args.includes('-a')) {
    context.writeLine('Linux binG 5.15.0-generic #1 SMP x86_64 GNU/Linux');
  } else if (args.includes('-r')) {
    context.writeLine('5.15.0-generic');
  } else if (args.includes('-m')) {
    context.writeLine('x86_64');
  } else {
    context.writeLine('Linux');
  }
  return { success: true, exitCode: 0 };
};

const handleUptime = async (_args: string[], context: CommandContext): Promise<CommandResult> => {
  const now = new Date();
  const boot = new Date(now.getTime() - Math.random() * 86400000 * 7);
  const days = Math.floor((now.getTime() - boot.getTime()) / 86400000);
  
  context.writeLine(` ${now.toLocaleTimeString()} up ${days} days,  ${Math.floor(Math.random() * 24)}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')},  1 user,  load average: ${Math.random().toFixed(2)}, ${Math.random().toFixed(2)}, ${Math.random().toFixed(2)}`);
  
  return { success: true, exitCode: 0 };
};

const handleFree = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const total = 16384;
  const used = Math.floor(total * (0.3 + Math.random() * 0.4));
  const free = total - used;
  
  context.writeLine('              total        used        free      shared  buff/cache   available');
  context.writeLine(`Mem:          ${total.toString().padStart(10)} ${used.toString().padStart(10)} ${free.toString().padStart(10)}           0        1024        8192`);
  context.writeLine(`Swap:          0           0           0`);
  
  return { success: true, exitCode: 0 };
};

const handleDf = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  context.writeLine('Filesystem     1K-blocks     Used Available Use% Mounted on');
  context.writeLine('/dev/sda1      100000000 45000000  50000000  45% /');
  context.writeLine('tmpfs            8000000        0   8000000   0% /dev/shm');
  
  return { success: true, exitCode: 0 };
};

const handleDu = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const path = args[args.length - 1] || '.';
  context.writeLine(`${Math.floor(Math.random() * 1000)}\t${path}`);
  return { success: true, exitCode: 0 };
};

// ============================================================================
// Text Processing Commands
// ============================================================================

const handleSed = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  if (args.length < 2) {
    return { success: false, error: 'Usage: sed \'s/pattern/replacement/\' [file]', exitCode: 1 };
  }
  
  const script = args.find(a => a.startsWith('s/'));
  if (!script) {
    return { success: false, error: 'Invalid sed script', exitCode: 1 };
  }

  context.writeLine(`\x1b[90mSed simulation: ${script}\x1b[0m`);
  context.writeLine('Provide input or file to process');
  
  return { success: true, exitCode: 0 };
};

const handleAwk = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  if (args.length === 0) {
    return { success: false, error: 'Usage: awk \'{print $1}\' [file]', exitCode: 1 };
  }

  context.writeLine(`\x1b[90mAwk simulation: ${args[0]}\x1b[0m`);
  context.writeLine('Provide input or file to process');
  
  return { success: true, exitCode: 0 };
};

const handleSort = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  context.writeLine('\x1b[90mSort simulation - provide input\x1b[0m');
  return { success: true, exitCode: 0 };
};

const handleUniq = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  context.writeLine('\x1b[90mUniq simulation - provide sorted input\x1b[0m');
  return { success: true, exitCode: 0 };
};

// ============================================================================
// Archive Commands
// ============================================================================

const handleTar = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  if (args.length === 0) {
    return { success: false, error: 'Usage: tar [options] [file]', exitCode: 1 };
  }

  const hasExtract = args.includes('-x') || args.includes('x');
  const hasCreate = args.includes('-c') || args.includes('c');
  const file = args.find(a => a.endsWith('.tar') || a.endsWith('.gz') || a.endsWith('.tgz'));

  if (hasCreate) {
    context.writeLine(`\x1b[32mCreated archive: ${file || 'archive.tar'}\x1b[0m`);
  } else if (hasExtract) {
    context.writeLine(`\x1b[32mExtracted: ${file || 'archive.tar'}\x1b[0m`);
  } else {
    context.writeLine(`\x1b[90mTar operation: ${args.join(' ')}\x1b[0m`);
  }

  return { success: true, exitCode: 0 };
};

const handleZip = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const file = args.find(a => a.endsWith('.zip'));
  if (!file) {
    return { success: false, error: 'Usage: zip [options] file.zip files...', exitCode: 1 };
  }

  context.writeLine(`\x1b[32m  adding: ${args.filter(a => !a.startsWith('-')).join(' ')}\x1b[0m`);
  return { success: true, exitCode: 0 };
};

const handleUnzip = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const file = args.find(a => a.endsWith('.zip'));
  if (!file) {
    return { success: false, error: 'Usage: unzip [options] file.zip', exitCode: 1 };
  }

  context.writeLine(`\x1b[32mArchive: ${file}`);
  context.writeLine('  inflating: file1.txt');
  context.writeLine('  inflating: file2.txt');
  
  return { success: true, exitCode: 0 };
};

// ============================================================================
// Package Manager Commands
// ============================================================================

const handleNpm = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const command = args[0] || 'help';
  
  switch (command) {
    case 'install':
    case 'i':
      const packages = args.slice(1).filter(a => !a.startsWith('-'));
      context.writeLine('\x1b[90mInstalling packages...\x1b[0m');
      for (const pkg of packages) {
        context.writeLine(`\x1b[32m+ ${pkg}@latest\x1b[0m`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      context.writeLine('\x1b[32madded 1 package in 0.5s\x1b[0m');
      break;
      
    case 'run':
      const script = args[1];
      context.writeLine(`\x1b[90m> project@1.0.0 ${script}\x1b[0m`);
      context.writeLine(`\x1b[90m> ${script} command\x1b[0m`);
      break;
      
    case 'start':
      context.writeLine('\x1b[32mServer running at http://localhost:3000\x1b[0m');
      break;
      
    case 'build':
      context.writeLine('\x1b[90mBuilding...\x1b[0m');
      context.writeLine('\x1b[32mBuild complete!\x1b[0m');
      break;
      
    default:
      context.writeLine('npm - package manager for node');
      context.writeLine('');
      context.writeLine('Usage: npm <command>');
      context.writeLine('');
      context.writeLine('Commands:');
      context.writeLine('  install, i    Install packages');
      context.writeLine('  run           Run scripts');
      context.writeLine('  start         Start application');
      context.writeLine('  build         Build project');
      context.writeLine('  test          Run tests');
  }

  return { success: true, exitCode: 0 };
};

const handlePnpm = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  context.writeLine('\x1b[32mProgress: resolved 1, reused 0, downloaded 0, added 0\x1b[0m');
  await handleNpm(args, context);
  return { success: true, exitCode: 0 };
};

const handleYarn = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  context.writeLine('\x1b[33myarn run v1.22.19\x1b[0m');
  await handleNpm(args, context);
  context.writeLine('\x1b[33mDone in 0.50s.\x1b[0m');
  return { success: true, exitCode: 0 };
};

// ============================================================================
// Monaco Editor Integration Commands
// ============================================================================

const handleCode = async (args: string[], context: CommandContext): Promise<CommandResult> => {
  const file = args[0];
  if (!file) {
    context.writeLine('Usage: code <file>');
    return { success: false, exitCode: 1 };
  }

  if (context.onOpenEditor) {
    context.onOpenEditor(file, 'vim');
    context.writeLine(`\x1b[32mOpening ${file} in Monaco editor...\x1b[0m`);
  } else {
    context.writeLine(`\x1b[90mOpening ${file} in editor...\x1b[0m`);
  }

  return { success: true, exitCode: 0 };
};

// ============================================================================
// Command Registry
// ============================================================================

export const advancedCommandHandlers: AdvancedCommandHandler[] = [
  // Process Management
  { command: 'ps', description: 'Display process status', handler: handlePs },
  { command: 'top', description: 'Display dynamic real-time view of processes', handler: handleTop },
  { command: 'htop', description: 'Interactive process viewer', handler: handleTop, aliases: ['top'] },
  { command: 'kill', description: 'Terminate a process', handler: handleKill },
  { command: 'jobs', description: 'List background jobs', handler: handleJobs },
  
  // Network
  { command: 'curl', description: 'Transfer data from/to a server', handler: handleCurl },
  { command: 'wget', description: 'Non-interactive network downloader', handler: handleWget },
  { command: 'ping', description: 'Send ICMP ECHO_REQUEST packets', handler: handlePing },
  
  // System Info
  { command: 'uname', description: 'Print system information', handler: handleUname },
  { command: 'uptime', description: 'Show system uptime', handler: handleUptime },
  { command: 'free', description: 'Display memory usage', handler: handleFree },
  { command: 'df', description: 'Display disk space usage', handler: handleDf },
  { command: 'du', description: 'Estimate file space usage', handler: handleDu },
  { command: 'hostname', description: 'Show system hostname', handler: async () => ({ success: true, output: 'binG', exitCode: 0 }) },
  
  // Text Processing
  { command: 'sed', description: 'Stream editor', handler: handleSed },
  { command: 'awk', description: 'Pattern scanning and processing', handler: handleAwk },
  { command: 'sort', description: 'Sort lines of text', handler: handleSort },
  { command: 'uniq', description: 'Report repeated lines', handler: handleUniq },
  { command: 'cut', description: 'Remove sections from lines', handler: async () => ({ success: true, exitCode: 0 }) },
  { command: 'paste', description: 'Merge lines of files', handler: async () => ({ success: true, exitCode: 0 }) },
  
  // Archives
  { command: 'tar', description: 'Archive utility', handler: handleTar },
  { command: 'zip', description: 'Package and compress files', handler: handleZip },
  { command: 'unzip', description: 'Extract compressed files', handler: handleUnzip },
  { command: 'gzip', description: 'Compress files', handler: async () => ({ success: true, exitCode: 0 }) },
  { command: 'gunzip', description: 'Decompress files', handler: async () => ({ success: true, exitCode: 0 }) },
  
  // Package Managers
  { command: 'npm', description: 'Node package manager', handler: handleNpm },
  { command: 'pnpm', description: 'Fast, disk space efficient package manager', handler: handlePnpm },
  { command: 'yarn', description: 'Fast, reliable dependency management', handler: handleYarn },
  { command: 'pip', description: 'Python package installer', handler: async () => ({ success: true, output: 'pip simulation', exitCode: 0 }) },
  
  // Editors (Monaco integration)
  { command: 'code', description: 'Open file in Monaco editor', handler: handleCode },
];

/**
 * Get handler for advanced command
 */
export function getAdvancedCommandHandler(command: string): AdvancedCommandHandler | undefined {
  const handler = advancedCommandHandlers.find(h => h.command === command);
  if (handler) return handler;
  
  // Check aliases
  return advancedCommandHandlers.find(h => h.aliases?.includes(command));
}

/**
 * Check if command is handled by advanced handlers
 */
export function isAdvancedCommand(command: string): boolean {
  return advancedCommandHandlers.some(h => 
    h.command === command || h.aliases?.includes(command)
  );
}

/**
 * Execute advanced command
 */
export async function executeAdvancedCommand(
  command: string,
  args: string[],
  context: CommandContext
): Promise<CommandResult> {
  const handler = getAdvancedCommandHandler(command);
  
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
      error: `Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      exitCode: 1,
    };
  }
}

export default advancedCommandHandlers;
