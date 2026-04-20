/**
 * OpenCode Binary Detection
 *
 * Finds the `opencode` CLI binary using the shared agent binary detection base.
 * Re-exports the same API as the original find-opencode-binary for backward compatibility.
 *
 * Detection order:
 * 1. OPENCODE_BIN env var (explicit override)
 * 2. Command detection: which opencode → where opencode / Get-Command opencode / type -p opencode
 * 3. Default paths: $HOME/.opencode/bin, /usr/local/bin/opencode, %LOCALAPPDATA%\opencode\bin, npm global
 */

import { createBinaryFinders, joinPaths, resetBinaryCacheForTesting as baseReset, type FindBinaryOptions } from './find-agent-binary-base';

const { findBinary, findBinarySync } = createBinaryFinders({
  name: 'opencode',
  envVar: 'OPENCODE_BIN',
  binName: 'opencode',
  homeSubdirs: ['.opencode/bin'],
  unixPaths: ['/usr/local/bin/opencode'],
  windowsPaths: (home) => {
    const localAppData = process.env.LOCALAPPDATA || joinPaths(home, 'AppData', 'Local');
    return [joinPaths(localAppData, 'opencode', 'bin')];
  },
});

/**
 * Find the opencode binary path (async).
 * @returns Absolute path to the opencode binary, or null if not found.
 */
export async function findOpencodeBinary(options?: FindBinaryOptions): Promise<string | null> {
  return findBinary(options);
}

/**
 * Find the opencode binary path (sync).
 * @returns Absolute path to the opencode binary, or null if not found.
 */
export function findOpencodeBinarySync(options?: FindBinaryOptions): string | null {
  return findBinarySync(options);
}

/**
 * Reset the opencode binary cache. Intended ONLY for test isolation.
 */
export function resetBinaryCacheForTesting(): void {
  baseReset('opencode');
}
