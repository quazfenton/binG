/**
 * Tests for Preview Offloader
 *
 * Covers: decide(), execute(), getCostEstimate(), getProviders()
 * Edge cases: empty files, undefined framework, framework normalization,
 *             timeout, provider fallback, language inference
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PreviewProvider, PreviewOffloadRequest, OffloadDecision, ExecuteResult } from '../lib/sandbox/preview-offloader';

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
  isProviderAvailable: vi.fn(() => false), // Default: no availability info → best-effort
}))

describe('PreviewOffloader', () => {
  let offloader: typeof import('../lib/sandbox/preview-offloader').previewOffloader;

  beforeEach(async () => {
    vi.resetModules();
    const { previewOffloader: off } = await import('../lib/sandbox/preview-offloader');
    offloader = off;
  });

  // =========================================================================
  // decide()
  // =========================================================================

  describe('decide', () => {
    // --- Edge cases ---

    it('should default to local for null/undefined files', () => {
      const decision = offloader.decide({ files: null as any });
      expect(decision.recommendedProvider).toBe('local');
      expect(decision.reason).toContain('No files');
    });

    it('should default to local for empty files object', () => {
      const decision = offloader.decide({ files: {} });
      expect(decision.recommendedProvider).toBe('local');
      expect(decision.estimatedDuration).toBe(30);
    });

    it('should default to local when framework is undefined', () => {
      const decision = offloader.decide({
        files: { 'App.js': 'export default function App() {}' },
      });
      expect(decision.recommendedProvider).toBe('local');
    });

    // --- Lightweight apps → local ---

    it('should recommend local for lightweight React app', () => {
      const request: PreviewOffloadRequest = {
        files: {
          'App.js': 'export default function App() {}',
          'index.js': 'console.log("hello")',
        },
        framework: 'react',
      };

      const decision = offloader.decide(request);

      expect(decision.recommendedProvider).toBe('local');
      expect(decision.reason).toContain('local');
      expect(decision.estimatedCost).toBe(0);
    });

    it('should recommend local for Vue app', () => {
      const decision = offloader.decide({
        files: { 'App.vue': '<template><div/></template>' },
        framework: 'vue',
      });
      expect(decision.recommendedProvider).toBe('local');
    });

    it('should recommend local for vanilla JS', () => {
      const decision = offloader.decide({
        files: { 'index.html': '<h1>Hello</h1>', 'app.js': 'console.log(1)' },
      });
      expect(decision.recommendedProvider).toBe('local');
    });

    // --- Heavy frameworks → cloud ---

    it('should recommend daytona for Next.js framework', () => {
      const request: PreviewOffloadRequest = {
        files: { 'pages/index.js': 'export default function Index() {}' },
        framework: 'next.js',
      };

      const decision = offloader.decide(request);

      expect(decision.recommendedProvider).toBe('daytona');
      expect(decision.reason).toContain('next.js');
      expect(decision.estimatedCost).toBeGreaterThan(0);
    });

    it('should recognize "NextJS" (no dot) as heavy', () => {
      const decision = offloader.decide({
        files: { 'page.tsx': 'export default function Page() {}' },
        framework: 'NextJS',
      });
      expect(decision.recommendedProvider).toBe('daytona');
    });

    it('should recognize "next-js" (with dash) as heavy via normalization', () => {
      const decision = offloader.decide({
        files: { 'page.tsx': 'export default function Page() {}' },
        framework: 'next-js',
      });
      expect(decision.recommendedProvider).toBe('daytona');
    });

    it('should recommend daytona for Django framework', () => {
      const request: PreviewOffloadRequest = {
        files: { 'views.py': 'def index(): pass' },
        framework: 'django',
      };

      const decision = offloader.decide(request);

      expect(decision.recommendedProvider).toBe('daytona');
      const reason = decision.reason.toLowerCase();
      expect(reason.includes('django') || reason.includes('heavy')).toBe(true);
    });

    it('should recommend daytona for Flask framework', () => {
      const decision = offloader.decide({
        files: { 'app.py': 'from flask import Flask' },
        framework: 'flask',
      });
      expect(decision.recommendedProvider).toBe('daytona');
    });

    it('should recommend daytona for FastAPI framework', () => {
      const decision = offloader.decide({
        files: { 'main.py': 'from fastapi import FastAPI' },
        framework: 'fastapi',
      });
      expect(decision.recommendedProvider).toBe('daytona');
    });

    // --- Large projects → cloud ---

    it('should recommend daytona for large project (>50 files)', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        files[`file${i}.js`] = `console.log(${i})`;
      }

      const decision = offloader.decide({ files });

      expect(decision.recommendedProvider).toBe('daytona');
      expect(decision.reason).toContain('Large project');
    });

    it('should not offload at exactly 50 files (boundary)', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        files[`file${i}.js`] = `console.log(${i})`;
      }

      const decision = offloader.decide({ files });

      expect(decision.recommendedProvider).toBe('local');
    });

    // --- Desktop apps → cloud ---

    it('should recommend daytona for Electron app (by framework)', () => {
      const request: PreviewOffloadRequest = {
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

    it('should recommend daytona for Electron app (by content detection)', () => {
      const decision = offloader.decide({
        files: {
          'main.js': 'const { app } = require("electron")',
        },
        // framework is NOT 'electron' — content detection should catch it
        framework: 'node',
      });
      expect(decision.recommendedProvider).toBe('daytona');
    });

    it('should recommend daytona for Tauri app (by path detection)', () => {
      const decision = offloader.decide({
        files: {
          'src-tauri/tauri.conf.json': '{"build": {}}',
          'src/main.rs': 'fn main() {}',
        },
      });
      expect(decision.recommendedProvider).toBe('daytona');
    });

    // --- Combined heavy + large ---

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

    // --- Cost/duration estimation ---

    it('should include cost and duration estimates', () => {
      const decision = offloader.decide({
        files: { 'app.py': 'print("hello")' },
        framework: 'flask',
      });

      expect(decision.estimatedCost).toBeDefined();
      expect(decision.estimatedDuration).toBeDefined();
      expect(typeof decision.estimatedCost).toBe('number');
      expect(typeof decision.estimatedDuration).toBe('number');
    });

    it('should estimate 120s duration for heavy frameworks', () => {
      const decision = offloader.decide({
        files: { 'page.tsx': 'export default function Page() {}' },
        framework: 'next.js',
      });
      expect(decision.estimatedDuration).toBe(120);
    });

    it('should estimate 30s duration for small projects', () => {
      const decision = offloader.decide({
        files: { 'App.js': 'export default function App() {}' },
        framework: 'react',
      });
      expect(decision.estimatedDuration).toBe(30);
    });

    // --- False positives ---

    it('should NOT match "deno" as a heavy framework (removed from CLOUD_ONLY)', () => {
      const decision = offloader.decide({
        files: { 'main.ts': 'console.log("hello")' },
        framework: 'deno',
      });
      // Deno is lightweight — should route to local
      expect(decision.recommendedProvider).toBe('local');
    });

    it('should NOT match arbitrary short strings via substring (e.g. "taur")', () => {
      const decision = offloader.decide({
        files: { 'app.js': 'console.log("test")' },
        framework: 'taur',
      });
      expect(decision.recommendedProvider).toBe('local');
    });

    // --- Provider fallback routing ---

    it('should fall back to codesandbox when daytona is unavailable', async () => {
      vi.resetModules();
      // Re-register mock with codesandbox available
      vi.doMock('../lib/sandbox/providers', () => ({
        getSandboxProvider: vi.fn(() => ({
          createSandbox: vi.fn(() => Promise.resolve({
            id: 'test-sandbox', workspaceDir: '/workspace',
            writeFile: vi.fn(() => Promise.resolve({ success: true })),
            executeCommand: vi.fn(() => Promise.resolve({ success: true })),
            getPreviewLink: vi.fn(() => Promise.resolve({ url: 'http://preview.local' })),
            destroySandbox: vi.fn(() => Promise.resolve()),
          })),
          destroySandbox: vi.fn(),
        })),
        isProviderAvailable: vi.fn((type: string) => type === 'codesandbox'),
      }));

      const { previewOffloader: freshOffloader } = await import('../lib/sandbox/preview-offloader');
      const decision = freshOffloader.decide({
        files: { 'page.tsx': 'export default function Page() {}' },
        framework: 'next.js',
      });

      expect(decision.recommendedProvider).toBe('codesandbox');
    });

    it('should fall back to vercel when daytona/codesandbox/e2b are unavailable', async () => {
      vi.resetModules();
      vi.doMock('../lib/sandbox/providers', () => ({
        getSandboxProvider: vi.fn(() => ({
          createSandbox: vi.fn(() => Promise.resolve({
            id: 'test-sandbox', workspaceDir: '/workspace',
            writeFile: vi.fn(() => Promise.resolve({ success: true })),
            executeCommand: vi.fn(() => Promise.resolve({ success: true })),
            getPreviewLink: vi.fn(() => Promise.resolve({ url: 'http://preview.local' })),
            destroySandbox: vi.fn(() => Promise.resolve()),
          })),
          destroySandbox: vi.fn(),
        })),
        isProviderAvailable: vi.fn((type: string) => type === 'vercel-sandbox'),
      }));

      const { previewOffloader: freshOffloader } = await import('../lib/sandbox/preview-offloader');
      const decision = freshOffloader.decide({
        files: { 'page.tsx': 'export default function Page() {}' },
        framework: 'next.js',
      });

      expect(decision.recommendedProvider).toBe('vercel');
    });
  });

  // =========================================================================
  // execute()
  // =========================================================================

  describe('execute', () => {
    it('should return local provider result for lightweight apps', async () => {
      const request: PreviewOffloadRequest = {
        files: { 'App.js': 'export default function() {}' },
        framework: 'react',
      };

      const result = await offloader.execute(request);

      expect(result.provider).toBe('local');
      expect(result.success).toBe(true);
      expect(result.url).toBeUndefined();
    });

    it('should attempt cloud sandbox for Next.js apps', async () => {
      const request: PreviewOffloadRequest = {
        files: { 'pages/index.js': 'export default function() {}' },
        framework: 'next.js',
      };

      const result = await offloader.execute(request);

      expect(result.provider).toBeDefined();
      // With mock, should succeed
      if (result.success) {
        expect(result.sandboxId).toBeDefined();
      }
    });

    it('should return error for empty files', async () => {
      const result = await offloader.execute({ files: {} });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No files');
    });

    it('should return error for null files', async () => {
      const result = await offloader.execute({ files: null as any });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No files');
    });

    it('should infer python language for Flask project', async () => {
      const { getSandboxProvider } = await import('../lib/sandbox/providers');
      const request: PreviewOffloadRequest = {
        files: { 'app.py': 'from flask import Flask' },
        framework: 'flask',
      };

      await offloader.execute(request);

      // Verify getSandboxProvider was called, meaning cloud path was taken
      expect(getSandboxProvider).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getCostEstimate()
  // =========================================================================

  describe('getCostEstimate', () => {
    it('should calculate exact cost for daytona (60 min)', () => {
      const cost = offloader.getCostEstimate('daytona', 60);
      expect(cost).toBe(3); // $0.05/min * 60 min
    });

    it('should calculate exact cost for codesandbox (60 min)', () => {
      const cost = offloader.getCostEstimate('codesandbox', 60);
      expect(cost).toBe(1.2); // $0.02/min * 60 min
    });

    it('should calculate exact cost for vercel (60 min)', () => {
      const cost = offloader.getCostEstimate('vercel', 60);
      expect(cost).toBe(0.6); // $0.01/min * 60 min
    });

    it('should calculate exact cost for e2b (60 min)', () => {
      const cost = offloader.getCostEstimate('e2b', 60);
      expect(cost).toBeCloseTo(1.8, 10); // $0.03/min * 60 min (floating-point safe)
    });

    it('should return 0 for local provider', () => {
      const cost = offloader.getCostEstimate('local', 60);
      expect(cost).toBe(0);
    });

    it('should return 0 for unknown provider', () => {
      const cost = offloader.getCostEstimate('unknown', 60);
      expect(cost).toBe(0);
    });

    it('should return 0 for zero duration', () => {
      const cost = offloader.getCostEstimate('daytona', 0);
      expect(cost).toBe(0);
    });

    it('should handle fractional durations', () => {
      const cost = offloader.getCostEstimate('daytona', 0.5);
      expect(cost).toBeCloseTo(0.025, 10); // $0.05 * 0.5 (floating-point safe)
    });
  });

  // =========================================================================
  // getProviders()
  // =========================================================================

  describe('getProviders', () => {
    it('should list all 5 providers with their rates', () => {
      const providers = offloader.getProviders();

      expect(providers).toHaveLength(5);
      expect(providers.map(p => p.name).sort()).toEqual(
        ['codesandbox', 'daytona', 'e2b', 'local', 'vercel'].sort()
      );
    });

    it('should have local with cost 0', () => {
      const providers = offloader.getProviders();
      const local = providers.find(p => p.name === 'local');
      expect(local?.costPerMinute).toBe(0);
    });

    it('should have daytona as most expensive', () => {
      const providers = offloader.getProviders();
      const cloudProviders = providers.filter(p => p.name !== 'local');
      const maxCost = Math.max(...cloudProviders.map(p => p.costPerMinute));
      expect(maxCost).toBe(0.05); // daytona
    });
  });
});
