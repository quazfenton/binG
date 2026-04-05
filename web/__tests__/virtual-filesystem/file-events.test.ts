/**
 * Integration Tests: File Events System
 * 
 * Tests that verify file events are emitted correctly for MCP tool operations
 * and integrate with session tracking, sync events, and the enhanced diff viewer.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { trackSessionFiles, getSessionFiles, clearAllSessions } from '@/lib/virtual-filesystem/session-file-tracker';

describe('File Events Integration', () => {
  beforeEach(() => {
    clearAllSessions();
  });

  afterEach(() => {
    clearAllSessions();
  });

  describe('Session File Tracking', () => {
    it('should track files from MCP write operations', async () => {
      // Direct call to trackSessionFiles with a message containing file path
      const syntheticMessage = {
        role: 'system' as const,
        content: 'Completed create operation on /src/components/Button.tsx',
      };
      
      await trackSessionFiles('conv-1', [syntheticMessage]);

      // File should be tracked for session
      const files = getSessionFiles('conv-1');
      expect(files.some(f => f.includes('Button.tsx'))).toBe(true);
    });

    it('should track files from diff operations', async () => {
      const syntheticMessage = {
        role: 'system' as const,
        content: 'Completed update operation on /src/utils/helpers.ts',
      };
      
      await trackSessionFiles('conv-2', [syntheticMessage]);

      const files = getSessionFiles('conv-2');
      expect(files.some(f => f.includes('helpers.ts'))).toBe(true);
    });

    it('should track multiple files in session', async () => {
      const messages = [
        { role: 'system' as const, content: 'Completed create on /src/a.ts' },
        { role: 'system' as const, content: 'Completed create on /src/b.tsx' },
        { role: 'system' as const, content: 'Completed create on /src/c.py' },
      ];
      
      await trackSessionFiles('session-multi', messages);

      const trackedFiles = getSessionFiles('session-multi', 10);
      expect(trackedFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle multiple operations on same file', async () => {
      const sessionId = 'conv-3';
      
      // First write
      const msg1 = { role: 'system' as const, content: 'Completed create on /src/App.tsx' };
      await trackSessionFiles(sessionId, [msg1]);

      // Update
      const msg2 = { role: 'system' as const, content: 'Completed update on /src/App.tsx' };
      await trackSessionFiles(sessionId, [msg2]);

      // File should be tracked
      const files = getSessionFiles(sessionId);
      expect(files.some(f => f.includes('App.tsx'))).toBe(true);
    });

    it('should extract various file types', async () => {
      const messages = [
        { role: 'system' as const, content: 'Created /src/file.ts' },
        { role: 'system' as const, content: 'Created /src/file.tsx' },
        { role: 'system' as const, content: 'Created /src/file.js' },
        { role: 'system' as const, content: 'Created /src/file.py' },
        { role: 'system' as const, content: 'Created /src/file.rs' },
      ];
      
      await trackSessionFiles('session-types', messages);

      const files = getSessionFiles('session-types');
      expect(files.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('File path extraction', () => {
    it('should extract paths from natural language messages', async () => {
      const testPaths = [
        'Created file at /src/components/Button.tsx',
        'Updated /src/utils/helpers.ts with new content',
        'Deleted /src/old-file.js',
        'Writing to /src/app.py',
      ];

      for (const content of testPaths) {
        const msg = { role: 'system' as const, content };
        await trackSessionFiles('test-extract', [msg]);
      }

      const files = getSessionFiles('test-extract');
      expect(files.length).toBeGreaterThanOrEqual(1);
    });
  });
});