/**
 * Amp Binary Detection
 *
 * Finds the `amp` CLI binary (OpenAI Amp, Codex successor).
 *
 * Detection order:
 * 1. AMP_BIN env var (explicit override)
 * 2. Command detection: which amp → where amp / Get-Command amp / type -p amp
 * 3. Default paths: $HOME/.amp/bin, /usr/local/bin/amp, %LOCALAPPDATA%\amp\bin, npm global
 */

import { createBinaryFinders, joinPaths, type FindBinaryOptions } from './find-agent-binary-base';

const { findBinary, findBinarySync } = createBinaryFinders({
  name: 'amp',
  envVar: 'AMP_BIN',
  binName: 'amp',
  homeSubdirs: ['.amp/bin'],
  unixPaths: ['/usr/local/bin/amp'],
  windowsPaths: (home) => {
    const localAppData = process.env.LOCALAPPDATA || joinPaths(home, 'AppData', 'Local');
    return [joinPaths(localAppData, 'amp', 'bin')];
  },
});

export async function findAmpBinary(options?: FindBinaryOptions): Promise<string | null> {
  return findBinary(options);
}

export function findAmpBinarySync(options?: FindBinaryOptions): string | null {
  return findBinarySync(options);
}
