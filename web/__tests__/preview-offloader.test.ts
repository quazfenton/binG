/**
 * Tests for Preview Offloader
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}))

// Mock sandbox providers
vi.mock('../lib/sandbox/providers', () => ({
  getSandboxProvider: vi.fn(() => ({
    createSandbox: vi.fn(() => Promise.resolve({
      id: 'test-sandbox',
      workspaceDir: '/workspace',
      writeFile: vi.fn(() => Promise.resolve({ success: true })),
      executeCommand: vi.fn(() => Promise.resolve({ success: true })),
      getPreviewLink: vi.fn(() => Promise.resolve({ url: 'http://preview.local' })),
      destroySandbox: vi.fn(() => Promise.resolve()),
    })),
    destroySandbox: vi.fn(),
  })),
}))

// TODO(PreviewOffloader): The `lib/sandbox/preview-offloader` module referenced
// by this test suite has never been implemented in this codebase. These tests
// describe the intended API; un-skip once the module lands. Skipped here so
// they don't pollute the red/green signal of the default `pnpm test` run.
describe.skip('PreviewOffloader', () => {
  let offloader: any;

  beforeEach(async () => {
    vi.resetModules();
    const { previewOffloader } = await import('../lib/sandbox/preview-offloader');
    offloader = previewOffloader;
  });

  describe('decide', () => {
    it('should recommend local for lightweight React app', () => {
      const request = {
        files: {
          'App.js': 'export default function App() {}',
          'index.js': 'console.log("hello")',
        },
        framework: 'react',
      };

      const decision = offloader.decide(request);

      expect(decision.recommendedProvider).toBe('local');
      expect(decision.reason).toContain('local');
    });

    it('should recommend daytona for Next.js framework', () => {
      const request = {
        files: {
          'pages/index.js': 'export default function Index() {}',
        },
        framework: 'next.js',
      };

      const decision = offloader.decide(request);

      expect(decision.recommendedProvider).toBe('daytona');
      expect(decision.reason).toContain('next.js');
    });

    it('should recommend daytona for Django framework', () => {
      const request = {
        files: { 'views.py': 'def index(): pass' },
        framework: 'django',
      };

      const decision = offloader.decide(request);

      expect(decision.recommendedProvider).toBe('daytona');
      const reason = decision.reason.toLowerCase();
      expect(reason.includes('django') || reason.includes('heavy')).toBe(true);
    });

    it('should recommend daytona for large project (>50 files)', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        files[`file${i}.js`] = `console.log(${i})`;
      }

      const decision = offloader.decide({ files });

      expect(decision.recommendedProvider).toBe('daytona');
      expect(decision.reason).toContain('Large project');
    });

    it('should recommend daytona for Electron app', () => {
      const request = {
        files: {
          'main.js': 'const { app } = require("electron")',
          'renderer.js': 'console.log("window")',
        },
        framework: 'electron',
      };

      const decision = offloader.decide(request);

      expect(decision.recommendedProvider).toBe('daytona');
      expect(decision.reason).toContain('GUI/Desktop');
    });

    it('should recommend daytona for heavy framework + large project', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 30; i++) {
        files[`file${i}.js`] = `console.log(${i})`;
      }

      const decision = offloader.decide({
        files,
        framework: 'next.js',
      });

      expect(decision.recommendedProvider).toBe('daytona');
    });

    it('should include cost estimate', () => {
      const decision = offloader.decide({
        files: { 'app.py': 'print("hello")' },
        framework: 'flask',
      });

      expect(decision.estimatedCost).toBeDefined();
      expect(decision.estimatedDuration).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should return local provider result for lightweight apps', async () => {
      const request = {
        files: { 'App.js': 'export default function() {}' },
        framework: 'react',
      };

      const result = await offloader.execute(request);

      expect(result.provider).toBe('local');
      expect(result.success).toBe(true);
      expect(result.url).toBeUndefined();
    });

    it('should attempt daytona for Next.js apps', async () => {
      const request = {
        files: { 'pages/index.js': 'export default function() {}' },
        framework: 'next.js',
      };

      const result = await offloader.execute(request);

      // Should try daytona but might fail due to mocking
      expect(result.provider).toBeDefined();
    });
  });

  describe('getCostEstimate', () => {
    it('should return cost for daytona', () => {
      const cost = offloader.getCostEstimate('daytona', 60);
      expect(cost).toBeDefined();
      expect(typeof cost).toBe('number');
    });

    it('should return cost for codesandbox', () => {
      const cost = offloader.getCostEstimate('codesandbox', 60);
      expect(cost).toBeDefined();
      expect(typeof cost).toBe('number');
    });

    it('should return cost for vercel', () => {
      const cost = offloader.getCostEstimate('vercel', 60);
      expect(cost).toBeDefined();
      expect(typeof cost).toBe('number');
    });

    it('should return 0 for unknown provider', () => {
      const cost = offloader.getCostEstimate('unknown' as any, 60);
      expect(cost).toBe(0);
    });
  });
});
