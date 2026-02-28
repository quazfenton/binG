import { describe, it, expect, beforeEach } from 'vitest'
import { FilesystemDiffTracker } from '@/lib/virtual-filesystem/filesystem-diffs'
import type { VirtualFile } from '@/lib/virtual-filesystem/filesystem-types'

function makeFile(overrides: Partial<VirtualFile> = {}): VirtualFile {
  return {
    path: '/src/index.ts',
    content: 'console.log("hello")',
    language: 'typescript',
    lastModified: '2026-01-01T00:00:00.000Z',
    version: 1,
    size: 20,
    ...overrides,
  }
}

describe('FilesystemDiffTracker', () => {
  let tracker: FilesystemDiffTracker

  beforeEach(() => {
    tracker = new FilesystemDiffTracker()
  })

  describe('trackChange', () => {
    it('should detect file creation when no previous content exists', () => {
      const file = makeFile()
      const diff = tracker.trackChange(file)

      expect(diff.changeType).toBe('create')
      expect(diff.oldContent).toBe('')
      expect(diff.newContent).toBe('console.log("hello")')
      expect(diff.path).toBe('/src/index.ts')
    })

    it('should detect file update when previous content exists', () => {
      const file1 = makeFile({ content: 'line1', version: 1 })
      tracker.trackChange(file1)

      const file2 = makeFile({ content: 'line2', version: 2 })
      const diff = tracker.trackChange(file2)

      expect(diff.changeType).toBe('update')
      expect(diff.oldContent).toBe('line1')
      expect(diff.newContent).toBe('line2')
    })

    it('should set correct version and timestamp from the file', () => {
      const file = makeFile({ version: 5, lastModified: '2026-02-15T12:00:00.000Z' })
      const diff = tracker.trackChange(file)

      expect(diff.version).toBe(5)
      expect(diff.timestamp).toBe('2026-02-15T12:00:00.000Z')
    })

    it('should remember previous content for the next comparison', () => {
      const v1 = makeFile({ content: 'v1', version: 1 })
      const v2 = makeFile({ content: 'v2', version: 2 })
      const v3 = makeFile({ content: 'v3', version: 3 })

      tracker.trackChange(v1)
      tracker.trackChange(v2)
      const diff = tracker.trackChange(v3)

      expect(diff.oldContent).toBe('v2')
      expect(diff.newContent).toBe('v3')
    })

    it('should treat explicit previousContent parameter as update', () => {
      const file = makeFile({ content: 'new stuff', version: 1 })
      const diff = tracker.trackChange(file, 'old stuff')

      expect(diff.changeType).toBe('update')
      expect(diff.oldContent).toBe('old stuff')
      expect(diff.newContent).toBe('new stuff')
    })
  })

  describe('trackDeletion', () => {
    it('should create a diff with changeType delete', () => {
      const diff = tracker.trackDeletion('/src/index.ts', 'file content')

      expect(diff.changeType).toBe('delete')
      expect(diff.path).toBe('/src/index.ts')
    })

    it('should set oldContent to previous content and newContent to empty', () => {
      const diff = tracker.trackDeletion('/src/index.ts', 'const x = 1;')

      expect(diff.oldContent).toBe('const x = 1;')
      expect(diff.newContent).toBe('')
    })

    it('should increment version from existing history', () => {
      const file = makeFile({ version: 3 })
      tracker.trackChange(file)

      const diff = tracker.trackDeletion('/src/index.ts', file.content)
      expect(diff.version).toBe(4)
    })

    it('should use version 1 when no prior history exists', () => {
      const diff = tracker.trackDeletion('/src/gone.ts', 'bye')
      expect(diff.version).toBe(1)
    })
  })

  describe('computeHunks (via trackChange)', () => {
    it('should detect changed lines with -/+ prefix', () => {
      const file1 = makeFile({ content: 'line1\nline2\nline3', version: 1 })
      tracker.trackChange(file1)

      const file2 = makeFile({ content: 'line1\nchanged\nline3', version: 2 })
      const diff = tracker.trackChange(file2)

      expect(diff.hunks).toBeDefined()
      const allLines = diff.hunks!.flatMap((h) => h.lines)
      expect(allLines).toContain('-line2')
      expect(allLines).toContain('+changed')
    })

    it('should include context lines with space prefix', () => {
      const file1 = makeFile({ content: 'a\nb\nc\nd\ne', version: 1 })
      tracker.trackChange(file1)

      const file2 = makeFile({ content: 'a\nb\nX\nd\ne', version: 2 })
      const diff = tracker.trackChange(file2)

      expect(diff.hunks).toBeDefined()
      const allLines = diff.hunks!.flatMap((h) => h.lines)
      const contextLines = allLines.filter((l) => l.startsWith(' '))
      expect(contextLines.length).toBeGreaterThan(0)
    })

    it('should produce all additions when old content is empty', () => {
      const file = makeFile({ content: 'line1\nline2', version: 1 })
      const diff = tracker.trackChange(file)

      expect(diff.hunks).toBeDefined()
      const allLines = diff.hunks!.flatMap((h) => h.lines)
      const additions = allLines.filter((l) => l.startsWith('+'))
      expect(additions).toEqual(['+line1', '+line2'])
      const removals = allLines.filter((l) => l.startsWith('-'))
      expect(removals).toHaveLength(0)
    })

    it('should produce all deletions when new content is empty (via trackDeletion)', () => {
      const diff = tracker.trackDeletion('/src/file.ts', 'line1\nline2')

      expect(diff.hunks).toBeDefined()
      const allLines = diff.hunks!.flatMap((h) => h.lines)
      const removals = allLines.filter((l) => l.startsWith('-'))
      expect(removals).toEqual(['-line1', '-line2'])
      const additions = allLines.filter((l) => l.startsWith('+'))
      expect(additions).toHaveLength(0)
    })
  })

  describe('getHistory', () => {
    it('should return undefined for unknown path', () => {
      expect(tracker.getHistory('/nonexistent')).toBeUndefined()
    })

    it('should return history with all diffs for known path', () => {
      const v1 = makeFile({ content: 'v1', version: 1 })
      const v2 = makeFile({ content: 'v2', version: 2 })
      tracker.trackChange(v1)
      tracker.trackChange(v2)

      const history = tracker.getHistory('/src/index.ts')
      expect(history).toBeDefined()
      expect(history!.path).toBe('/src/index.ts')
      expect(history!.diffs).toHaveLength(2)
      expect(history!.currentVersion).toBe(2)
    })
  })

  describe('getLatestDiff', () => {
    it('should return undefined for unknown path', () => {
      expect(tracker.getLatestDiff('/nonexistent')).toBeUndefined()
    })

    it('should return the last diff for a file', () => {
      const v1 = makeFile({ content: 'v1', version: 1 })
      const v2 = makeFile({ content: 'v2', version: 2 })
      const v3 = makeFile({ content: 'v3', version: 3 })
      tracker.trackChange(v1)
      tracker.trackChange(v2)
      tracker.trackChange(v3)

      const latest = tracker.getLatestDiff('/src/index.ts')
      expect(latest).toBeDefined()
      expect(latest!.version).toBe(3)
      expect(latest!.newContent).toBe('v3')
    })
  })

  describe('getAllDiffsForContext', () => {
    it('should return latest diff per file, sorted by version descending', () => {
      const fileA = makeFile({ path: '/a.ts', content: 'a', version: 1 })
      const fileB = makeFile({ path: '/b.ts', content: 'b', version: 5 })
      const fileC = makeFile({ path: '/c.ts', content: 'c', version: 3 })
      tracker.trackChange(fileA)
      tracker.trackChange(fileB)
      tracker.trackChange(fileC)

      const diffs = tracker.getAllDiffsForContext()
      expect(diffs).toHaveLength(3)
      expect(diffs[0].version).toBe(5)
      expect(diffs[1].version).toBe(3)
      expect(diffs[2].version).toBe(1)
    })

    it('should respect maxDiffs limit', () => {
      for (let i = 1; i <= 5; i++) {
        tracker.trackChange(makeFile({ path: `/file${i}.ts`, content: `f${i}`, version: i }))
      }

      const diffs = tracker.getAllDiffsForContext(2)
      expect(diffs).toHaveLength(2)
      expect(diffs[0].version).toBe(5)
      expect(diffs[1].version).toBe(4)
    })

    it('should return empty array when no diffs exist', () => {
      const diffs = tracker.getAllDiffsForContext()
      expect(diffs).toEqual([])
    })
  })

  describe('clear', () => {
    it('should clear all histories and previous contents', () => {
      const file = makeFile({ content: 'data', version: 1 })
      tracker.trackChange(file)

      tracker.clear()

      expect(tracker.getHistory('/src/index.ts')).toBeUndefined()
      expect(tracker.getLatestDiff('/src/index.ts')).toBeUndefined()
      expect(tracker.getAllDiffsForContext()).toEqual([])

      // After clear, a new trackChange should be treated as a create (no previous content)
      const file2 = makeFile({ content: 'new data', version: 2 })
      const diff = tracker.trackChange(file2)
      expect(diff.changeType).toBe('create')
      expect(diff.oldContent).toBe('')
    })
  })
})
