/**
 * Unit Tests: Desktop PTY Provider - File Change Detection
 * 
 * Tests regex patterns for detecting file changes from PTY output
 * 
 * @see lib/terminal/desktop-pty-provider.ts
 */

import { describe, it, expect } from 'vitest'

describe('File Change Detection Patterns', () => {
  // These patterns mirror the ones in desktop-pty-provider.ts
  const commandPatterns = [
    /(?:^|\n)\s*(?:touch|mkdir)\s+([\S]+)/g,
    /(?:^|\n)\s*rm\s+(?:-[\w]+\s+)*([\S]+)/g,
    /(?:^|\n)\s*cp\s+([\S]+)\s+([\S]+)/g,
    /(?:^|\n)\s*mv\s+([\S]+)\s+([\S]+)/g,
    /(?:^|\n)\s*(?:echo|printf|cat)\s+.*?>\s*([\S]+)/g,
    /(?:^|\n)\s*tee\s+([\S]+)/g,
  ]

  const editorPatterns = [
    /"([^"]+\.\w+)".*\[New File\]/g,
    /"([^"]+\.\w+)".*saved/g,
    /Wrote:\s+([^\s]+)/g,
    /File Name to Write:\s*([^\n]+)/g,
    /Saved as:\s*([^\n]+)/g,
  ]

  const idePatterns = [
    /\[\w+\]"([^"]+\.\w+)"\s+created/g,
    /\[fs\]\s+createFile\s+([^.\n]+\.\w+)/g,
    /created\s+([^.\n]+\.\w+)\s+in\s+\d+ms/g,
  ]

  // Mirrors the filtering logic in desktop-pty-provider.ts
  function extractMatches(output: string, patterns: RegExp[]): string[] {
    const results: string[] = []
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(output)) !== null) {
        const path = match[match.length - 1]
        // Apply same filtering as actual code: exclude flags and globs
        if (!path.startsWith('-') && path.length > 1 && !path.includes('*')) {
          results.push(path)
        }
      }
    }
    return results
  }

  describe('Shell Commands', () => {
    it('should detect touch', () => {
      const matches = extractMatches('touch file.txt', commandPatterns)
      expect(matches).toContain('file.txt')
    })

    it('should detect touch with path', () => {
      const matches = extractMatches('touch src/app.ts', commandPatterns)
      expect(matches).toContain('src/app.ts')
    })

    it('should detect mkdir', () => {
      const matches = extractMatches('mkdir newdir', commandPatterns)
      expect(matches).toContain('newdir')
    })

    it('should detect rm', () => {
      const matches = extractMatches('rm old.txt', commandPatterns)
      expect(matches).toContain('old.txt')
    })

    it('should detect rm with flags', () => {
      const matches = extractMatches('rm -rf temp', commandPatterns)
      expect(matches).toContain('temp')
    })

    it('should detect cp', () => {
      const matches = extractMatches('cp a.txt b.txt', commandPatterns)
      expect(matches).toContain('b.txt') // Last arg is dest
    })

    it('should detect mv', () => {
      const matches = extractMatches('mv old.ts new.ts', commandPatterns)
      expect(matches).toContain('new.ts')
    })

    it('should detect echo redirect', () => {
      const matches = extractMatches('echo hi > out.txt', commandPatterns)
      expect(matches).toContain('out.txt')
    })

    it('should detect tee', () => {
      // The regex requires tee to be at start of line with whitespace prefix
      const matches = extractMatches('tee result.log', commandPatterns)
      expect(matches).toContain('result.log')
    })
  })

  describe('Editor Saves', () => {
    it('should detect vim new file', () => {
      const matches = extractMatches('"app.ts" [New File]', editorPatterns)
      expect(matches).toContain('app.ts')
    })

    it('should detect vim saved', () => {
      // The regex expects "filename" followed by "saved"
      const matches = extractMatches('"main.ts" saved', editorPatterns)
      expect(matches).toContain('main.ts')
    })

    it('should detect vim Wrote', () => {
      const matches = extractMatches('Wrote: /path/to/file.ts', editorPatterns)
      expect(matches).toContain('/path/to/file.ts')
    })

    it('should detect nano save', () => {
      const matches = extractMatches('File Name to Write: config.json', editorPatterns)
      expect(matches).toContain('config.json')
    })

    it('should detect nano saved as', () => {
      const matches = extractMatches('Saved as: /tmp/out.txt', editorPatterns)
      expect(matches).toContain('/tmp/out.txt')
    })
  })

  describe('IDE Events', () => {
    it('should detect quoted file in brackets', () => {
      // The pattern requires word characters in brackets like [FileWatcher] or [watch]
      const pattern = /\[\w+\]"([^"]+\.\w+)"\s+created/g
      const matches = extractMatches('[FileWatcher] "file.ts" created', [pattern])
      expect(matches).toContain('file.ts')
    })

    it('should detect fs createFile', () => {
      const matches = extractMatches('[fs] createFile package.json', idePatterns)
      expect(matches).toContain('package.json')
    })

    it('should detect npm created', () => {
      const matches = extractMatches('created index.js in 45ms', idePatterns)
      expect(matches).toContain('index.js')
    })
  })

  describe('Filtering', () => {
    it('should ignore flags starting with -', () => {
      const matches = extractMatches('touch -r file.txt', commandPatterns)
      expect(matches).not.toContain('-r')
    })

    it('should ignore globs with *', () => {
      const matches = extractMatches('rm *.log', commandPatterns)
      expect(matches).not.toContain('*.log')
    })
  })

  describe('Multi-line', () => {
    it('should detect in multiline output', () => {
      const output = 'touch a.txt\necho hi > b.txt\nrm c.txt'
      const matches = extractMatches(output, commandPatterns)
      expect(matches).toContain('a.txt')
      expect(matches).toContain('b.txt')
      expect(matches).toContain('c.txt')
    })
  })
})

