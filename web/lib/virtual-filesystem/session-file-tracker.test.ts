/**
 * Tests for SessionFileTracker — Bug #27 + #33 (audit)
 *
 * Bug #27 (audit): Session file count creep — 0 → 42 files in 17 min
 * with no real eviction. The fix: ephemeral-first, LRU eviction +
 * tighter file-count cap + log on every eviction.
 *
 * Bug #33 (audit): `totalFiles: 42` had no linkage to disk/memory
 * usage. The fix: per-file `byteSize` and per-session `totalBytes`
 * with a 5 MB soft cap.
 *
 * NOTE: the FILE_PATTERN regex only matches a fixed list of code
 * extensions (ts, tsx, js, json, py, rs, go, etc.). Tests use
 * extensions from that list — see CONFIG in session-file-tracker.ts.
 * For ephemeral paths, we use `/tmp/`, `.cache/`, and `/node_modules/`
 * (all in EPHEMERAL_PATH_REGEX) combined with `.json`/`.js`/`.ts`
 * extensions (in FILE_PATTERN).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  trackSessionFiles,
  getSessionFiles,
  getSessionFileDetails,
  clearAllSessions,
  getSessionStats,
} from './session-file-tracker';

describe('SessionFileTracker — Bug #27 + #33 (file count + byte tracking)', () => {
  const sessionA = 'session-a-' + Date.now();

  beforeEach(() => {
    clearAllSessions();
  });

  afterEach(() => {
    clearAllSessions();
  });

  describe('byte tracking (Bug #33)', () => {
    it('initializes totalBytes to 0 for a new session', () => {
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see src/app.tsx' },
      ]);
      const stats = getSessionStats();
      expect(stats.totalFilesTracked).toBe(1);
      expect(stats.totalBytesTracked).toBeGreaterThan(0);
    });

    it('increments totalBytes when a new file is added', () => {
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'open src/app.tsx' },
      ]);
      const before = getSessionStats().totalBytesTracked;
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'open src/app.tsx' },
        { role: 'assistant', content: 'also see lib/foo.ts' },
      ]);
      const after = getSessionStats().totalBytesTracked;
      // Second message added a new file, so total bytes should grow.
      expect(after).toBeGreaterThan(before);
    });

    it('does not increment totalBytes for an already-tracked file', () => {
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see src/app.tsx' },
      ]);
      const before = getSessionStats().totalBytesTracked;
      // Re-mention the same file.
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see src/app.tsx' },
        { role: 'assistant', content: 'right, src/app.tsx' },
      ]);
      const after = getSessionStats().totalBytesTracked;
      expect(after).toBe(before);
    });

    it('exposes totalBytes + ephemeral split in getSessionStats', () => {
      // Use .json (in FILE_PATTERN) inside /tmp/ (in EPHEMERAL_PATH_REGEX).
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see src/app.tsx and /tmp/cache.json' },
      ]);
      const stats = getSessionStats();
      // /tmp/cache.json is ephemeral; src/app.tsx is persistent.
      expect(stats.ephemeralFiles).toBe(1);
      expect(stats.persistentFiles).toBe(1);
      expect(stats.ephemeralBytes).toBeGreaterThan(0);
      expect(stats.persistentBytes).toBeGreaterThan(0);
      expect(stats.totalFilesTracked).toBe(2);
    });
  });

  describe('ephemeral flag (Bug #27)', () => {
    it('marks /tmp/ paths as ephemeral', () => {
      // .json is in FILE_PATTERN; /tmp/ is in EPHEMERAL_PATH_REGEX.
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see /tmp/build.json' },
      ]);
      const details = getSessionFileDetails(sessionA);
      const tmpRef = details.find(d => d.path.includes('/tmp/'));
      expect(tmpRef).toBeDefined();
      expect(tmpRef!.ephemeral).toBe(true);
    });

    it('marks .cache/ paths as ephemeral', () => {
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see .cache/data.json' },
      ]);
      const stats = getSessionStats();
      expect(stats.ephemeralFiles).toBe(1);
      expect(stats.persistentFiles).toBe(0);
    });

    it('marks /node_modules/ paths as ephemeral', () => {
      // .js is in FILE_PATTERN; /node_modules/ is in EPHEMERAL_PATH_REGEX.
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see node_modules/lodash/index.js' },
      ]);
      const stats = getSessionStats();
      expect(stats.ephemeralFiles).toBe(1);
    });

    it('keeps src/* paths as persistent', () => {
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see src/app.tsx' },
      ]);
      const stats = getSessionStats();
      expect(stats.persistentFiles).toBe(1);
      expect(stats.ephemeralFiles).toBe(0);
    });
  });

  describe('eviction policy (Bug #27)', () => {
    it('evicts ephemeral files before persistent when at capacity', () => {
      // Setup: 24 persistent files + 1 ephemeral = 25 total (at cap).
      const fileList: string[] = [];
      for (let i = 0; i < 24; i++) {
        fileList.push(`src/file${i}.ts`);
      }
      fileList.push('/tmp/old-ephemeral.json');

      trackSessionFiles(sessionA, [
        { role: 'user', content: fileList.join(' ') },
      ]);

      // At cap. Add a NEW ephemeral file (must be a path not already tracked).
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'src/file0.ts /tmp/old-ephemeral.json /tmp/new-ephemeral2.json' },
      ]);

      const details = getSessionFileDetails(sessionA);
      const paths = new Set(details.map(d => d.path));
      // The new ephemeral is in.
      expect(paths.has('/tmp/new-ephemeral2.json')).toBe(true);
      // The old ephemeral is evicted (ephemeral-first rule).
      expect(paths.has('/tmp/old-ephemeral.json')).toBe(false);
      // All 24 persistent files survive.
      for (let i = 0; i < 24; i++) {
        expect(paths.has(`src/file${i}.ts`)).toBe(true);
      }
    });

    it('enforces the file-count cap when over the limit', () => {
      // 30 files (above the cap of 25). The final state must respect
      // the cap regardless of which specific files are evicted.
      const fileList: string[] = [];
      for (let i = 0; i < 30; i++) {
        fileList.push(`src/file${i}.ts`);
      }
      trackSessionFiles(sessionA, [
        { role: 'user', content: fileList.join(' ') },
      ]);

      const details = getSessionFileDetails(sessionA);
      // Cap is 25. After 30 inserts, the count must be <= 25.
      expect(details.length).toBeLessThanOrEqual(25);
    });

    it('preserves at least the most-recently-mentioned files when evicting', () => {
      // Add 25 files in call 1, then add 1 new file in call 2.
      // The new file must be present after eviction.
      const fileList: string[] = [];
      for (let i = 0; i < 25; i++) {
        fileList.push(`src/file${i}.ts`);
      }
      trackSessionFiles(sessionA, [
        { role: 'user', content: fileList.join(' ') },
      ]);
      trackSessionFiles(sessionA, [
        { role: 'user', content: fileList.join(' ') + ' src/file-newest.ts' },
      ]);

      const paths = new Set(getSessionFileDetails(sessionA).map(d => d.path));
      // The newest file must be present.
      expect(paths.has('src/file-newest.ts')).toBe(true);
      // At least one of the original 25 must have been evicted to make room.
      expect(paths.size).toBeLessThanOrEqual(25);
    });
  });

  describe('byte cap enforcement (Bug #33)', () => {
    it('enforces the byte cap when total bytes would exceed it', () => {
      // Use .ts (in FILE_PATTERN) with long paths. Each path's byteSize
      // is path.length. We add 5 × 1 MB paths = 5 MB (at the cap of 5 MB),
      // then a 6th 1 MB path. The final total must be <= 5 MB.
      const oneMB = (label: string) => `${label}${'x'.repeat(1024 * 1024 - label.length - 3)}.ts`;
      const hugeA = oneMB('a');
      const hugeB = oneMB('b');
      const hugeC = oneMB('c');
      const hugeD = oneMB('d');
      const hugeE = oneMB('e');
      const hugeF = oneMB('f');

      // Track 5 huge files (5 MB total, exactly at the cap).
      trackSessionFiles(sessionA, [
        { role: 'user', content: `${hugeA} ${hugeB} ${hugeC} ${hugeD} ${hugeE}` },
      ]);
      // Add a 6th — should evict at least one to make room.
      trackSessionFiles(sessionA, [
        { role: 'user', content: `${hugeA} ${hugeB} ${hugeC} ${hugeD} ${hugeE} ${hugeF}` },
      ]);

      const stats = getSessionStats();
      // totalBytes should be at or under 5 MB.
      expect(stats.totalBytesTracked).toBeLessThanOrEqual(5 * 1024 * 1024);
      // And the new file is present (proves the eviction path completed
      // rather than silently dropping the insert).
      const details = getSessionFileDetails(sessionA);
      expect(details.find(d => d.path === hugeF)).toBeDefined();
    });
  });

  describe('getSessionFileDetails shape', () => {
    it('exposes byteSize and ephemeral on every detail entry', () => {
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see src/app.tsx and /tmp/cache.json' },
      ]);
      const details = getSessionFileDetails(sessionA);
      expect(details.length).toBe(2);
      for (const d of details) {
        expect(typeof d.byteSize).toBe('number');
        expect(typeof d.ephemeral).toBe('boolean');
        expect(typeof d.path).toBe('string');
        expect(typeof d.mentionCount).toBe('number');
        expect(typeof d.lastSeen).toBe('number');
      }
    });
  });

  describe('getSessionStats shape', () => {
    it('returns activeSessions, totalFilesTracked, totalBytesTracked, ephemeral*, persistent*', () => {
      const stats = getSessionStats();
      expect(stats).toHaveProperty('activeSessions');
      expect(stats).toHaveProperty('totalFilesTracked');
      expect(stats).toHaveProperty('totalBytesTracked');
      expect(stats).toHaveProperty('ephemeralFiles');
      expect(stats).toHaveProperty('ephemeralBytes');
      expect(stats).toHaveProperty('persistentFiles');
      expect(stats).toHaveProperty('persistentBytes');
    });

    it('handles empty sessionStore gracefully', () => {
      clearAllSessions();
      const stats = getSessionStats();
      expect(stats.activeSessions).toBe(0);
      expect(stats.totalFilesTracked).toBe(0);
      expect(stats.totalBytesTracked).toBe(0);
    });
  });

  describe('regression: getSessionFiles basic functionality', () => {
    it('returns tracked file paths for a session', () => {
      trackSessionFiles(sessionA, [
        { role: 'user', content: 'see src/app.tsx' },
      ]);
      const files = getSessionFiles(sessionA, 10);
      expect(files).toContain('src/app.tsx');
    });
  });
});
