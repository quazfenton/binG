/**
 * Kilocode Binary Detection
 *
 * Finds the `kilocode` CLI binary using the shared agent binary detection base.
 *
 * Detection order:
 * 1. KILOCODE_BIN env var (explicit override)
 * 2. Command detection: which kilocode → where kilocode / Get-Command kilocode / type -p kilocode
 * 3. Default paths: $HOME/.kilocode/bin, /usr/local/bin/kilocode, %LOCALAPPDATA%\kilocode\bin, npm global
 */

import { createBinaryFinders, joinPaths, type FindBinaryOptions } from './find-agent-binary-base';

const { findBinary, findBinarySync } = createBinaryFinders({
  name: 'kilocode',
  envVar: 'KILOCODE_BIN',
  binName: 'kilocode',
  homeSubdirs: ['.kilocode/bin'],
  unixPaths: ['/usr/local/bin/kilocode'],
  windowsPaths: (home) => {
    const localAppData = process.env.LOCALAPPDATA || joinPaths(home, 'AppData', 'Local');
    return [joinPaths(localAppData, 'kilocode', 'bin')];
  },
});

export async function findKilocodeBinary(options?: FindBinaryOptions): Promise<string | null> {
  return findBinary(options);
}

export function findKilocodeBinarySync(options?: FindBinaryOptions): string | null {
  return findBinarySync(options);
}