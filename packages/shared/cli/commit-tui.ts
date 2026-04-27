/**
 * Interactive CLI TUI for Commit Rollback Selection
 *
 * Provides an interactive terminal UI for:
 * - Displaying commits from LOCAL history repo (~/.quaz/workspace-history/)
 * - Arrow key navigation for commit selection
 * - Enter to execute rollback to selected commit
 * - Per-file rollback support
 * - Escape to cancel
 *
 * IMPORTANT: This operates on the LOCAL HISTORY repo in ~/.quaz/,
 * NOT the user's project git repository. This ensures we never
 * accidentally destroy the user's own git history.
 */

import * as readline from 'readline';
import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { LocalVFSManager } from './lib/local-vfs-manager';

// Security: Validate and sanitize paths to prevent directory traversal
function sanitizePath(inputPath: string, allowedRoot?: string): string | null {
  if (!inputPath || typeof inputPath !== 'string') return null;

  // Resolve to absolute path and normalize (eliminates .. segments automatically)
  const resolved = path.resolve(inputPath);

  // Block access to sensitive system directories
  const blocked = ['/etc', '/proc', '/sys', '/dev', '/root', '/boot'];
  if (blocked.some(dir => resolved === dir || resolved.startsWith(dir + path.sep))) {
    return null;
  }

  // If an allowedRoot is provided, restrict to that subtree
  if (allowedRoot) {
    const root = path.resolve(allowedRoot);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      return null;
    }
  }

  return resolved;
}

