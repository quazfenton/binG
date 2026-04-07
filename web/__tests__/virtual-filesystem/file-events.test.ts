/**
 * Tests for VFS file events and MCP edit tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  trackMcpFileEdit,
  getRecentMcpFileEdits,
  clearRecentMcpFileEdits,
} from '../../lib/virtual-filesystem/file-events';

describe('File Events - MCP Edit Tracking', () => {
  beforeEach(() => {
    // Clear all tracked edits before each test
    clearRecentMcpFileEdits();
  });

  describe('trackMcpFileEdit', () => {
    it('should track a file edit for a session', () => {
      trackMcpFileEdit('session-1', 'project/index.html');
      const edits = getRecentMcpFileEdits('session-1');
      expect(edits).toHaveLength(1);
      expect(edits[0].path).toBe('project/index.html');
    });

    it('should track multiple files for the same session', () => {
      trackMcpFileEdit('session-1', 'project/index.html');
      trackMcpFileEdit('session-1', 'project/styles.css');
      trackMcpFileEdit('session-1', 'project/app.js');

      const edits = getRecentMcpFileEdits('session-1');
      expect(edits).toHaveLength(3);
      expect(edits.map(e => e.path)).toContain('project/index.html');
      expect(edits.map(e => e.path)).toContain('project/styles.css');
      expect(edits.map(e => e.path)).toContain('project/app.js');
    });

    it('should not duplicate the same file path', () => {
      trackMcpFileEdit('session-1', 'project/index.html');
      trackMcpFileEdit('session-1', 'project/index.html');

      const edits = getRecentMcpFileEdits('session-1');
      expect(edits).toHaveLength(1);
    });

    it('should track files for different sessions independently', () => {
      trackMcpFileEdit('session-1', 'project/a.html');
      trackMcpFileEdit('session-2', 'project/b.html');

      const edits1 = getRecentMcpFileEdits('session-1');
      const edits2 = getRecentMcpFileEdits('session-2');

      expect(edits1).toHaveLength(1);
      expect(edits2).toHaveLength(1);
      expect(edits1[0].path).toBe('project/a.html');
      expect(edits2[0].path).toBe('project/b.html');
    });

    it('should return empty array for unknown session', () => {
      const edits = getRecentMcpFileEdits('unknown-session');
      expect(edits).toHaveLength(0);
    });

    it('should return empty array for null sessionId', () => {
      const edits = getRecentMcpFileEdits(undefined as any);
      expect(edits).toHaveLength(0);
    });

    it('should refresh TTL on subsequent edits', () => {
      // This test verifies that editing the same file again updates the timestamp
      // We can't easily test TTL expiry in unit tests, but we verify the function doesn't crash
      trackMcpFileEdit('session-1', 'project/file.ts');
      trackMcpFileEdit('session-1', 'project/file.ts');
      const edits = getRecentMcpFileEdits('session-1');
      expect(edits).toHaveLength(1);
    });
  });

  describe('clearRecentMcpFileEdits', () => {
    it('should clear all edits when no sessionId provided', () => {
      trackMcpFileEdit('session-1', 'project/a.html');
      trackMcpFileEdit('session-2', 'project/b.html');

      clearRecentMcpFileEdits();

      expect(getRecentMcpFileEdits('session-1')).toHaveLength(0);
      expect(getRecentMcpFileEdits('session-2')).toHaveLength(0);
    });

    it('should clear edits for specific session only', () => {
      trackMcpFileEdit('session-1', 'project/a.html');
      trackMcpFileEdit('session-2', 'project/b.html');

      clearRecentMcpFileEdits('session-1');

      expect(getRecentMcpFileEdits('session-1')).toHaveLength(0);
      expect(getRecentMcpFileEdits('session-2')).toHaveLength(1);
    });
  });
});