describe('Path Normalization', () => {
  const workspaceRoot = '/home/user/workspaces'

  function normalizePath(path: string): string {
    if (path.startsWith('~/')) {
      return workspaceRoot + path.slice(1)
    }
    if (path.startsWith('../')) {
      return path.replace(/^\.\.\//, '')
    }
    return path
  }

  it('should expand tilde', () => {
    expect(normalizePath('~/file.txt')).toBe('/home/user/workspaces/file.txt')
  })

  it('should strip relative dots', () => {
    expect(normalizePath('../file.txt')).toBe('file.txt')
  })

  it('should pass through simple paths', () => {
    expect(normalizePath('file.txt')).toBe('file.txt')
  })
})

describe('Debounce Logic', () => {
  // Test the debounce queue behavior
  interface QueueItem {
    path: string
    type: 'create' | 'update' | 'delete'
  }

  function createQueue() {
    const items = new Map<string, QueueItem>()
    return {
      add(path: string, type: 'create' | 'update' | 'delete') {
        items.set(path, { path, type })
        return items.size
      },
      remove(path: string) {
        items.delete(path)
        return items.size
      },
      get size() {
        return items.size
      },
      getAll() {
        return Array.from(items.values())
      },
      clear() {
        items.clear()
      }
    }
  }

  it('should add items to queue', () => {
    const queue = createQueue()
    queue.add('/a.txt', 'create')
    queue.add('/b.txt', 'create')
    expect(queue.size).toBe(2)
  })

  it('should update existing items', () => {
    const queue = createQueue()
    queue.add('/a.txt', 'create')
    queue.add('/a.txt', 'update')
    expect(queue.size).toBe(1)
    expect(queue.getAll()[0].type).toBe('update')
  })

  it('should remove items', () => {
    const queue = createQueue()
    queue.add('/a.txt', 'create')
    queue.remove('/a.txt')
    expect(queue.size).toBe(0)
  })

  it('should clear all items', () => {
    const queue = createQueue()
    queue.add('/a.txt', 'create')
    queue.add('/b.txt', 'create')
    queue.clear()
    expect(queue.size).toBe(0)
  })
})

describe('Change Type Detection', () => {
  function getChangeType(known: Set<string>, path: string): 'create' | 'update' {
    return known.has(path) ? 'update' : 'create'
  }

  it('should return create for new file', () => {
    const known = new Set<string>()
    expect(getChangeType(known, 'new.txt')).toBe('create')
  })

  it('should return update for known file', () => {
    const known = new Set(['existing.txt'])
    expect(getChangeType(known, 'existing.txt')).toBe('update')
  })
})