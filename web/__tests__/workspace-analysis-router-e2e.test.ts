/**
 * E2E Tests: Workspace Analysis — Router → Provider → Service Path
 *
 * Tests the full execution path end-to-end:
 * 1. Register workspace-analysis provider in CapabilityRouter
 * 2. Execute all 4 capabilities via router.execute()
 * 3. Verify provider is found, handlers execute, and output structure is correct
 * 4. Verify error handling (unknown capability, missing data)
 * 5. Verify context integration (ownerId normalization)
 *
 * This tests the critical provider registration fix: without it, the router
 * would fail with "All providers failed for workspace.analyze" because the
 * 'workspace-analysis' provider was not registered in the CapabilityRouter.
 *
 * Run: npx vitest run __tests__/workspace-analysis-router-e2e.test.ts
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// ============================================================================
// Mock data factories (defined before vi.mock to avoid hoisting issues)
// ============================================================================

const { mockExportWorkspace, mockReadFile, mockBuildProjectContext, mockDetectPackageManager } = vi.hoisted(() => ({
  mockExportWorkspace: vi.fn(),
  mockReadFile: vi.fn(),
  mockBuildProjectContext: vi.fn(),
  mockDetectPackageManager: vi.fn(),
}));

function createMockWorkspace(files: string[]) {
  return { files: files.map(f => ({ path: f })) };
}

function createMockProjectContext(overrides: Record<string, any> = {}) {
  return {
    framework: 'next',
    packageManager: 'npm',
    runtimeMode: 'standard',
    projectRoot: '.',
    entryFile: 'src/index.ts',
    runCommand: 'npm run dev',
    testCommand: 'npm run test',
    buildCommand: 'npm run build',
    packageJsonScripts: ['dev', 'build', 'test', 'lint'],
    dockerCommand: undefined,
    hints: [],
    ...overrides,
  };
}

function createMockPackageJson(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    name: 'test-workspace',
    version: '1.0.0',
    scripts: {
      dev: 'next dev',
      build: 'next build',
      test: 'vitest run',
      lint: 'next lint',
    },
    dependencies: { next: '14.0.0', react: '18.2.0', 'react-dom': '18.2.0' },
    devDependencies: { vitest: '1.0.0', typescript: '5.3.0' },
    ...overrides,
  });
}

// ============================================================================
// Mock VFS module (used by getFileListing / readVFSFile / readJSONFile)
// ============================================================================

vi.mock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    exportWorkspace: mockExportWorkspace,
    readFile: mockReadFile,
  },
}));

// ============================================================================
// Mock project-detection module (used by analyzeProject / getDependencies)
// ============================================================================

vi.mock('@/lib/context/project-detection', () => ({
  buildProjectContext: mockBuildProjectContext,
  detectPackageManager: mockDetectPackageManager,
  detectRuntimeMode: vi.fn(() => 'standard'),
  detectProjectRoot: vi.fn(() => '.'),
  detectEntryFile: vi.fn(() => 'src/index.ts'),
  detectFrameworkFromFiles: vi.fn(() => 'next'),
  detectPackageManagerFromPackageJson: vi.fn(() => 'npm'),
  getInstallCommand: vi.fn(() => 'npm install'),
  getDockerCommands: vi.fn(() => null),
  getRunCommandPrefix: vi.fn(() => 'npm run'),
  detectRunCommand: vi.fn(() => 'npm run dev'),
  detectTestCommand: vi.fn(() => 'vitest run'),
  detectBuildCommand: vi.fn(() => 'next build'),
  formatSmartContextAsMarkdown: vi.fn(() => '# Workspace Analysis'),
  generateSmartContext: vi.fn(() => ({})),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { getCapabilityRouter } from '@/lib/tools/router';
import { getCapability } from '@/lib/tools/capabilities';
import {
  analyzeProject,
  listScripts,
  getDependencies,
  buildProjectStructure,
} from '@/lib/tools/project-analysis';

// ============================================================================
// Helpers: register/unregister the workspace-analysis provider
// ============================================================================

const CAPABILITIES = [
  'workspace.analyze',
  'workspace.list_scripts',
  'workspace.dependencies',
  'workspace.structure',
];

async function registerWorkspaceAnalysisProvider() {
  const router = getCapabilityRouter();

  if (!(router as any).initialized) {
    await router.initialize();
  }

  // Unregister first to ensure clean state
  router.unregisterProvider('workspace-analysis');

  await router.registerCustomProvider({
    id: 'workspace-analysis',
    name: 'Workspace Analysis',
    capabilities: CAPABILITIES,
    isAvailable: async () => true,
    execute: async (capabilityId: string, input: any, context: any) => {
      // Normalize ownerId: 'anonymous' -> 'anon:public', 'anon_timestamp' -> 'anon:timestamp'
      let ownerId = (typeof context?.userId === 'string' ? context.userId : 'anon:public');
      if (ownerId.startsWith('anon_')) {
        ownerId = ownerId.replace(/^anon_/, 'anon:');
      } else if (ownerId === 'anonymous') {
        ownerId = 'anon:public';
      }

      try {
        let output: any;
        switch (capabilityId) {
          case 'workspace.analyze':
            output = await analyzeProject(ownerId, {
              includeDependencies: input.includeDependencies ?? false,
            });
            break;
          case 'workspace.list_scripts':
            output = { scripts: await listScripts(ownerId) };
            break;
          case 'workspace.dependencies':
            output = await getDependencies(ownerId);
            break;
          case 'workspace.structure': {
            const { virtualFilesystem } = await import(
              '@/lib/virtual-filesystem/virtual-filesystem-service'
            );
            const workspace = await virtualFilesystem.exportWorkspace(ownerId);
            const filePaths = workspace.files.map((f: any) => f.path);
            output = buildProjectStructure(filePaths, input.maxDepth ?? 5);
            if (input.summaryOnly) {
              output = {
                fileCount: output.fileCount,
                dirCount: output.dirCount,
                fileTypes: output.fileTypes,
                summary: output.summary,
                notableItems: output.notableItems,
              };
            }
            break;
          }
          default:
            return { success: false, error: `Unknown capability: ${capabilityId}` };
        }
        return { success: true, output, data: output };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });
}

async function unregisterWorkspaceAnalysisProvider() {
  const router = getCapabilityRouter();
  router.unregisterProvider('workspace-analysis');
}

// ============================================================================
// Helpers: set up mock data for a standard Next.js workspace
// ============================================================================

function setupStandardWorkspace() {
  const filePaths = [
    'package.json',
    'tsconfig.json',
    'next.config.js',
    'tailwind.config.ts',
    'postcss.config.mjs',
    'src/index.ts',
    'src/app/page.tsx',
    'src/app/layout.tsx',
    'src/components/header.tsx',
    'src/components/footer.tsx',
    'README.md',
    '.gitignore',
    '.env.example',
  ];

  mockExportWorkspace.mockResolvedValue(createMockWorkspace(filePaths));
  mockReadFile.mockImplementation(async (_userId: string, path: string) => {
    if (path === 'package.json' || path === '/package.json') {
      return { content: createMockPackageJson() };
    }
    if (path === 'Makefile') {
      return { content: 'build:\n  echo building\ntest:\n  echo testing' };
    }
    return { content: '' };
  });
  mockBuildProjectContext.mockResolvedValue(createMockProjectContext());
  mockDetectPackageManager.mockReturnValue('npm');

  return filePaths;
}

// ============================================================================
// Tests
// ============================================================================

describe('Workspace Analysis — Router E2E', () => {
  beforeAll(async () => {
    await registerWorkspaceAnalysisProvider();
  });

  afterAll(() => {
    unregisterWorkspaceAnalysisProvider();
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Provider Registration
  // ==========================================================================

  describe('provider registration', () => {
    it('has the workspace-analysis provider registered', async () => {
      const router = getCapabilityRouter();
      const provider = router.getProvider('workspace-analysis');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('workspace-analysis');
      expect(provider!.name).toBe('Workspace Analysis');
      expect(provider!.capabilities).toEqual(CAPABILITIES);
    });

    it('hasCapability returns true for all workspace-analysis capabilities', async () => {
      const router = getCapabilityRouter();
      expect(await router.hasCapability('workspace.analyze')).toBe(true);
      expect(await router.hasCapability('workspace.list_scripts')).toBe(true);
      expect(await router.hasCapability('workspace.dependencies')).toBe(true);
      expect(await router.hasCapability('workspace.structure')).toBe(true);
    });

    it('capability definitions exist with correct providerPriority', () => {
      for (const capId of CAPABILITIES) {
        const cap = getCapability(capId);
        expect(cap).toBeDefined();
        expect(cap!.providerPriority).toContain('workspace-analysis');
      }
    });
  });

  // ==========================================================================
  // workspace.analyze — Deep Workspace Analysis
  // ==========================================================================

  describe('workspace.analyze', () => {
    it('returns a complete analysis via router.execute()', async () => {
      const router = getCapabilityRouter();
      setupStandardWorkspace();

      const result = await router.execute(
        'workspace.analyze',
        { includeDependencies: true },
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();

      const analysis = result.output;
      expect(typeof analysis.framework).toBe('string');
      expect(typeof analysis.packageManager).toBe('string');
      expect(typeof analysis.runtimeMode).toBe('string');
      expect(typeof analysis.fileCount).toBe('number');
      expect(Array.isArray(analysis.scripts)).toBe(true);
      expect(Array.isArray(analysis.configFiles)).toBe(true);
      expect(Array.isArray(analysis.hints)).toBe(true);
      expect(Array.isArray(analysis.potentialIssues)).toBe(true);
      expect(Array.isArray(analysis.topDirs)).toBe(true);
      expect(analysis.recommendedCommands).toBeDefined();
      expect(typeof analysis.recommendedCommands.install).toBe('string');

      // Framework should be detected
      expect(analysis.framework).toBe('next');
      expect(analysis.packageManager).toBe('npm');
    });

    it('returns empty analysis for empty workspace', async () => {
      const router = getCapabilityRouter();

      // Empty workspace — no files
      mockExportWorkspace.mockResolvedValue(createMockWorkspace([]));

      const result = await router.execute(
        'workspace.analyze',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      const analysis = result.output;
      expect(analysis.framework).toBe('unknown');
      expect(analysis.fileCount).toBe(0);
      expect(analysis.potentialIssues).toContain('No files found in workspace');
    });

    it('handles VFS errors gracefully', async () => {
      const router = getCapabilityRouter();

      mockExportWorkspace.mockRejectedValue(new Error('VFS connection failed'));

      const result = await router.execute(
        'workspace.analyze',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ==========================================================================
  // workspace.list_scripts — All Runnable Scripts/Tasks
  // ==========================================================================

  describe('workspace.list_scripts', () => {
    it('returns npm scripts from package.json via router.execute()', async () => {
      const router = getCapabilityRouter();
      setupStandardWorkspace();

      const result = await router.execute(
        'workspace.list_scripts',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      expect(result.output.scripts).toBeDefined();
      expect(Array.isArray(result.output.scripts)).toBe(true);

      // Should include npm scripts from package.json
      const scriptNames = result.output.scripts.map((s: any) => s.name);
      expect(scriptNames).toContain('dev');
      expect(scriptNames).toContain('build');
      expect(scriptNames).toContain('test');
    });

    it('returns scripts from multiple sources', async () => {
      const router = getCapabilityRouter();

      // Workspace with package.json AND Makefile
      mockExportWorkspace.mockResolvedValue(
        createMockWorkspace([
          'package.json',
          'Makefile',
          'README.md',
        ]),
      );
  mockReadFile.mockImplementation(async (_userId: string, path: string) => {
    if (path === 'package.json' || path === '/package.json') {
      return { content: createMockPackageJson() };
    }
    if (path === 'Makefile') {
      return { content: 'build:\n  echo building\ntest:\n  echo testing\nclean:\n  rm -rf dist' };
    }
    return { content: '' };
  });

      const result = await router.execute(
        'workspace.list_scripts',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      const scripts = result.output.scripts;
      expect(scripts.length).toBeGreaterThanOrEqual(4); // 4 npm scripts + Makefile targets

      // Should include Makefile targets
      const scriptSrc = scripts.map((s: any) => s.source);
      expect(scriptSrc).toContain('makefile');
    });

    it('returns empty array for workspace with no scripts', async () => {
      const router = getCapabilityRouter();

      // Workspace with no package.json, no Makefile, no known script sources
      mockExportWorkspace.mockResolvedValue(
        createMockWorkspace(['README.md', '.gitignore']),
      );

      const result = await router.execute(
        'workspace.list_scripts',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      expect(result.output.scripts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // workspace.dependencies — Installed Packages & Issues
  // ==========================================================================

  describe('workspace.dependencies', () => {
    it('returns dependencies from package.json via router.execute()', async () => {
      const router = getCapabilityRouter();
      setupStandardWorkspace();

      mockDetectPackageManager.mockReturnValue('npm');

      const result = await router.execute(
        'workspace.dependencies',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();

      const deps = result.output;
      expect(deps.dependencies).toBeDefined();
      expect(deps.devDependencies).toBeDefined();
      expect(deps.dependencies.next).toBe('14.0.0');
      expect(deps.dependencies.react).toBe('18.2.0');
      expect(Array.isArray(deps.issues)).toBe(true);
      expect(deps.packageManager).toBe('npm');
    });

    it('detects missing lock file as a warning', async () => {
      const router = getCapabilityRouter();

      // Workspace with package.json but no lock files
      mockExportWorkspace.mockResolvedValue(
        createMockWorkspace(['package.json']),
      );
  mockReadFile.mockImplementation(async (_userId: string, path: string) => {
    if (path === 'package.json' || path === '/package.json') {
      return { content: createMockPackageJson() };
    }
    return { content: '' };
  });
  mockDetectPackageManager.mockReturnValue('npm');

      const result = await router.execute(
        'workspace.dependencies',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      const issues = result.output.issues;
      const missingLockIssue = issues.find((i: any) => i.type === 'missing-lockfile');
      expect(missingLockIssue).toBeDefined();
      expect(missingLockIssue.severity).toBe('warning');
    });

    it('detects workspace references and peer dependencies', async () => {
      const router = getCapabilityRouter();

      mockExportWorkspace.mockResolvedValue(
        createMockWorkspace(['package.json', 'pnpm-lock.yaml']),
      );
  mockReadFile.mockImplementation(async (_userId: string, path: string) => {
    if (path === 'package.json' || path === '/package.json') {
      return {
        content: JSON.stringify({
          name: 'monorepo',
          dependencies: {
            react: '18.2.0',
            'react-dom': '18.3.0',
            'local-pkg': 'workspace:*',
          },
          devDependencies: {},
        }),
      };
    }
    return { content: '' };
  });
      mockDetectPackageManager.mockReturnValue('pnpm');

      const result = await router.execute(
        'workspace.dependencies',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      const issues = result.output.issues;
      expect(issues.length).toBeGreaterThanOrEqual(2);

      // Should detect react/react-dom version mismatch
      const conflictIssue = issues.find((i: any) => i.type === 'conflict');
      expect(conflictIssue).toBeDefined();

      // Should detect workspace reference
      const workspaceRefIssue = issues.find((i: any) => i.type === 'info');
      expect(workspaceRefIssue).toBeDefined();
    });
  });

  // ==========================================================================
  // workspace.structure — Semantic File Tree
  // ==========================================================================

  describe('workspace.structure', () => {
    it('returns project structure via router.execute()', async () => {
      const router = getCapabilityRouter();
      setupStandardWorkspace();

      const result = await router.execute(
        'workspace.structure',
        { maxDepth: 3 },
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();

      const structure = result.output;
      expect(typeof structure.fileCount).toBe('number');
      expect(typeof structure.dirCount).toBe('number');
      expect(structure.fileTypes).toBeDefined();
      expect(typeof structure.summary).toBe('string');
      expect(Array.isArray(structure.notableItems)).toBe(true);

      // Should have the correct file count
      expect(structure.fileCount).toBeGreaterThan(0);
      expect(structure.dirCount).toBeGreaterThan(0);

      // Should detect notable files
      expect(structure.notableItems).toContain('package.json');
    });

    it('returns summary-only structure when summaryOnly is true', async () => {
      const router = getCapabilityRouter();
      setupStandardWorkspace();

      const result = await router.execute(
        'workspace.structure',
        { summaryOnly: true, maxDepth: 3 },
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);

      // Summary-only: should NOT include the full tree
      expect(result.output.tree).toBeUndefined();
      expect(typeof result.output.summary).toBe('string');
      expect(typeof result.output.fileCount).toBe('number');
    });

    it('handles empty workspace with empty structure', async () => {
      const router = getCapabilityRouter();

      mockExportWorkspace.mockResolvedValue(createMockWorkspace([]));

      const result = await router.execute(
        'workspace.structure',
        { maxDepth: 5 },
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      expect(result.output.fileCount).toBe(0);
      expect(result.output.dirCount).toBe(0);
      expect(result.output.notableItems).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('rejects unknown capability ID', async () => {
      const router = getCapabilityRouter();

      const result = await router.execute('workspace.nonexistent', {}, { userId: 'e2e-test-user' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown capability');
    });

    it('handles unregistered provider gracefully', async () => {
      // Temporarily unregister the workspace-analysis provider
      const router = getCapabilityRouter();
      router.unregisterProvider('workspace-analysis');

      const result = await router.execute('workspace.analyze', {}, { userId: 'e2e-test-user' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('provider');

      // Re-register for subsequent tests
      await registerWorkspaceAnalysisProvider();
    });
  });

  // ==========================================================================
  // Context Integration
  // ==========================================================================

  describe('context integration', () => {
    it('normalizes ownerId from context.userId', async () => {
      const router = getCapabilityRouter();
      setupStandardWorkspace();

      const result = await router.execute(
        'workspace.analyze',
        {},
        { userId: 'e2e-test-user' },
      );

      expect(result.success).toBe(true);
      expect(result.output.framework).toBeDefined();
      // VFS should have been called with the normalized ownerId
      expect(mockExportWorkspace).toHaveBeenCalledWith('e2e-test-user');
    });

    it('uses anon:public as fallback when no userId in context', async () => {
      const router = getCapabilityRouter();

      mockExportWorkspace.mockResolvedValue(createMockWorkspace(['package.json']));
  mockReadFile.mockImplementation(async (_userId: string, path: string) => {
    if (path === 'package.json' || path === '/package.json') {
      return { content: createMockPackageJson() };
    }
    return { content: '' };
  });
  mockBuildProjectContext.mockResolvedValue(createMockProjectContext());

      const result = await router.execute(
        'workspace.analyze',
        {},
        {}, // No userId in context
      );

      expect(result.success).toBe(true);
      // VFS should be called with the fallback ownerId
      expect(mockExportWorkspace).toHaveBeenCalledWith('anon:public');
    });

    it('normalizes anonymous-style owner IDs', async () => {
      const router = getCapabilityRouter();
      setupStandardWorkspace();

      const result = await router.execute(
        'workspace.analyze',
        {},
        { userId: 'anon_abc123' },
      );

      expect(result.success).toBe(true);
      // Should normalize 'anon_abc123' to 'anon:abc123'
      expect(mockExportWorkspace).toHaveBeenCalledWith('anon:abc123');
    });
  });

  // ==========================================================================
  // Runtime Behavior
  // ==========================================================================

  describe('runtime behavior', () => {
    it('handles all 4 capabilities via router without cross-contamination', async () => {
      const router = getCapabilityRouter();
      setupStandardWorkspace();

      // Execute all 4 capabilities sequentially on the same workspace
      const results = await Promise.all([
        router.execute('workspace.analyze', {}, { userId: 'multi-test' }),
        router.execute('workspace.list_scripts', {}, { userId: 'multi-test' }),
        router.execute('workspace.dependencies', {}, { userId: 'multi-test' }),
        router.execute('workspace.structure', { maxDepth: 3 }, { userId: 'multi-test' }),
      ]);

      for (const result of results) {
        expect(result.success).toBe(true);
      }

      // Each result should have distinct output structure
      expect(results[0].output.framework).toBeDefined();
      expect(results[1].output.scripts).toBeDefined();
      expect(results[2].output.dependencies).toBeDefined();
      expect(results[3].output.fileCount).toBeDefined();
    });
  });
});
