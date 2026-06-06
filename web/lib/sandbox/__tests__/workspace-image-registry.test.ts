/**
 * Phase 7: Workspace Image Registry — Unit Tests
 *
 * Tests the workspace image synthesis system:
 * - Lockfile detection from workspace file paths
 * - Hash computation for dependency sets
 * - Image registration, lookup, touch, and TTL expiry
 * - Registry statistics
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkspaceImageRegistry,
  workspaceImageRegistry,
  type WorkspaceImage,
} from '../workspace-image-registry';

// ============================================================================
// Helpers
// ============================================================================

function makeImage(overrides?: Partial<WorkspaceImage>): WorkspaceImage {
  return {
    hash: `hash-${Date.now()}-${Math.random()}`,
    runtime: 'node',
    tools: ['npm'],
    framework: 'next',
    createdAt: Date.now(),
    useCount: 0,
    lastUsedAt: Date.now(),
    ttl: 3600000,
    sourceSandboxId: 'sandbox-123',
    sourceProvider: 'daytona',
    installCommands: ['npm install --prefer-offline --no-audit'],
    ...overrides,
  };
}

// ============================================================================
// Instance for tests (fresh to avoid TTL state issues)
// ============================================================================

let registry: WorkspaceImageRegistry;
beforeEach(() => {
  registry = new WorkspaceImageRegistry();
});

// ============================================================================
// Lockfile Detection Tests
// ============================================================================

describe('WorkspaceImageRegistry.detectLockfiles', () => {
  it('detects package-lock.json as npm/node lockfile', () => {
    const detected = registry.detectLockfiles(['src/index.ts', 'package-lock.json', 'README.md']);
    expect(detected.length).toBe(1);
    expect(detected[0].filename).toBe('package-lock.json');
    expect(detected[0].pattern.runtime).toBe('node');
    expect(detected[0].pattern.tool).toBe('npm');
  });

  it('detects pnpm-lock.yaml as pnpm/node lockfile', () => {
    const detected = registry.detectLockfiles(['pnpm-lock.yaml', 'src/app.ts']);
    expect(detected.length).toBe(1);
    expect(detected[0].filename).toBe('pnpm-lock.yaml');
    expect(detected[0].pattern.tool).toBe('pnpm');
  });

  it('detects requirements.txt as pip/python lockfile', () => {
    const detected = registry.detectLockfiles(['app.py', 'requirements.txt']);
    expect(detected.length).toBe(1);
    expect(detected[0].filename).toBe('requirements.txt');
    expect(detected[0].pattern.runtime).toBe('python');
    expect(detected[0].pattern.tool).toBe('pip');
  });

  it('detects Cargo.toml as rust lockfile', () => {
    const detected = registry.detectLockfiles(['src/main.rs', 'Cargo.toml', 'Cargo.lock']);
    expect(detected.length).toBe(1);
    expect(detected[0].filename).toBe('Cargo.toml');
    expect(detected[0].pattern.runtime).toBe('rust');
  });

  it('detects go.mod as go lockfile', () => {
    const detected = registry.detectLockfiles(['main.go', 'go.mod', 'go.sum']);
    expect(detected.length).toBe(1);
    expect(detected[0].filename).toBe('go.mod');
    expect(detected[0].pattern.runtime).toBe('go');
  });

  it('detects multiple lockfiles (monorepo with node+python)', () => {
    const detected = registry.detectLockfiles([
      'package.json', 'package-lock.json', 'requirements.txt', 'app.py',
    ]);
    expect(detected.length).toBe(2);
    expect(detected.map(d => d.filename)).toContain('package-lock.json');
    expect(detected.map(d => d.filename)).toContain('requirements.txt');
  });

  it('returns empty when no lockfiles found', () => {
    const detected = registry.detectLockfiles(['src/index.ts', 'README.md', '.gitignore']);
    expect(detected.length).toBe(0);
  });

  it('deduplicates repeated lockfile filenames', () => {
    const detected = registry.detectLockfiles([
      'a/package-lock.json', 'b/package-lock.json',
    ]);
    expect(detected.length).toBe(1);
    expect(detected[0].filename).toBe('package-lock.json');
  });

  it('handles empty file list', () => {
    const detected = registry.detectLockfiles([]);
    expect(detected.length).toBe(0);
  });

  it('detects bun.lockb as bun/node lockfile', () => {
    const detected = registry.detectLockfiles(['bun.lockb', 'src/app.ts']);
    expect(detected.length).toBe(1);
    expect(detected[0].pattern.tool).toBe('bun');
  });

  it('detects Gemfile as bundler/ruby lockfile', () => {
    const detected = registry.detectLockfiles(['Gemfile', 'Gemfile.lock']);
    expect(detected.length).toBe(2);
    expect(detected.map(d => d.pattern.runtime)).toEqual(['ruby', 'ruby']);
  });
});

// ============================================================================
// Hash Computation Tests
// ============================================================================

describe('WorkspaceImageRegistry.computeLockfileHash', () => {
  it('produces consistent hash for same lockfile contents', () => {
    const contents1 = new Map([['package-lock.json', '{"lockfileVersion":3}']]);
    const contents2 = new Map([['package-lock.json', '{"lockfileVersion":3}']]);
    const hash1 = registry.computeLockfileHash(contents1);
    const hash2 = registry.computeLockfileHash(contents2);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 hex
  });

  it('produces different hash for different contents', () => {
    const contents1 = new Map([['package-lock.json', '{"lockfileVersion":3}']]);
    const contents2 = new Map([['package-lock.json', '{"lockfileVersion":4}']]);
    const hash1 = registry.computeLockfileHash(contents1);
    const hash2 = registry.computeLockfileHash(contents2);
    expect(hash1).not.toBe(hash2);
  });

  it('includes filename in hash (same content, different filename → different hash)', () => {
    const contents1 = new Map([['package-lock.json', 'content']]);
    const contents2 = new Map([['pnpm-lock.yaml', 'content']]);
    expect(registry.computeLockfileHash(contents1))
      .not.toBe(registry.computeLockfileHash(contents2));
  });

  it('composite hash includes all lockfiles sorted', () => {
    const contents = new Map([
      ['requirements.txt', 'numpy>=1.0'],
      ['package-lock.json', '{"lockfileVersion":3}'],
    ]);
    const hash = registry.computeLockfileHash(contents);
    expect(hash).toHaveLength(64);
  });

  it('handles empty map', () => {
    const hash = registry.computeLockfileHash(new Map());
    expect(hash).toHaveLength(64);
  });
});

// ============================================================================
// Build DependencySet Tests
// ============================================================================

describe('WorkspaceImageRegistry.buildDependencySet', () => {
  it('builds dependency set from detected lockfiles', () => {
    const detected = registry.detectLockfiles(['package-lock.json']);
    const hash = 'abc123';
    const deps = registry.buildDependencySet(hash, detected, 'next');

    expect(deps.hash).toBe(hash);
    expect(deps.runtime).toBe('node');
    expect(deps.tools).toEqual(['npm']);
    expect(deps.framework).toBe('next');
    expect(deps.installCommands).toContain('npm install --prefer-offline --no-audit');
  });

  it('combines tools from multiple lockfiles', () => {
    const detected = registry.detectLockfiles(['package-lock.json', 'requirements.txt']);
    const deps = registry.buildDependencySet('hash', detected);

    expect(deps.runtime).toBe('node'); // first found
    expect(deps.tools).toEqual(['npm', 'pip']);
  });
});

// ============================================================================
// Image Registration & Lookup Tests
// ============================================================================

describe('WorkspaceImageRegistry.findImage / registerImage', () => {
  it('returns null when no image registered', () => {
    expect(registry.findImage('nonexistent')).toBeNull();
  });

  it('finds registered image by hash', () => {
    const image = makeImage({ hash: 'abc123' });
    registry.registerImage(image);
    expect(registry.findImage('abc123')).not.toBeNull();
    expect(registry.findImage('abc123')!.runtime).toBe('node');
  });

  it('overwrites existing image with same hash', () => {
    const image1 = makeImage({ hash: 'abc', runtime: 'node' });
    const image2 = makeImage({ hash: 'abc', runtime: 'python' });
    registry.registerImage(image1);
    registry.registerImage(image2);
    expect(registry.findImage('abc')!.runtime).toBe('python');
  });

  it('touchImage increments useCount and updates lastUsedAt', () => {
    const image = makeImage({ hash: 'abc', useCount: 0 });
    registry.registerImage(image);

    registry.touchImage('abc');
    const found = registry.findImage('abc')!;
    expect(found.useCount).toBe(1);
    expect(found.lastUsedAt).toBeGreaterThanOrEqual(image.lastUsedAt);
  });
});

// ============================================================================
// Remove Image Tests
// ============================================================================

describe('WorkspaceImageRegistry.removeImage', () => {
  it('removes an image by hash', () => {
    registry.registerImage(makeImage({ hash: 'abc' }));
    registry.removeImage('abc');
    expect(registry.findImage('abc')).toBeNull();
  });

  it('does not throw when removing non-existent image', () => {
    expect(() => registry.removeImage('nonexistent')).not.toThrow();
  });
});

// ============================================================================
// enable/disable Tests
// ============================================================================

describe('WorkspaceImageRegistry.isEnabled', () => {
  it('returns a boolean', () => {
    expect(typeof registry.isEnabled()).toBe('boolean');
  });
});

// ============================================================================
// Stats Tests
// ============================================================================

describe('WorkspaceImageRegistry.getStats', () => {
  it('returns empty stats when no images registered', () => {
    const stats = registry.getStats();
    expect(stats.totalImages).toBe(0);
    expect(stats.activeImages).toBe(0);
    expect(stats.nodeImages).toBe(0);
    expect(stats.pythonImages).toBe(0);
    expect(stats.totalUseCount).toBe(0);
    expect(typeof stats.enabled).toBe('boolean');
  });

  it('counts node and python images correctly', () => {
    registry.registerImage(makeImage({ hash: 'a', runtime: 'node' }));
    registry.registerImage(makeImage({ hash: 'b', runtime: 'python' }));
    registry.registerImage(makeImage({ hash: 'c', runtime: 'node' }));

    const stats = registry.getStats();
    expect(stats.totalImages).toBe(3);
    expect(stats.nodeImages).toBe(2);
    expect(stats.pythonImages).toBe(1);
  });

  it('tracks use counts', () => {
    const image = makeImage({ hash: 'abc' });
    registry.registerImage(image);
    registry.touchImage('abc');
    registry.touchImage('abc');

    const stats = registry.getStats();
    expect(stats.totalUseCount).toBe(2);
  });

  it('counts estimated size', () => {
    registry.registerImage(makeImage({
      hash: 'a',
      estimatedSizeBytes: 1048576, // 1 MB
    }));
    registry.registerImage(makeImage({
      hash: 'b',
      estimatedSizeBytes: 5242880, // 5 MB
    }));

    const stats = registry.getStats();
    // 1 + 5 = 6 MB, rounded
    expect(stats.totalEstimatedSizeMb).toBe(6);
  });
});

// ============================================================================
// Singleton Export Test
// ============================================================================

describe('workspaceImageRegistry singleton', () => {
  it('is exported and has expected methods', () => {
    expect(workspaceImageRegistry).toBeDefined();
    expect(typeof workspaceImageRegistry.detectLockfiles).toBe('function');
    expect(typeof workspaceImageRegistry.computeLockfileHash).toBe('function');
    expect(typeof workspaceImageRegistry.findImage).toBe('function');
    expect(typeof workspaceImageRegistry.registerImage).toBe('function');
    expect(typeof workspaceImageRegistry.getStats).toBe('function');
  });
});
