/**
 * Integration Tests for Core binG Functionality
 *
 * Tests the integration between major components:
 * - Orchestration modes
 * - Preview offloading
 * - CLI commands
 * - Security utilities
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getOrchestrationModeFromRequest } from '../../agent/modula';
import { LivePreviewOffloading } from '../../previews/live-preview-offloading';
import { validatePreviewInfo } from '../../sandbox/types';
import {
  sanitizePath,
  maskSecrets,
  isDangerousCommand
} from '../../utils/security';
import { validateConfig, apiConfigSchema } from '../../utils/config-validation';
import { handleError } from '../../utils/error-handling';

describe('Core Integration Tests', () => {
  describe('Orchestration Mode Selection', () => {
    it('should select unified-agent for invalid modes', () => {
      const mockReq = {
        headers: { get: vi.fn().mockReturnValue('invalid-mode') }
      };

      const mode = getOrchestrationModeFromRequest(mockReq as any);
      expect(mode).toBe('unified-agent');
    });

    it('should select correct mode from header', () => {
      const mockReq = {
        headers: { get: vi.fn().mockReturnValue('mastra:code-agent') }
      };

      const mode = getOrchestrationModeFromRequest(mockReq as any);
      expect(mode).toBe('mastra:code-agent');
    });
  });

  describe('Preview Offloading Integration', () => {
    let offloading: LivePreviewOffloading;

    beforeAll(() => {
      offloading = new LivePreviewOffloading();
    });

    it('should detect preview mode for React project', () => {
      const detection = {
        framework: 'react' as const,
        hasBackend: false,
        hasNodeServer: false,
        hasPython: false,
        normalizedFiles: {
          'package.json': '{"dependencies":{"react":"^18.0.0"}}',
          'src/App.js': 'import React from "react"; function App() { return <div>Hello</div>; }'
        }
      };

      const mode = offloading.detectPreviewMode(
        ['package.json', 'src/App.js'],
        'react',
        'vite',
        {
          hasPython: false,
          hasNodeServer: false,
          hasNextJS: false,
          hasHeavyComputation: false,
          hasAPIKeys: false
        },
        { dependencies: { react: '^18.0.0' } }
      );

      expect(['sandpack', 'webcontainer']).toContain(mode);
    });

    it('should route backend projects to cloud', () => {
      const detection = {
        framework: 'node' as const,
        hasBackend: true,
        hasNodeServer: true,
        hasPython: false,
        normalizedFiles: {
          'server.js': 'const express = require("express");',
          'package.json': '{"scripts":{"start":"node server.js"}}'
        }
      };

      const mode = offloading.detectPreviewMode(
        ['server.js', 'package.json'],
        'node',
        'webpack',
        {
          hasPython: false,
          hasNodeServer: true,
          hasNextJS: false,
          hasHeavyComputation: false,
          hasAPIKeys: false
        },
        { scripts: { start: 'node server.js' } }
      );

      expect(['devbox', 'modal', 'codesandbox']).toContain(mode);
    });
  });

  describe('Preview Info Validation', () => {
    it('should validate correct preview info', () => {
      const info = {
        port: 3000,
        url: 'https://example.com',
        authHeaders: { 'Authorization': 'Bearer token' },
        openedAt: Date.now(),
        status: 'ready' as const
      };

      expect(validatePreviewInfo(info)).toBe(true);
    });

    it('should reject invalid preview info', () => {
      const invalidInfo = {
        port: -1,
        url: 'not-a-url',
        status: 'error' as const
      };

      expect(validatePreviewInfo(invalidInfo)).toBe(false);
    });
  });

  describe('Security Integration', () => {
    it('should sanitize safe paths', () => {
      const safePath = sanitizePath('src/components/Button.tsx');
      expect(safePath).toBeTruthy();
    });

    it('should block dangerous paths', () => {
      const dangerousPath = sanitizePath('../../../etc/passwd');
      expect(dangerousPath).toBeNull();
    });

    it('should mask secrets in strings', () => {
      const withSecrets = 'API_KEY=sk-abc123 SECRET_TOKEN=xyz789';
      const masked = maskSecrets(withSecrets);
      expect(masked).toContain('[REDACTED]');
      expect(masked).not.toContain('sk-abc123');
    });

    it('should detect dangerous commands', () => {
      expect(isDangerousCommand('rm -rf /')).toBe(true);
      expect(isDangerousCommand('ls -la')).toBe(false);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate correct API config', () => {
      const config = {
        baseUrl: 'https://api.example.com',
        timeout: 5000
      };

      const result = validateConfig(config, apiConfigSchema);
      expect(result.success).toBe(true);
    });

    it('should reject invalid config', () => {
      const config = {
        baseUrl: 'not-a-url',
        timeout: -1
      };

      const result = validateConfig(config, apiConfigSchema);
      expect(result.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle BinGError types', () => {
      const error = new (class extends Error {
        constructor() {
          super('Test error');
          this.name = 'BinGError';
        }
        code = 'TEST_ERROR';
        statusCode = 400;
      })();

      const result = handleError(error, 'test');
      expect(result.statusCode).toBe(400);
      expect(result.userMessage).toBe('Test error');
    });

    it('should provide user-friendly messages for system errors', () => {
      const error = new Error('ENOTFOUND');
      const result = handleError(error);

      expect(result.statusCode).toBe(503);
      expect(result.userMessage).toContain('temporarily unavailable');
    });
  });
});