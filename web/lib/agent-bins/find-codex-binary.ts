/**
 * Codex Binary Detection
 *
 * Finds the `codex` CLI binary (OpenAI's open-source coding agent).
 *
 * Detection order:
 * 1. CODEX_BIN env var (explicit override)
 * 2. Command detection: which codex → where codex / Get-Command codex / type -p codex
 * 3. Default paths: $HOME/.codex/bin, /usr/local/bin/codex, %LOCALAPPDATA%\codex\bin, npm global
 */

import { createBinaryFinders, joinPaths, type FindBinaryOptions } from './find-agent-binary-base';

const { findBinary, findBinarySync } = createBinaryFinders({
  name: 'codex',
  envVar: 'CODEX_BIN',
  binName: 'codex',
  homeSubdirs: ['.codex/bin'],
  unixPaths: ['/usr/local/bin/codex'],
  windowsPaths: (home) => {
    const localAppData = process.env.LOCALAPPDATA || joinPaths(home, 'AppData', 'Local');
    return [joinPaths(localAppData, 'codex', 'bin')];
  },
});

export async function findCodexBinary(options?: FindBinaryOptions): Promise<string | null> {
  return findBinary(options);
}

export function findCodexBinarySync(options?: FindBinaryOptions): string | null {
  return findBinarySync(options);
}
