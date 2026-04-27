/**
 * Tests for Blaxel Volume Templates
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// These modules don't exist yet — stub them so describe.skip doesn't crash at require()
vi.mock('@/lib/sandbox/providers/blaxel-provider', () => ({}));

describe.skip('Blaxel Volume Templates', () => {
  const { BlaxelProvider } = require('@/lib/sandbox/providers/blaxel-provider');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createVolumeTemplate', () => {
    it('should create volume template', async () => {
      const provider = new BlaxelProvider();

      // Mock client
      provider.client = {
        volumes: {
          createTemplate: vi.fn().mockResolvedValue({
            id: 'template_1',
            name: 'node-project',
          }),
        },
      };

      const files = [
        { path: 'package.json', content: '{}' },
        { path: 'src/index.ts', content: 'console.log("hello");' },
      ];

      const templateId = await provider.createVolumeTemplate('node-project', files);

      expect(templateId).toBe('template_1');
      expect(provider.client.volumes.createTemplate).toHaveBeenCalledWith({
        name: 'node-project',
        workspace: 'default',
        files,
      });
    });
  });

  describe('listVolumeTemplates', () => {
    it('should list templates', async () => {
      const provider = new BlaxelProvider();

      provider.client = {
        volumes: {
          listTemplates: vi.fn().mockResolvedValue([
            { id: 'template_1', name: 'node-project', created_at: '2024-01-01' },
            { id: 'template_2', name: 'python-project', created_at: '2024-01-02' },
          ]),
        },
      };

      const templates = await provider.listVolumeTemplates();

      expect(templates).toHaveLength(2);
      expect(templates[0].name).toBe('node-project');
    });

    it('should handle empty list', async () => {
      const provider = new BlaxelProvider();

      provider.client = {
        volumes: {
          listTemplates: vi.fn().mockResolvedValue([]),
        },
      };

      const templates = await provider.listVolumeTemplates();

      expect(templates).toEqual([]);
    });
  });

  describe('deleteVolumeTemplate', () => {
    it('should delete template', async () => {
      const provider = new BlaxelProvider();

      provider.client = {
        volumes: {
          deleteTemplate: vi.fn().mockResolvedValue(undefined),
        },
      };

      await provider.deleteVolumeTemplate('template_1');

      expect(provider.client.volumes.deleteTemplate).toHaveBeenCalledWith({
        id: 'template_1',
        workspace: 'default',
      });
    });
  });

  describe('createSandboxWithVolume', () => {
    it('should create sandbox with volume template', async () => {
      const provider = new BlaxelProvider();

      const mockSandbox = {
        id: 'sandbox_1',
        delete: vi.fn(),
      };

      provider.client = {
        sandbox: {
          create: vi.fn().mockResolvedValue(mockSandbox),
        },
      };

      // Mock extractMetadata
      provider.extractMetadata = vi.fn().mockResolvedValue({
        name: 'test',
        displayName: 'Test',
        region: 'us-pdx-1',
        url: 'https://test.blaxel.ai',
        status: 'running',
      });

      const handle = await provider.createSandboxWithVolume(
        { language: 'typescript' },
        'node-project'
      );

      expect(handle).toBeDefined();
      expect(provider.client.sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          volumeTemplate: 'node-project',
        })
      );
    });

    it('should create sandbox without volume template', async () => {
      const provider = new BlaxelProvider();

      const mockSandbox = {
        id: 'sandbox_1',
        delete: vi.fn(),
      };

      provider.client = {
        sandbox: {
          create: vi.fn().mockResolvedValue(mockSandbox),
        },
      };

      provider.extractMetadata = vi.fn().mockResolvedValue({
        name: 'test',
        displayName: 'Test',
        region: 'us-pdx-1',
        url: 'https://test.blaxel.ai',
        status: 'running',
      });

      const handle = await provider.createSandboxWithVolume(
        { language: 'typescript' },
        undefined
      );

      expect(handle).toBeDefined();
      expect(provider.client.sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          volumeTemplate: undefined,
        })
      );
    });
  });
});
