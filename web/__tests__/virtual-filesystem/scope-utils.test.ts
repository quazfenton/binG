import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @bing/platform/env BEFORE importing the module under test
vi.mock('@bing/platform/env', () => ({
  isDesktopMode: vi.fn(() => false), // default to web mode
}));

// Import the functions after mocking
import { getVfsScopeBasePath, getVfsScopePath } from '../../../lib/virtual-filesystem/scope-utils';
import { isDesktopMode } from '@bing/platform/env';

describe('scope-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default web mode
    vi.mocked(isDesktopMode).mockReturnValue(false);
  });

  describe('getVfsScopeBasePath', () => {
    it('should return project in desktop mode regardless of sessionId', () => {
      vi.mocked(isDesktopMode).mockReturnValue(true);

      expect(getVfsScopeBasePath()).toBe('project');
      expect(getVfsScopeBasePath('001')).toBe('project');
      expect(getVfsScopeBasePath('userId$session123')).toBe('project');
      expect(getVfsScopeBasePath('abc123')).toBe('project');
    });

    it('should return project/sessions/{sessionId} in web mode with sessionId', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      expect(getVfsScopeBasePath('001')).toBe('project/sessions/001');
      expect(getVfsScopeBasePath('userId$session123')).toBe('project/sessions/session123');
      expect(getVfsScopeBasePath('abc123')).toBe('project/sessions/abc123');
    });

    it('should return project/sessions/000 as fallback in web mode without sessionId', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      expect(getVfsScopeBasePath()).toBe('project/sessions/000');
    });

    it('should normalize composite sessionId (userId$sessionId format) correctly', () => {
      // Already set to false in beforeEach

      expect(getVfsScopeBasePath('user123$session456')).toBe('project/sessions/session456');
      expect(getVfsScopeBasePath('abc$xyz')).toBe('project/sessions/xyz');
    });

    it('should return project/sessions/000 for empty string sessionId (falsy)', () => {
      // Empty string is falsy, so it should use the default fallback
      expect(getVfsScopeBasePath('')).toBe('project/sessions/000');
    });
  });

  describe('getVfsScopePath', () => {
    it('should return explicit scopePath if it starts with project/sessions/', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      const result = getVfsScopePath({
        sessionId: '001',
        scopePath: 'project/sessions/002',
      });
      expect(result).toBe('project/sessions/002');
    });

    it('should preserve project when scopePath is explicitly project', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      const result = getVfsScopePath({
        sessionId: '001',
        scopePath: 'project',
      });
      expect(result).toBe('project');
    });

    it('should derive from sessionId when scopePath is not provided', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      const result = getVfsScopePath({ sessionId: '001' });
      expect(result).toBe('project/sessions/001');
    });

    it('should derive from sessionId when scopePath is undefined', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      const result = getVfsScopePath({ sessionId: 'abc', scopePath: undefined });
      expect(result).toBe('project/sessions/abc');
    });

    it('should use desktop mode project root when scopePath is not provided and in desktop mode', () => {
      vi.mocked(isDesktopMode).mockReturnValue(true);

      const result = getVfsScopePath({ sessionId: '001' });
      expect(result).toBe('project');
    });

    it('should use web mode session path when scopePath is not provided and in web mode', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      const result = getVfsScopePath({ sessionId: 'xyz' });
      expect(result).toBe('project/sessions/xyz');
    });

    it('should return project/sessions/000 when no sessionId and no scopePath in web mode', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      const result = getVfsScopePath({});
      expect(result).toBe('project/sessions/000');
    });

    it('should handle composite sessionId correctly when deriving path', () => {
      vi.mocked(isDesktopMode).mockReturnValue(false);

      const result = getVfsScopePath({ sessionId: 'user$session123' });
      expect(result).toBe('project/sessions/session123');
    });

    it('should prefer explicit scopePath over derived path even in desktop mode', () => {
      vi.mocked(isDesktopMode).mockReturnValue(true);

      // When scopePath starts with project/sessions/, it should be used directly
      const result = getVfsScopePath({
        sessionId: '001',
        scopePath: 'project/sessions/002',
      });
      expect(result).toBe('project/sessions/002');
    });

    it('should derive from sessionId when scopePath is empty string (falsy)', () => {
      // Empty string is falsy, so it should derive from sessionId
      const result = getVfsScopePath({ sessionId: '001', scopePath: '' });
      expect(result).toBe('project/sessions/001');
    });

    it('should derive from sessionId when scopePath starts with project/ but not project/sessions/', () => {
      // scopePath like 'project/other' should fall through to getVfsScopeBasePath
      const result = getVfsScopePath({ sessionId: '001', scopePath: 'project/other' });
      expect(result).toBe('project/sessions/001');
    });

    it('should derive from sessionId when scopePath is arbitrary string', () => {
      // Any scopePath that doesn't match session-scoped pattern falls through
      const result = getVfsScopePath({ sessionId: 'xyz', scopePath: 'some/path' });
      expect(result).toBe('project/sessions/xyz');
    });
  });
});