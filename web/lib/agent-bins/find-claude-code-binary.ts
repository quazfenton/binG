/**
 * Claude Code Binary Detection
 *
 * Finds the `claude` CLI binary (Anthropic's Claude Code agent).
 *
 * Detection order:
 * 1. CLAUDE_BIN env var (explicit override)
 * 2. Command detection: which claude → where claude / Get-Command claude / type -p claude
 * 3. Default paths: $HOME/.claude/bin, /usr/local/bin/claude, %LOCALAPPDATA%\claude\bin, npm global
 */

import { createBinaryFinders, joinPaths, type FindBinaryOptions } from './find-agent-binary-base';

const { findBinary, findBinarySync } = createBinaryFinders({
  name: 'claude-code',
  envVar: 'CLAUDE_BIN',
  binName: 'claude',
  homeSubdirs: ['.claude/bin'],
  unixPaths: ['/usr/local/bin/claude'],
  windowsPaths: (home) => {
    const localAppData = process.env.LOCALAPPDATA || joinPaths(home, 'AppData', 'Local');
    return [joinPaths(localAppData, 'claude', 'bin')];
  },
});

export async function findClaudeCodeBinary(options?: FindBinaryOptions): Promise<string | null> {
  return findBinary(options);
}

export function findClaudeCodeBinarySync(options?: FindBinaryOptions): string | null {
  return findBinarySync(options);
}
