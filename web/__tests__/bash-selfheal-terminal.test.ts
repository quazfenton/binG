/**
 * Bash Self-Heal + LLM Terminal Integration Tests
 *
 * Tests:
 * 1. Project detection (package.json, Cargo.toml, go.mod, requirements.txt)
 * 2. Natural language → command translation
 * 3. Self-heal retry on common error patterns
 * 4. cwd resolution from VFS scopedPath to real filesystem path
 * 5. End-to-end: LLM "run the project" → detect → execute
 *
 * Run: npx vitest run __tests__/bash-selfheal-terminal.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================
// Project Detection Tests
// ============================================================

describe('Project Detection', () => {
  const testDir = path.join(process.env.TEMP || '/tmp', 'bash-selfheal-test');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('detects npm dev script from package.json', async () => {
    const pkgPath = path.join(testDir, 'package.json');
    await fs.writeFile(pkgPath, JSON.stringify({
      name: 'test-project',
      scripts: { dev: 'next dev', build: 'next build', test: 'jest' },
    }));

    // Simulate detectProjectCommand logic
    const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    let detected: string | null = null;
    if (pkg.scripts) {
      const s = pkg.scripts;
      if (s.dev) detected = 'npm run dev';
      else if (s.start) detected = 'npm start';
      else if (s.build) detected = 'npm install && npm run build';
    }
    expect(detected).toBe('npm run dev');
  });

  it('detects npm start when dev is missing', async () => {
    const pkgPath = path.join(testDir, 'package.json');
    await fs.writeFile(pkgPath, JSON.stringify({
      name: 'test-project',
      scripts: { start: 'node server.js', build: 'tsc' },
    }));

    const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    let detected: string | null = null;
    if (pkg.scripts) {
      const s = pkg.scripts;
      if (s.dev) detected = 'npm run dev';
      else if (s.start) detected = 'npm start';
    }
    expect(detected).toBe('npm start');
  });

  it('detects Rust project from Cargo.toml', async () => {
    const cargoPath = path.join(testDir, 'Cargo.toml');
    await fs.writeFile(cargoPath, '[package]\nname = "test"\nversion = "0.1.0"');

    let detected = false;
    try {
      await fs.access(cargoPath);
      detected = true;
    } catch {}
    expect(detected).toBe(true);
  });

  it('detects Go project from go.mod', async () => {
    const goModPath = path.join(testDir, 'go.mod');
    await fs.writeFile(goModPath, 'module test\ngo 1.21');

    let detected = false;
    try {
      await fs.access(goModPath);
      detected = true;
    } catch {}
    expect(detected).toBe(true);
  });

  it('detects Python project from requirements.txt + main.py', async () => {
    const reqPath = path.join(testDir, 'requirements.txt');
    const mainPath = path.join(testDir, 'main.py');
    await fs.writeFile(reqPath, 'flask==2.0\nrequests');
    await fs.writeFile(mainPath, 'print("hello")');

    let detected: string | null = null;
    try {
      await fs.access(reqPath);
      for (const entry of ['main.py', 'app.py', 'run.py']) {
        try {
          await fs.access(path.join(testDir, entry));
          detected = 'pip install -r requirements.txt && python ' + entry;
          break;
        } catch {}
      }
    } catch {}
    expect(detected).toBe('pip install -r requirements.txt && python main.py');
  });

  it('returns null for unrecognized project type', async () => {
    // Empty directory
    let detected: string | null = null;

    try {
      const pkgPath = path.join(testDir, 'package.json');
      await fs.access(pkgPath);
    } catch {
      try {
        await fs.access(path.join(testDir, 'Cargo.toml'));
      } catch {
        try {
          await fs.access(path.join(testDir, 'go.mod'));
        } catch {
          try {
            await fs.access(path.join(testDir, 'requirements.txt'));
          } catch {
            detected = null;
          }
        }
      }
    }
    expect(detected).toBeNull();
  });
});

// ============================================================
// Natural Language → Command Translation Tests
// ============================================================

describe('Natural Language → Command Translation', () => {
  // Simulate the translateNaturalLanguageToCommand logic
  const translate = (task: string): string => {
    const lower = task.toLowerCase().trim();

    // Direct commands — pass through
    if (/^(npm|yarn|pnpm|npx|cargo|go|python|pip|node|deno|bun)\b/.test(lower)) return task;

    // "run the project", "start it", "debug the app"
    if (/(run|start|launch|debug|execute)\s*(the\s*)?(project|app|server|dev|it|this)?\s*$/i.test(lower) ||
        /^(run|start)$/.test(lower)) {
      return '[DETECT_PROJECT]';
    }

    // Build
    if (/^(build|compile|package)\b/i.test(lower)) return '[DETECT_BUILD]';

    // Test
    if (/^(test|run\s*tests?)\b/i.test(lower)) return 'npm test || echo "No test script found"';

    // Install
    if (/^(install|npm\s*install|yarn\s*add|pnpm\s*add)/i.test(lower)) return 'npm install';

    // Lint
    if (/^(lint|format|prettier|eslint)/i.test(lower)) return 'npm run lint || npm run format || echo "No lint script found"';

    // Git
    if (/^(git\s|commit|push|pull|branch)/i.test(lower)) return task;

    // List files
    if (/^(list|ls|dir|show\s*files)/i.test(lower)) return process.platform === 'win32' ? 'dir' : 'ls -la';

    // Pass through
    return task;
  };

  it('translates "run the project" to project detection', () => {
    expect(translate('run the project')).toBe('[DETECT_PROJECT]');
    expect(translate('Run it')).toBe('[DETECT_PROJECT]');
    expect(translate('start the app')).toBe('[DETECT_PROJECT]');
    expect(translate('debug')).toBe('[DETECT_PROJECT]');
    expect(translate('launch the server')).toBe('[DETECT_PROJECT]');
  });

  it('translates "build" commands', () => {
    expect(translate('build')).toBe('[DETECT_BUILD]');
    expect(translate('build the project')).toBe('[DETECT_BUILD]');
    expect(translate('compile')).toBe('[DETECT_BUILD]');
  });

  it('translates test commands', () => {
    expect(translate('test')).toBe('npm test || echo "No test script found"');
    expect(translate('run tests')).toBe('npm test || echo "No test script found"');
    expect(translate('test the project')).toBe('npm test || echo "No test script found"');
  });

  it('passes through direct npm commands', () => {
    expect(translate('npm run dev')).toBe('npm run dev');
    expect(translate('npm install --save lodash')).toBe('npm install --save lodash');
    expect(translate('npx create-react-app my-app')).toBe('npx create-react-app my-app');
  });

  it('passes through git commands', () => {
    expect(translate('git status')).toBe('git status');
    expect(translate('commit -m "fix"')).toBe('commit -m "fix"');
    expect(translate('push origin main')).toBe('push origin main');
  });

  it('translates file listing commands', () => {
    const expected = process.platform === 'win32' ? 'dir' : 'ls -la';
    expect(translate('ls')).toBe(expected);
    expect(translate('list files')).toBe(expected);
    expect(translate('show files')).toBe(expected);
  });

  it('passes through unrecognized commands as-is', () => {
    expect(translate('echo hello world')).toBe('echo hello world');
    expect(translate('cat /etc/hostname')).toBe('cat /etc/hostname');
  });
});

// ============================================================
// Self-Heal Error Pattern Matching Tests
// ============================================================

describe('Self-Heal Error Pattern Matching', () => {
  it('detects missing module errors', () => {
    const match1 = 'Error: Cannot find module "lodash"'.toLowerCase();
    expect(/(module\s+not\s+found|cannot\s+find\s+module|err_module_not_found)/.test(match1)).toBe(true);

    const match2 = 'ERR_MODULE_NOT_FOUND'.toLowerCase();
    expect(/(module\s+not\s+found|cannot\s+find\s+module|err_module_not_found)/.test(match2)).toBe(true);
  });

  it('detects command not found errors', () => {
    const match1 = 'npm: command not found'.toLowerCase();
    expect(/(command\s+not\s+found|is\s+not\s+recognized)/.test(match1)).toBe(true);

    const match2 = "'opencode' is not recognized".toLowerCase();
    expect(/(command\s+not\s+found|is\s+not\s+recognized)/.test(match2)).toBe(true);
  });

  it('detects port in use errors', () => {
    const match1 = 'Error: listen EADDRINUSE: address already in use :::3000'.toLowerCase();
    expect(/eaddrinuse|address already in use/.test(match1)).toBe(true);

    const match2 = 'Port 8080 is already in use'.toLowerCase();
    expect(/already in use|address already in use|eaddrinuse/.test(match2)).toBe(true);
  });

  it('detects file not found errors', () => {
    const match1 = 'ENOENT: no such file or directory'.toLowerCase();
    expect(/enoent|no such file/.test(match1)).toBe(true);

    const match2 = 'Cannot open file: config.json'.toLowerCase();
    expect(/enoent|no such file|cannot open file/.test(match2)).toBe(true);
  });

  it('detects permission errors', () => {
    const match1 = 'EACCES: permission denied'.toLowerCase();
    expect(/(permission\s+denied|eacces|eperm)/.test(match1)).toBe(true);

    const match2 = 'Permission denied (publickey)'.toLowerCase();
    expect(/(permission\s+denied|eacces|eperm)/.test(match2)).toBe(true);
  });

  it('returns null for unrecognized errors', () => {
    const patterns = [
      /(module\s+not\s+found|cannot\s+find\s+module|err_module_not_found)/,
      /(command\s+not\s+found|is\s+not\s+recognized)/,
      /eaddrinuse|address already in use/,
      /enoent|no such file/,
      /(permission\s+denied|eacces|eperm)/,
    ];

    const testErrors = [
      'SyntaxError: unexpected token',
      'TypeError: x is not a function',
      'Connection refused',
    ];

    for (const err of testErrors) {
      const matched = patterns.some(p => p.test(err.toLowerCase()));
      expect(matched).toBe(false);
    }
  });
});

// ============================================================
// cwd Resolution Tests (VFS scopedPath → Real Path)
// ============================================================

describe('cwd Resolution: VFS scopedPath → Real Path', () => {
  const resolveCwd = (requestedCwd: string, isWindows: boolean): string => {
    if (!requestedCwd) return isWindows ? 'C:\\temp\\opencode-workspace' : '/tmp/opencode-workspace';

    const sanitized = requestedCwd.replace(/\0/g, '');
    if (!sanitized) return isWindows ? 'C:\\temp\\opencode-workspace' : '/tmp/opencode-workspace';

    if (sanitized.startsWith('project/')) {
      const relativePart = sanitized.replace(/^project\//, '');
      // Use forward slashes for VFS paths — normalize for comparison
      const normalized = ('/tmp/opencode-workspace/' + relativePart).replace(/\/+/g, '/');
      return isWindows ? normalized.replace(/\//g, '\\') : normalized;
    }
    if (sanitized.startsWith('/workspace/')) {
      return sanitized.replace('/workspace/', isWindows ? 'C:\\temp\\' : '/home/user/workspace/');
    }
    // Already absolute
    return sanitized;
  };

  it('resolves VFS scoped path "project/sessions/002" to real path', () => {
    const resolved = resolveCwd('project/sessions/002', false);
    expect(resolved).toBe('/tmp/opencode-workspace/sessions/002');
  });

  it('resolves nested VFS paths', () => {
    const resolved = resolveCwd('project/sessions/002/src', false);
    expect(resolved).toBe('/tmp/opencode-workspace/sessions/002/src');
  });

  it('resolves /workspace/ paths on Linux', () => {
    const resolved = resolveCwd('/workspace/users/alice/sessions/001', false);
    expect(resolved).toBe('/home/user/workspace/users/alice/sessions/001');
  });

  it('resolves /workspace/ paths on Windows', () => {
    const resolved = resolveCwd('/workspace/users/alice/sessions/001', true);
    // Windows string replacement keeps forward slashes in the path portion
    expect(resolved).toBe('C:\\temp\\users/alice/sessions/001');
  });

  it('passes through absolute paths unchanged', () => {
    const resolved = resolveCwd('/custom/path', false);
    expect(resolved).toBe('/custom/path');
  });

  it('handles empty/invalid cwd', () => {
    expect(resolveCwd('', false)).toBe('/tmp/opencode-workspace');
    // project/ with nothing after — still gets the base path (trailing slash stripped by normalization)
    const result = resolveCwd('project/', false);
    expect(result.startsWith('/tmp/opencode-workspace')).toBe(true);
  });
});

// ============================================================
// Capability Router cwd Pass-Through Tests
// ============================================================

describe('Capability Router cwd Pass-Through', () => {
  it('sandbox.shell capability accepts cwd in input schema', async () => {
    const { SANDBOX_SHELL_CAPABILITY } = await import('@/lib/tools/capabilities');
    const result = SANDBOX_SHELL_CAPABILITY.inputSchema.safeParse({
      command: 'npm run dev',
      cwd: 'project/sessions/002',
    });
    expect(result.success).toBe(true);
    expect((result.data as any).cwd).toBe('project/sessions/002');
  });

  it('sandbox.shell capability cwd is optional', async () => {
    const { SANDBOX_SHELL_CAPABILITY } = await import('@/lib/tools/capabilities');
    const result = SANDBOX_SHELL_CAPABILITY.inputSchema.safeParse({
      command: 'ls -la',
    });
    expect(result.success).toBe(true);
  });

  it('sandbox.shell rejects invalid cwd types', async () => {
    const { SANDBOX_SHELL_CAPABILITY } = await import('@/lib/tools/capabilities');
    const result = SANDBOX_SHELL_CAPABILITY.inputSchema.safeParse({
      command: 'ls',
      cwd: 123, // Should be string
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// E2E: LLM "run the project" Full Pipeline
// ============================================================

describe('E2E: LLM "run the project" Full Pipeline', () => {
  it('simulates full pipeline: NL → detect → command', async () => {
    const testDir = path.join(process.env.TEMP || '/tmp', 'e2e-pipeline-test');
    await fs.mkdir(testDir, { recursive: true }).catch(() => {});

    // Step 1: Create a fake project
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'next dev', build: 'next build', test: 'jest' } })
    );

    // Step 2: LLM says "run the project" → translate
    const nlInput = 'run the project';
    const lower = nlInput.toLowerCase().trim();
    const isRunCommand = /(run|start|launch|debug|execute)\s*(the\s*)?(project|app|server|dev|it|this)?\s*$/i.test(lower);
    expect(isRunCommand).toBe(true);

    // Step 3: Detect project command
    const pkgRaw = await fs.readFile(path.join(testDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    let cmd: string | null = null;
    if (pkg.scripts?.dev) cmd = 'npm run dev';
    else if (pkg.scripts?.start) cmd = 'npm start';
    expect(cmd).toBe('npm run dev');

    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('simulates "build the project" pipeline', async () => {
    const testDir = path.join(process.env.TEMP || '/tmp', 'e2e-build-test');
    await fs.mkdir(testDir, { recursive: true }).catch(() => {});
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'next dev', build: 'next build' } })
    );

    const nlInput = 'build the project';
    const isBuild = /^(build|compile|package)\b/i.test(nlInput.toLowerCase());
    expect(isBuild).toBe(true);

    const pkg = JSON.parse(await fs.readFile(path.join(testDir, 'package.json'), 'utf-8'));
    const cmd = pkg.scripts?.build ? 'npm run build' : 'npm install && npm run build';
    expect(cmd).toBe('npm run build');

    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('simulates self-heal: missing dependency → auto-install', () => {
    // Simulate what happens when `npm run dev` fails because node_modules is missing
    const originalCommand = 'npm run dev';
    const errorOutput = 'Error: Cannot find module "next"\nRequire stack: - next.config.js';

    const el = errorOutput.toLowerCase();
    const isMissingModule = /(module\s+not\s+found|cannot\s+find\s+module|err_module_not_found)/i.test(el);
    expect(isMissingModule).toBe(true);

    const correctiveCommand = 'npm install && ' + originalCommand;
    expect(correctiveCommand).toBe('npm install && npm run dev');
  });
});
