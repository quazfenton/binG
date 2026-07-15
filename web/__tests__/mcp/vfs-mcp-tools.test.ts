/**
 * Tests for VFS MCP Tools
 *
 * Tests path validation, context handling, and error returns.
 * VFS operations are mocked since they require the full service.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toolContextStore, getVFSToolDefinitions, getVFSTool, vfsTools, setToolContext, writeFileTool, batchWriteTool } from '../../lib/mcp/vfs-mcp-tools';

describe('VFS MCP Tools', () => {
  beforeEach(() => {
    toolContextStore.disable();
  });

  afterEach(() => {
    toolContextStore.disable();
  });

  describe('toolContextStore', () => {
    it('should return fallback when no context is set', () => {
      const ctx = toolContextStore.getStore();
      expect(ctx).toBeUndefined();
    });

    it('should return context after setToolContext', () => {
      setToolContext({ userId: 'test-user', sessionId: 'test-session', scopePath: 'workspace/sessions/001' });
      const ctx = toolContextStore.getStore();
      expect(ctx).toBeDefined();
      expect(ctx?.userId).toBe('test-user');
      expect(ctx?.scopePath).toBe('workspace/sessions/001');
    });
  });

  describe('getVFSToolDefinitions', () => {
    it('should return definitions for all tools', () => {
      const defs = getVFSToolDefinitions();
      const names = defs.map(d => d.function.name);

      expect(names).toContain('write_file');
      expect(names).toContain('apply_diff');
      expect(names).toContain('read_file');
      expect(names).toContain('list_files');
      expect(names).toContain('search_files');
      expect(names).toContain('batch_write');
      expect(names).toContain('delete_file');
      expect(names).toContain('get_workspace_stats');
    });

    it('should have unique tool names', () => {
      const defs = getVFSToolDefinitions();
      const names = defs.map(d => d.function.name);
      const unique = new Set(names);
      expect(names.length).toBe(unique.size);
    });

    it('should have descriptions for all tools', () => {
      const defs = getVFSToolDefinitions();
      for (const def of defs) {
        expect(def.function.description).toBeTruthy();
        expect(def.function.description.length).toBeGreaterThan(10);
      }
    });

    // NOTE: JSON Schema validation tests (Zod internals, serialization)
    // are centralized in vfs-json-schema-validation.test.ts to avoid
    // duplicate coverage that drifts over time. The tests here focus on
    // the VFS tool behaviors (name, count, descriptions, uniqueness).
  });

  describe('getVFSTool', () => {
    it('should return tool by name', () => {
      const writeTool = getVFSTool('write_file');
      expect(writeTool).toBeDefined();
      expect(writeTool?.description).toContain('Create or overwrite a file');
    });

    it('should return undefined for unknown tool', () => {
      const unknown = getVFSTool('nonexistent_tool');
      expect(unknown).toBeUndefined();
    });
  });

  describe('vfsTools object', () => {
    it('should have all expected tools', () => {
      expect(vfsTools.write_file).toBeDefined();
      expect(vfsTools.apply_diff).toBeDefined();
      expect(vfsTools.read_file).toBeDefined();
      expect(vfsTools.list_files).toBeDefined();
      expect(vfsTools.search_files).toBeDefined();
      expect(vfsTools.batch_write).toBeDefined();
      expect(vfsTools.delete_file).toBeDefined();
      expect(vfsTools.get_workspace_stats).toBeDefined();
    });

    it('should have description on each tool', () => {
      for (const [name, toolDef] of Object.entries(vfsTools)) {
        expect((toolDef as any).description).toBeTruthy();
      }
    });
  });

  describe('write_file tool execute', () => {
    it('should return error when content is undefined', async () => {
      // Set context via toolContextStore.run
      const result = await toolContextStore.run(
        { userId: 'test-user', sessionId: 'test-session', scopePath: 'workspace' },
        async () => {
          return writeFileTool.execute({ path: 'test.txt', content: undefined }, {});
        }
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('INVALID_CONTENT');
      expect(result.error.message).toBe('Content is required.');
    });

    it('should return error when content is null', async () => {
      const result = await toolContextStore.run(
        { userId: 'test-user', sessionId: 'test-session', scopePath: 'workspace' },
        async () => {
          return writeFileTool.execute({ path: 'test.txt', content: null }, {});
        }
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('INVALID_CONTENT');
      expect(result.error.message).toBe('Content is required.');
    });
  });

  describe('batch_write tool execute', () => {
    it('should return error when files array is empty', async () => {
      const result = await toolContextStore.run(
        { userId: 'test-user', sessionId: 'test-session', scopePath: 'workspace' },
        async () => {
          return batchWriteTool.execute({ files: [] }, {});
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No files provided');
    });

    it('should return error when files is undefined', async () => {
      const result = await toolContextStore.run(
        { userId: 'test-user', sessionId: 'test-session', scopePath: 'workspace' },
        async () => {
          return batchWriteTool.execute({ files: undefined }, {});
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse files argument');
    });
  });
});