// Simple console logger for CLI
const logger = {
  debug: (msg: string, ...args: any[]) => {},
  info: (msg: string, ...args: any[]) => console.info(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${msg}`, ...args),
};

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  isRollbackEligible: boolean;
  filesChanged?: string[];
}

/**
 * Get the local history repo path for the current workspace.
 * Falls back to CWD if no VFS manager is provided.
 */
function getHistoryRepoPath(workspacePath?: string): string {
  let targetPath: string;

  if (workspacePath) {
    const sanitized = sanitizePath(workspacePath, process.cwd());
    if (!sanitized) {
      throw new Error('Invalid workspace path provided');
    }
    targetPath = sanitized;
  } else {
    targetPath = process.cwd();
  }

  // Create consistent hash for workspace identification
  const hash = Buffer.from(targetPath).toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '') // Remove non-alphanumeric
    .slice(0, 12);

  const historyPath = path.join(os.homedir(), '.quaz', 'workspace-history', hash);

  // Ensure directory exists
  fs.ensureDirSync(path.dirname(historyPath));

  return historyPath;
}

/**
 * Render the interactive commit selector
 */
export async function renderCommitSelector(commits: CommitInfo[]): Promise<CommitInfo | null> {
  if (commits.length === 0) {
    console.log('No commits available for rollback');
    return null;
  }

  let selectedIndex = 0;
  let running = true;

  // Set up readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  // Configure terminal for raw mode to capture arrow keys
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Handle terminal resize
  let terminalWidth = process.stdout.columns || 80;
  let terminalHeight = process.stdout.rows || 24;

  const handleResize = () => {
    terminalWidth = process.stdout.columns || 80;
    terminalHeight = process.stdout.rows || 24;
    render(); // Re-render on resize
  };

  if (process.stdout.isTTY) {
    process.stdout.on('resize', handleResize);
  }

  const cleanup = () => {
    if (process.stdout.isTTY) {
      process.stdout.off('resize', handleResize);
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    rl.close();
    console.log('\n'); // Add newline after cleanup
  };

  const render = () => {
    // Clear screen and move cursor to top
    console.clear();
    process.stdout.write('\x1b[1;1H'); // Move to 1,1

    // Header
    console.log('🔄 Commit Rollback Selector');
    console.log('Use ↑/↓ arrows to navigate, Enter to select, Escape to cancel\n');

    // Calculate visible range based on terminal height
    const headerHeight = 3;
    const availableHeight = Math.max(5, terminalHeight - headerHeight - 2); // Reserve space for footer
    const startIndex = Math.max(0, selectedIndex - Math.floor(availableHeight / 2));
    const endIndex = Math.min(commits.length, startIndex + availableHeight);

    // Render visible commit list
    const visibleCommits = commits.slice(startIndex, endIndex);
    visibleCommits.forEach((commit, displayIndex) => {
      const actualIndex = startIndex + displayIndex;
      const isSelected = actualIndex === selectedIndex;
      const prefix = isSelected ? '▶ ' : '  ';
      const flag = commit.isRollbackEligible ? '[R]' : '[ ]';
      const marker = isSelected ? '← SELECTED' : '';

      // Truncate message if too long for terminal
      const maxMessageLength = Math.max(20, terminalWidth - 25); // Reserve space for prefix/flag/hash
      const truncatedMessage = commit.message.length > maxMessageLength
        ? commit.message.substring(0, maxMessageLength - 3) + '...'
        : commit.message;

      console.log(`${prefix}${flag} ${commit.hash.substring(0, 8)} - ${truncatedMessage} ${marker}`);
    });

    // Show scroll indicators
    if (startIndex > 0) {
      console.log('  ... (↑ more commits)');
    }
    if (endIndex < commits.length) {
      console.log('  ... (↓ more commits)');
    }

    console.log('\n[R] = Rollback eligible commit');
  };

  return new Promise((resolve) => {
  const handleKey = (chunk: Buffer) => {
    const key = chunk.toString();

    try {
      switch (key) {
        case '\u001b[A': // Up arrow
          selectedIndex = Math.max(0, selectedIndex - 1);
          render();
          break;

        case '\u001b[B': // Down arrow
          selectedIndex = Math.min(commits.length - 1, selectedIndex + 1);
          render();
          break;

        case '\u001b[5~': // Page Up
          selectedIndex = Math.max(0, selectedIndex - 5);
          render();
          break;

        case '\u001b[6~': // Page Down
          selectedIndex = Math.min(commits.length - 1, selectedIndex + 5);
          render();
          break;

        case '\u001b[H': // Home
          selectedIndex = 0;
          render();
          break;

        case '\u001b[F': // End
          selectedIndex = commits.length - 1;
          render();
          break;

        case '\r': // Enter
        case '\n': // Enter (alternative)
          running = false;
          cleanup();
          resolve(commits[selectedIndex]);
          break;

        case '\u001b': // Escape — 50ms timeout to distinguish from arrow key sequences
          // Arrow keys send \u001b[A/B/C/D, so we wait 50ms for follow-up bytes
          let escTimer: NodeJS.Timeout;
          const escCallback = (nextChunk: Buffer) => {
            // Follow-up byte arrived within 50ms — it's an escape sequence (arrow key), not a real ESC
            clearTimeout(escTimer);
            process.stdin.removeListener('data', escCallback);
          };
          
          escTimer = setTimeout(() => {
            // No follow-up byte within 50ms → real ESC key press
            process.stdin.removeListener('data', escCallback);
            running = false;
            cleanup();
            resolve(null);
          }, 50);
          
          process.stdin.on('data', escCallback);
          break;

        case 'q':
        case 'Q':
          // Allow 'q' to quit as well
          running = false;
          cleanup();
          resolve(null);
          break;

        default:
          // Ignore other keys
          break;
      }
    } catch (error) {
      logger.error('Error handling key input:', error);
      running = false;
      cleanup();
      resolve(null);
    }
  };

    // Set up key handler
    process.stdin.on('data', handleKey);

    // Initial render
    render();

    // Handle process termination
    process.on('SIGINT', () => {
      running = false;
      cleanup();
      resolve(null);
    });
  });
}

/**
 * Get commit history from LOCAL history repo (~/.quaz/),
 * NOT from the user's project git repository.
 */
export async function getCommitHistory(
  workspacePath?: string,
  limit = 20
): Promise<CommitInfo[]> {
  const historyRepoPath = getHistoryRepoPath(workspacePath);

  if (!fs.existsSync(path.join(historyRepoPath, '.git'))) {
    logger.warn('No local history repo found at', historyRepoPath);
    return [];
  }

  const git: SimpleGit = simpleGit(historyRepoPath);

  return new Promise((resolve, reject) => {
    git.log(['-n', String(limit)], (err, log) => {
      if (err) {
        logger.error('Git log failed:', err.message);
        resolve([]);
        return;
      }

      try {
        const commits: CommitInfo[] = log.all.map(entry => ({
          hash: entry.hash,
          message: entry.message,
          author: entry.author_name || 'binG CLI',
          date: entry.date,
          isRollbackEligible: true,
        }));

        resolve(commits);
      } catch (error: any) {
        logger.error('Failed to parse git output:', error);
        resolve([]);
      }
    });
  });
}

/**
 * Get files changed in a specific commit from the local history repo.
 */
export async function getCommitFiles(
  commitHash: string,
  workspacePath?: string
): Promise<string[]> {
  const historyRepoPath = getHistoryRepoPath(workspacePath);
  if (!fs.existsSync(path.join(historyRepoPath, '.git'))) return [];

  const git: SimpleGit = simpleGit(historyRepoPath);

  try {
    const result = await git.diff(['--name-only', `${commitHash}^`, commitHash]);
    return result.trim().split('\n').filter(Boolean);
  } catch {
    // First commit — try diff against empty tree
    try {
      const result = await git.diff(['--name-only', '--cached', commitHash]);
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}

/**
 * Execute rollback to specified commit by restoring files
 * to the user's ACTUAL workspace (not the history repo).
 *
 * IMPORTANT: This does NOT use `git reset --hard` on the user's project.
 * Instead, it reads the file contents from the local history repo and
 * copies them to the workspace. This is safe and non-destructive.
 */
export async function executeRollback(
  commit: CommitInfo,
  workspacePath?: string,
  targetFiles?: string[]
): Promise<void> {
  const historyRepoPath = getHistoryRepoPath(workspacePath);
  const git: SimpleGit = simpleGit(historyRepoPath);
  const actualWorkspace = workspacePath || process.cwd();

  console.log(`🔄 Rolling back to commit: ${commit.hash.substring(0, 8)} - ${commit.message}`);

  // Get the list of files to restore
  const files = targetFiles || await getCommitFiles(commit.hash, workspacePath);

  if (files.length === 0) {
    console.log('⚠️  No files found for this commit');
    return;
  }

  let restoredCount = 0;
  for (const filePath of files) {
    try {
      // Read the file content at the target commit from the history repo
      const content = await git.show([`${commit.hash}:${filePath}`]);

      // Write to the user's actual workspace
      const targetPath = path.join(actualWorkspace, filePath);
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, content);
      restoredCount++;
      console.log(`  ✓ Restored: ${filePath}`);
    } catch (err: any) {
      console.log(`  ⚠ Skipped: ${filePath} (${err.message})`);
    }
  }

  console.log(`✅ Restored ${restoredCount}/${files.length} files to workspace`);
}

/**
 * Rollback a single file to a specific commit version.
 */
export async function rollbackSingleFile(
  filePath: string,
  commitHash: string,
  workspacePath?: string
): Promise<boolean> {
  const historyRepoPath = getHistoryRepoPath(workspacePath);
  const git: SimpleGit = simpleGit(historyRepoPath);
  const actualWorkspace = workspacePath || process.cwd();

  try {
    const content = await git.show([`${commitHash}:${filePath}`]);
    const targetPath = path.join(actualWorkspace, filePath);
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);
    console.log(`✅ Reverted ${filePath} to ${commitHash.slice(0, 8)}`);
    return true;
  } catch (err: any) {
    console.error(`❌ Failed to revert ${filePath}: ${err.message}`);
    return false;
  }
}

/**
 * Main CLI command handler for rollback
 */
export async function handleRollbackCommand(args: string[] = []): Promise<void> {
  try {
    console.log('🔍 Fetching commit history from local VFS...\n');

    // Get commit history from LOCAL history repo
    const commits = await getCommitHistory(process.cwd(), 20);

    if (commits.length === 0) {
      console.log('❌ No commits found in local history');
      console.log('💡 Start a chat session first to create file edit history');
      return;
    }

    // Launch interactive selector
    const selectedCommit = await renderCommitSelector(commits);

    if (!selectedCommit) {
      console.log('❌ Rollback cancelled');
      return;
    }

    // Ask if full or partial rollback
    const files = await getCommitFiles(selectedCommit.hash, process.cwd());

    if (files.length > 1) {
      console.log(`\n📁 Files in this commit: ${files.join(', ')}`);
      // For now, do a full rollback of all files in the commit
      // TODO: Add per-file selection UI
    }

    // Execute rollback — safe, non-destructive file copy
    await executeRollback(selectedCommit, process.cwd(), files.length > 0 ? files : undefined);

  } catch (error: any) {
    console.error('❌ Rollback command failed:', error.message);
    process.exit(1);
  }
}

/**
 * Export for use in CLI
 */
export default {
  command: 'rollback',
  description: 'Interactive commit rollback selector (local VFS history)',
  handler: handleRollbackCommand,
  usage: 'rollback [options]'
};
