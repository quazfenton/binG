/**
 * Interactive CLI TUI for Commit Rollback Selection
 *
 * Provides an interactive terminal UI for:
 * - Displaying git commits with R (rollback eligible) flags
 * - Arrow key navigation for commit selection
 * - Enter to execute rollback to selected commit
 * - Escape to cancel
 *
 * Works with both desktop and web modes via filesystem abstraction.
 */

import * as readline from 'readline';
import { createLogger } from '../utils/logger';
import { createAgentFilesystem } from '../agent-bins/agent-filesystem';

const logger = createLogger('CommitTUI');

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  isRollbackEligible: boolean;
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

  const cleanup = () => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    rl.close();
    console.log('\n'); // Add newline after cleanup
  };

  const render = () => {
    console.clear();

    // Header
    console.log('🔄 Commit Rollback Selector');
    console.log('Use ↑/↓ arrows to navigate, Enter to select, Escape to cancel\n');

    // Render commit list
    commits.forEach((commit, index) => {
      const isSelected = index === selectedIndex;
      const prefix = isSelected ? '▶ ' : '  ';
      const flag = commit.isRollbackEligible ? '[R]' : '[ ]';
      const marker = isSelected ? '← SELECTED' : '';

      console.log(`${prefix}${flag} ${commit.hash.substring(0, 8)} - ${commit.message} ${marker}`);
    });

    console.log('\n[R] = Rollback eligible commit');
  };

  return new Promise((resolve) => {
    const handleKey = (chunk: Buffer) => {
      const key = chunk.toString();

      switch (key) {
        case '\u001b[A': // Up arrow
          selectedIndex = Math.max(0, selectedIndex - 1);
          render();
          break;

        case '\u001b[B': // Down arrow
          selectedIndex = Math.min(commits.length - 1, selectedIndex + 1);
          render();
          break;

        case '\r': // Enter
        case '\n': // Enter (alternative)
          running = false;
          cleanup();
          resolve(commits[selectedIndex]);
          break;

        case '\u001b': // Escape (first byte)
          // Wait for next byte to confirm it's escape
          process.stdin.once('data', (nextChunk: Buffer) => {
            if (nextChunk.toString() === '\u001b') {
              // Double escape = actual escape key
              running = false;
              cleanup();
              resolve(null);
            }
          });
          break;

        default:
          // Ignore other keys
          break;
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
 * Get commit history from git
 */
export async function getCommitHistory(limit = 20): Promise<CommitInfo[]> {
  try {
    const fs = createAgentFilesystem.get().get();
    if (!fs) {
      throw new Error('Filesystem not initialized');
    }

    // Get commits from git-backed VFS
    const commits = await fs.getCommitHistory?.() || [];

    // Transform to CommitInfo format
    return commits.slice(0, limit).map(commit => ({
      hash: commit.hash || commit.id || '',
      message: commit.message || commit.summary || '',
      author: commit.author || 'Unknown',
      date: commit.date || new Date().toISOString(),
      isRollbackEligible: true // All commits are eligible for rollback in this implementation
    }));

  } catch (error) {
    logger.error('Failed to get commit history:', error);
    throw new Error('Could not retrieve git commit history');
  }
}

/**
 * Execute rollback to specified commit
 */
export async function executeRollback(commit: CommitInfo): Promise<void> {
  try {
    console.log(`🔄 Rolling back to commit: ${commit.hash.substring(0, 8)} - ${commit.message}`);

    const fs = createAgentFilesystem.get().get();
    if (!fs) {
      throw new Error('Filesystem not initialized');
    }

    // Use the filesystem's rollback method
    await fs.restoreCommit?.(commit.hash);

    console.log(`✅ Successfully rolled back to ${commit.hash.substring(0, 8)}`);
    console.log('📝 Changes have been applied to your local files');

  } catch (error) {
    logger.error('Rollback execution failed:', error);
    throw new Error(`Failed to rollback to commit: ${error.message}`);
  }
}

/**
 * Main CLI command handler for rollback
 */
export async function handleRollbackCommand(args: string[] = []): Promise<void> {
  try {
    console.log('🔍 Fetching commit history...\n');

    // Get commit history
    const commits = await getCommitHistory(20);

    if (commits.length === 0) {
      console.log('❌ No commits found in this repository');
      return;
    }

    // Launch interactive selector
    const selectedCommit = await renderCommitSelector(commits);

    if (!selectedCommit) {
      console.log('❌ Rollback cancelled');
      return;
    }

    // Execute rollback
    await executeRollback(selectedCommit);

  } catch (error) {
    console.error('❌ Rollback command failed:', error.message);
    process.exit(1);
  }
}

/**
 * Export for use in CLI
 */
export default {
  command: 'rollback',
  description: 'Interactive commit rollback selector',
  handler: handleRollbackCommand,
  usage: 'rollback [options]'
};