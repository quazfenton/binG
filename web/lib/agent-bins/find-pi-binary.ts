/**
 * Pi Binary Detection
 *
 * Finds the `pi` CLI binary using the shared agent binary detection base.
 *
 * Detection order:
 * 1. PI_BIN env var (explicit override)
 * 2. Command detection: which pi → where pi / Get-Command pi / type -p pi
 * 3. Default paths: $HOME/.pi/bin, /usr/local/bin/pi, %LOCALAPPDATA%\pi\bin, npm global
 */

import { createBinaryFinders, joinPaths, type FindBinaryOptions } from './find-agent-binary-base';

const { findBinary, findBinarySync } = createBinaryFinders({
  name: 'pi',
  envVar: 'PI_BIN',
  binName: 'pi',
  homeSubdirs: ['.pi/bin'],
  unixPaths: ['/usr/local/bin/pi'],
  windowsPaths: (home) => {
    const localAppData = process.env.LOCALAPPDATA || joinPaths(home, 'AppData', 'Local');
    return [joinPaths(localAppData, 'pi', 'bin')];
  },
});

export async function findPiBinary(options?: FindBinaryOptions): Promise<string | null> {
  return findBinary(options);
}

export function findPiBinarySync(options?: FindBinaryOptions): string | null {
  return findBinarySync(options);
}
