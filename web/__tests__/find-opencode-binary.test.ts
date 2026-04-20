/**
 * find-opencode-binary Unit Tests
 *
 * Tests for robust OS-aware OpenCode binary detection:
 * - Step 1: OPENCODE_BIN env var (explicit override)
 * - Step 2: Command-based detection (which, where, Get-Command, type -p)
 * - Step 3: Default fallback paths ($HOME/.opencode/bin, /usr/local/bin, etc.)
 * - Max command attempts enforced (default 2)
 * - No infinite loops
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------- Mocks ----------
// vi.mock factories are hoisted above imports, so we use vi.hoisted()
// to create mock functions that can be referenced inside the factories.

const { mockExecSync, mockExistsSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
  spawn: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
  tmpdir: vi.fn(() => '/tmp'),
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---------- Import after mocks ----------

import {
  findOpencodeBinary,
  findOpencodeBinarySync,
  resetBinaryCacheForTesting,
  type FindBinaryOptions,
} from '@/lib/opencode/find-opencode-binary';

// ---------- Helpers ----------

function resetEnv() {
  delete process.env.OPENCODE_BIN;
  delete process.env.LOCALAPPDATA;
  delete process.env.LLM_PROVIDER;
}

function setWindowsPlatform() {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
}

function setLinuxPlatform() {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
}

function setMacPlatform() {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
}

// ---------- Tests ----------

describe('find-opencode-binary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEnv();
    resetBinaryCacheForTesting();
    // Default: Linux, no binary found anywhere
    setLinuxPlatform();
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    resetEnv();
  });

  // ===== Step 1: OPENCODE_BIN env var =====

  describe('OPENCODE_BIN env var', () => {
    it('should return OPENCODE_BIN value when set', async () => {
      process.env.OPENCODE_BIN = '/custom/path/to/opencode';
      const result = await findOpencodeBinary();
      expect(result).toBe('/custom/path/to/opencode');
      // Should NOT try any commands
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringMatching(/which|where|Get-Command|type -p/),
        expect.anything(),
      );
    });

    it('should return OPENCODE_BIN value synchronously', () => {
      process.env.OPENCODE_BIN = '/custom/path/to/opencode';
      const result = findOpencodeBinarySync();
      expect(result).toBe('/custom/path/to/opencode');
    });

    it('should skip command detection and default paths when OPENCODE_BIN is set', async () => {
      process.env.OPENCODE_BIN = '/my/opencode';
      await findOpencodeBinary();
      // No commands or default paths should be tried
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining('opencode'),
        expect.anything(),
      );
    });
  });

  // ===== Step 2: Command-based detection =====

  describe('Command-based detection', () => {
    it('should try "which opencode" first on Linux', async () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '/usr/local/bin/opencode\n';
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result = await findOpencodeBinary();
      expect(result).toBe('/usr/local/bin/opencode');
      expect(mockExecSync).toHaveBeenCalledWith('which opencode', expect.anything());
    });

    it('should try "which opencode" first on Windows too', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return 'C:\\Program Files\\opencode\\opencode.exe\n';
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result = await findOpencodeBinary();
      // Paths are normalized to forward slashes
      expect(result).toBe('C:/Program Files/opencode/opencode.exe');
    });

    it('should try "where opencode" on Windows if which fails', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') throw new Error('not found');
        if (cmd === 'where opencode') return 'C:\\Users\\test\\AppData\\Local\\opencode\\bin\\opencode.exe\r\n';
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result = await findOpencodeBinary();
      // Paths are normalized to forward slashes
      expect(result).toBe('C:/Users/test/AppData/Local/opencode/bin/opencode.exe');
    });

    it('should try PowerShell (Get-Command) as 3rd option on Windows but NOT by default (maxAttempts=2)', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      const triedCommands: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        triedCommands.push(cmd);
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });

      await findOpencodeBinary({ maxCommandAttempts: 2 });
      // With maxCommandAttempts=2, should try 'which' and 'where' but NOT PowerShell
      expect(triedCommands).toContain('which opencode');
      expect(triedCommands).toContain('where opencode');
      expect(triedCommands).not.toContain(expect.stringContaining('Get-Command'));
    });

    it('should try PowerShell when maxCommandAttempts=3 on Windows', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      const triedCommands: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        triedCommands.push(cmd);
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });

      await findOpencodeBinary({ maxCommandAttempts: 3 });
      expect(triedCommands).toContain('which opencode');
      expect(triedCommands).toContain('where opencode');
      expect(triedCommands.some(c => c.includes('Get-Command'))).toBe(true);
    });

    it('should try "type -p opencode" as 2nd option on Linux', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      const triedCommands: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        triedCommands.push(cmd);
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });

      await findOpencodeBinary({ maxCommandAttempts: 2 });
      expect(triedCommands).toContain('which opencode');
      expect(triedCommands).toContain('type -p opencode');
    });

    it('should take first line of multi-line which output', async () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') {
          return '/usr/local/bin/opencode\n/home/user/.local/bin/opencode\n';
        }
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result = await findOpencodeBinary();
      expect(result).toBe('/usr/local/bin/opencode');
    });

    it('should verify the path exists on disk before returning', async () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '/nonexistent/opencode\n';
        throw new Error('not found');
      });
      // Path returned by which doesn't actually exist on disk
      mockExistsSync.mockReturnValue(false);

      const result = await findOpencodeBinary();
      // Should NOT return a path that doesn't exist
      expect(result).not.toBe('/nonexistent/opencode');
    });
  });

  // ===== Step 3: Default fallback paths =====

  describe('Default fallback paths', () => {
    it('should check $HOME/.opencode/bin/opencode on Linux', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      // All commands fail
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });
      // $HOME/.opencode/bin/opencode exists
      mockExistsSync.mockImplementation((p: string) => {
        return p === '/home/testuser/.opencode/bin/opencode';
      });

      const result = await findOpencodeBinary();
      expect(result).toBe('/home/testuser/.opencode/bin/opencode');
    });

    it('should check /usr/local/bin/opencode on Linux', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });
      mockExistsSync.mockImplementation((p: string) => {
        return p === '/usr/local/bin/opencode';
      });

      const result = await findOpencodeBinary();
      expect(result).toBe('/usr/local/bin/opencode');
    });

    it('should check %LOCALAPPDATA%\\opencode\\bin\\opencode.exe on Windows', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });
      // Paths are normalized to forward slashes by the source
      mockExistsSync.mockImplementation((p: string) => {
        return p === 'C:/Users/test/AppData/Local/opencode/bin/opencode.exe';
      });

      const result = await findOpencodeBinary();
      expect(result).toBe('C:/Users/test/AppData/Local/opencode/bin/opencode.exe');
    });

    it('should check $HOME/.opencode/bin/opencode.exe on Windows', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });
      mockExistsSync.mockImplementation((p: string) => {
        return p.includes('.opencode') && p.includes('bin') && p.includes('opencode.exe');
      });

      const result = await findOpencodeBinary();
      expect(result).toContain('.opencode');
      expect(result).toContain('opencode.exe');
    });

    it('should check npm global bin directory', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'npm config get prefix') return '/usr/local\n';
        throw new Error('not found');
      });
      mockExistsSync.mockImplementation((p: string) => {
        return p === '/usr/local/bin/opencode';
      });

      const result = await findOpencodeBinary();
      expect(result).toBe('/usr/local/bin/opencode');
    });

    it('should check npm .cmd wrapper on Windows', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'npm config get prefix') return 'C:\\Program Files\\nodejs\n';
        throw new Error('not found');
      });
      // Paths are normalized to forward slashes by the source
      mockExistsSync.mockImplementation((p: string) => {
        return p === 'C:/Program Files/nodejs/opencode.cmd';
      });

      const result = await findOpencodeBinary();
      expect(result).toBe('C:/Program Files/nodejs/opencode.cmd');
    });

    it('should skip npm path if npm is not available', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        throw new Error('not found');
      });
      mockExistsSync.mockImplementation((p: string) => {
        return p === '/usr/local/bin/opencode';
      });

      const result = await findOpencodeBinary();
      expect(result).toBe('/usr/local/bin/opencode');
    });
  });

  // ===== Max command attempts =====

  describe('Max command attempts', () => {
    it('should default to maxCommandAttempts=2', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      const triedCommands: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        triedCommands.push(cmd);
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });

      await findOpencodeBinary();
      const opencodeCmds = triedCommands.filter(c => c.includes('opencode') && !c.includes('npm'));
      expect(opencodeCmds.length).toBe(2); // which + type -p
    });

    it('should respect maxCommandAttempts=1', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      const triedCommands: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        triedCommands.push(cmd);
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });

      await findOpencodeBinary({ maxCommandAttempts: 1 });
      const opencodeCmds = triedCommands.filter(c => c.includes('opencode') && !c.includes('npm'));
      expect(opencodeCmds.length).toBe(1); // only 'which'
    });

    it('should stop after finding binary via command — no unnecessary attempts', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      const triedCommands: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        triedCommands.push(cmd);
        if (cmd === 'which opencode') return 'C:\\opencode\\bin\\opencode.exe\n';
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result = await findOpencodeBinary({ maxCommandAttempts: 3 });
      // Paths are normalized to forward slashes
      expect(result).toBe('C:/opencode/bin/opencode.exe');
      // Should NOT have tried 'where' or PowerShell since 'which' succeeded
      expect(triedCommands.filter(c => c.includes('opencode') && !c.includes('npm')).length).toBe(1);
    });

    it('should not loop endlessly — returns null after exhausting all options', async () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      mockExistsSync.mockReturnValue(false);

      const result = await findOpencodeBinary();
      expect(result).toBeNull();
    });
  });

  // ===== Caching =====

  describe('Caching', () => {
    it('should cache the result after first call (sync)', () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '/usr/local/bin/opencode\n';
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result1 = findOpencodeBinarySync();
      expect(result1).toBe('/usr/local/bin/opencode');

      // Clear mocks and change behavior — cache should still return old value
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      const result2 = findOpencodeBinarySync();
      expect(result2).toBe('/usr/local/bin/opencode');
    });

    it('should cache the result after first call (async)', async () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '/usr/local/bin/opencode\n';
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result1 = await findOpencodeBinary();
      expect(result1).toBe('/usr/local/bin/opencode');

      // Clear mocks and change behavior — cache should still return old value
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      const result2 = await findOpencodeBinary();
      expect(result2).toBe('/usr/local/bin/opencode');
    });

    it('should bypass cache when OPENCODE_BIN env var is set', () => {
      process.env.OPENCODE_BIN = '/env/bin/opencode';
      const result = findOpencodeBinarySync();
      expect(result).toBe('/env/bin/opencode');
      // env var always bypasses cache
    });

    it('should reset cache via resetBinaryCacheForTesting', () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '/first/path/opencode\n';
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result1 = findOpencodeBinarySync();
      expect(result1).toBe('/first/path/opencode');

      // Reset cache
      resetBinaryCacheForTesting();

      // Now change the mock and get a different result
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '/second/path/opencode\n';
        throw new Error('not found');
      });
      const result2 = findOpencodeBinarySync();
      expect(result2).toBe('/second/path/opencode');
    });
  });

  // ===== Sync variant =====

  describe('findOpencodeBinarySync', () => {
    it('should return OPENCODE_BIN env var when set', () => {
      process.env.OPENCODE_BIN = '/sync/opencode';
      const result = findOpencodeBinarySync();
      expect(result).toBe('/sync/opencode');
    });

    it('should find binary via command detection', () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '/usr/bin/opencode\n';
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result = findOpencodeBinarySync();
      expect(result).toBe('/usr/bin/opencode'); // already forward-slash, no change
    });

    it('should find binary via default fallback paths', () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      mockExistsSync.mockImplementation((p: string) => {
        return p === '/home/testuser/.opencode/bin/opencode';
      });

      const result = findOpencodeBinarySync();
      expect(result).toBe('/home/testuser/.opencode/bin/opencode');
    });

    it('should return null when binary not found anywhere', () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      mockExistsSync.mockReturnValue(false);

      const result = findOpencodeBinarySync();
      expect(result).toBeNull();
    });

    it('should respect maxCommandAttempts', () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      const triedCommands: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        triedCommands.push(cmd);
        throw new Error('not found');
      });

      findOpencodeBinarySync({ maxCommandAttempts: 1 });
      const opencodeCmds = triedCommands.filter(c => c.includes('opencode') && !c.includes('npm'));
      expect(opencodeCmds.length).toBe(1);
    });
  });

  // ===== Edge cases =====

  describe('Edge cases', () => {
    it('should handle empty string output from which', async () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '   \n';
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });

      const result = await findOpencodeBinary();
      expect(result).toBeNull();
    });

    it('should handle command timeout gracefully', async () => {
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation(() => {
        throw new Error('ETIMEDOUT: command timed out');
      });
      mockExistsSync.mockReturnValue(false);

      const result = await findOpencodeBinary();
      expect(result).toBeNull();
    });

    it('should handle LOCALAPPDATA fallback to AppData\\Local on Windows', async () => {
      setWindowsPlatform();
      delete process.env.OPENCODE_BIN;
      delete process.env.LOCALAPPDATA;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });
      mockExistsSync.mockImplementation((p: string) => {
        return p.includes('AppData') && p.includes('Local') && p.includes('opencode');
      });

      const result = await findOpencodeBinary();
      expect(result).toContain('AppData');
      expect(result).toContain('Local');
    });

    it('should handle macOS (darwin) platform like Linux', async () => {
      setMacPlatform();
      delete process.env.OPENCODE_BIN;
      const triedCommands: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        triedCommands.push(cmd);
        if (cmd === 'which opencode') return '/usr/local/bin/opencode\n';
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result = await findOpencodeBinary();
      expect(result).toBe('/usr/local/bin/opencode');
      // macOS should NOT try Windows-specific commands
      expect(triedCommands).not.toContain('where opencode');
      expect(triedCommands).not.toContain(expect.stringContaining('Get-Command'));
    });

    it('should return first existing default path when multiple exist', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      // Both $HOME/.opencode/bin/opencode and /usr/local/bin/opencode exist
      mockExistsSync.mockImplementation((p: string) => {
        return p === '/home/testuser/.opencode/bin/opencode' || p === '/usr/local/bin/opencode';
      });

      const result = await findOpencodeBinary();
      // Should return $HOME/.opencode/bin/opencode (checked first)
      expect(result).toBe('/home/testuser/.opencode/bin/opencode');
    });

    it('should prefer command result over default paths', async () => {
      setLinuxPlatform();
      delete process.env.OPENCODE_BIN;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which opencode') return '/opt/opencode/bin/opencode\n';
        if (cmd === 'npm config get prefix') throw new Error('no npm');
        throw new Error('not found');
      });
      mockExistsSync.mockReturnValue(true);

      const result = await findOpencodeBinary();
      expect(result).toBe('/opt/opencode/bin/opencode'); // forward-slash, already normalized
    });
  });
});
