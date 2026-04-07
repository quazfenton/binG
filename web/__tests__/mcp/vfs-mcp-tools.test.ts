/**
 * Tests for VFS MCP Tools
 *
 * Tests path validation, context handling, and error returns.
 * VFS operations are mocked since they require the full service.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toolContextStore, getVFSToolDefinitions, getVFSTool, vfsTools } from '../../lib/mcp/vfs-mcp-tools';

describe('VFS MCP Tools', () => {
  beforeEach(() => {
    // Reset context before each test
    toolContextStore.exit();
  });

  afterEach(() => {
    toolContextStore.exit();
  });

  describe('toolContextStore', () => {
    it('should return fallback when no context is set', () => {
      const ctx = toolContextStore.getStore();
      expect(ctx).toBeUndefined();
    });

    it('should return context after setToolContext', () => {
      const { setToolContext } = require('./vfs-mcp-tools');
      setToolContext({ userId: 'test-user', sessionId: 'test-session', scopePath: 'project/sessions/001' });
      const ctx = toolContextStore.getStore();
      expect(ctx).toBeDefined();
      expect(ctx?.userId).toBe('test-user');
      expect(ctx?.scopePath).toBe('project/sessions/001');
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
      expect(names).toContain('create_directory');
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
  });

  describe('getVFSTool', () => {
    it('should return tool by name', () => {
      const writeTool = getVFSTool('write_file');
      expect(writeTool).toBeDefined();
      expect(writeTool?.description).toContain('Create a new file');
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
      expect(vfsTools.create_directory).toBeDefined();
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
      const { writeFileTool } = require('./vfs-mcp-tools');

      // Set context via toolContextStore.run
      const result = await toolContextStore.run(
        { userId: 'test-user', sessionId: 'test-session', scopePath: 'project' },
        async () => {
          return writeFileTool.execute({ path: 'test.txt', content: undefined }, {});
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Content is required');
    });

    it('should return error when content is null', async () => {
      const { writeFileTool } = require('./vfs-mcp-tools');

      const result = await toolContextStore.run(
        { userId: 'test-user', sessionId: 'test-session', scopePath: 'project' },
        async () => {
          return writeFileTool.execute({ path: 'test.txt', content: null }, {});
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Content is required');
    });
  });

  describe('batch_write tool execute', () => {
    it('should return error when files array is empty', async () => {
      const { batchWriteTool } = require('./vfs-mcp-tools');

      const result = await toolContextStore.run(
        { userId: 'test-user', sessionId: 'test-session', scopePath: 'project' },
        async () => {
          return batchWriteTool.execute({ files: [] }, {});
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No files provided');
    });

    it('should return error when files is undefined', async () => {
      const { batchWriteTool } = require('./vfs-mcp-tools');

      const result = await toolContextStore.run(
        { userId: 'test-user', sessionId: 'test-session', scopePath: 'project' },
        async () => {
          return batchWriteTool.execute({ files: undefined }, {});
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No files provided');
    });
  });
});
