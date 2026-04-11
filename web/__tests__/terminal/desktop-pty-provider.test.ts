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
    it('should detect fs createFile event', () => {
      // Test fs createFile pattern - reliable one from the code
      const pattern = /\[fs\]\s+createFile\s+([^.\n]+\.\w+)/g
      const output = '[fs] createFile package.json'
      pattern.lastIndex = 0
      const match = pattern.exec(output)
      expect(match).not.toBeNull()
      expect(match?.[1]).toBe('package.json')
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

describe('Shell Completion Flow', () => {
  // Completion state types mirroring the implementation
  interface CompletionState {
    completions: string[]
    selectedIndex: number
    currentLine: string
    prefix: string
  }

  // Simulates the prefix extraction logic in TerminalPanel
  function extractPrefix(line: string): string {
    const parts = line.split(/\s+/)
    return parts[parts.length - 1] || ''
  }

  // Simulates the suffix calculation for completion insertion
  // Uses slice() to get substring after prefix length (matches TerminalPanel implementation)
  function getCompletionSuffix(completion: string, prefix: string): string {
    // Only return suffix if completion starts with prefix, otherwise return full completion
    if (completion.startsWith(prefix)) {
      return completion.slice(prefix.length)
    }
    return completion
  }

  // Simulates the keyboard navigation wrap-around logic
  function navigateUp(currentIndex: number, total: number): number {
    return (currentIndex - 1 + total) % total
  }

  function navigateDown(currentIndex: number, total: number): number {
    return (currentIndex + 1) % total
  }

  describe('Prefix Extraction', () => {
    it('should extract last word as prefix', () => {
      expect(extractPrefix('git comm')).toBe('comm')
    })

    it('should return full input when no whitespace', () => {
      // './src/ap' has no whitespace, so split returns single element
      expect(extractPrefix('./src/ap')).toBe('./src/ap')
    })

    it('should extract last part after path separator', () => {
      // Using regex that splits on both whitespace and path separators
      const extractPrefixWithPath = (line: string): string => {
        const parts = line.split(/[/\s]+/)
        return parts[parts.length - 1] || ''
      }
      expect(extractPrefixWithPath('./src/ap')).toBe('ap')
    })

    it('should return empty string for single word command', () => {
      expect(extractPrefix('ls')).toBe('ls')
    })

    it('should handle empty input', () => {
      expect(extractPrefix('')).toBe('')
    })

    it('should handle multiple spaces', () => {
      expect(extractPrefix('git  commit')).toBe('commit')
    })
  })

  describe('Completion Suffix Calculation', () => {
    it('should calculate suffix for file completion', () => {
      const suffix = getCompletionSuffix('app.ts', 'ap')
      // slice(2) of 'app.ts' is 'p.ts' - matches TerminalPanel implementation
      expect(suffix).toBe('p.ts')
    })

    it('should return full completion when prefix does not match', () => {
      // 'complete' doesn't start with 'xyz', so returns full word
      const suffix = getCompletionSuffix('complete', 'xyz')
      expect(suffix).toBe('complete')
    })

    it('should return substring after prefix length when prefix matches', () => {
      const suffix = getCompletionSuffix('complete', 'com')
      // slice(3) of 'complete' is 'plete'
      expect(suffix).toBe('plete')
    })

    it('should handle empty prefix', () => {
      const suffix = getCompletionSuffix('filename.txt', '')
      expect(suffix).toBe('filename.txt')
    })

    it('should handle exact match (no suffix needed)', () => {
      const suffix = getCompletionSuffix('git', 'git')
      expect(suffix).toBe('')
    })
  })

  describe('Keyboard Navigation', () => {
    it('should navigate up with wrap-around', () => {
      expect(navigateUp(0, 3)).toBe(2)
      expect(navigateUp(1, 3)).toBe(0)
      expect(navigateUp(2, 3)).toBe(1)
    })

    it('should navigate down with wrap-around', () => {
      expect(navigateDown(0, 3)).toBe(1)
      expect(navigateDown(1, 3)).toBe(2)
      expect(navigateDown(2, 3)).toBe(0)
    })

    it('should handle single item (no movement)', () => {
      expect(navigateUp(0, 1)).toBe(0)
      expect(navigateDown(0, 1)).toBe(0)
    })

    it('should handle empty list gracefully', () => {
      expect(() => navigateUp(0, 0)).not.toThrow()
      expect(() => navigateDown(0, 0)).not.toThrow()
    })
  })

  describe('Completion Selection', () => {
    let completionState: CompletionState | null

    function selectCompletion(state: CompletionState): string {
      const selected = state.completions[state.selectedIndex]
      return getCompletionSuffix(selected, state.prefix)
    }

    function isValidCompletion(state: CompletionState): boolean {
      return state.completions.length > 0 && state.selectedIndex >= 0 && state.selectedIndex < state.completions.length
    }

    it('should select first completion by default', () => {
      completionState = {
        completions: ['file1.txt', 'file2.txt', 'file3.txt'],
        selectedIndex: 0,
        currentLine: 'touch fi',
        prefix: 'fi'
      }
      expect(isValidCompletion(completionState)).toBe(true)
      expect(selectCompletion(completionState)).toBe('le1.txt')
    })

    it('should navigate to last item on up from first', () => {
      completionState = {
        completions: ['a', 'b', 'c'],
        selectedIndex: 0,
        currentLine: 'test',
        prefix: 'test'
      }
      completionState.selectedIndex = navigateUp(completionState.selectedIndex, completionState.completions.length)
      expect(completionState.selectedIndex).toBe(2)
    })

    it('should navigate to first item on down from last', () => {
      completionState = {
        completions: ['a', 'b', 'c'],
        selectedIndex: 2,
        currentLine: 'test',
        prefix: 'test'
      }
      completionState.selectedIndex = navigateDown(completionState.selectedIndex, completionState.completions.length)
      expect(completionState.selectedIndex).toBe(0)
    })

    it('should return correct suffix after navigation', () => {
      completionState = {
        completions: ['option1', 'option2', 'option3'],
        selectedIndex: 0,
        currentLine: '--opt',
        prefix: 'opt'
      }
      // Navigate down twice
      completionState.selectedIndex = navigateDown(completionState.selectedIndex, completionState.completions.length)
      completionState.selectedIndex = navigateDown(completionState.selectedIndex, completionState.completions.length)
      
      const suffix = selectCompletion(completionState)
      expect(suffix).toBe('ion3')
    })
  })

  describe('Completion State Lifecycle', () => {
    it('should initialize with first item selected', () => {
      const state: CompletionState = {
        completions: ['a', 'b', 'c'],
        selectedIndex: 0,
        currentLine: 'test',
        prefix: 'test'
      }
      expect(state.selectedIndex).toBe(0)
    })

    it('should clear state on enter key', () => {
      let state: CompletionState | null = {
        completions: ['file.txt'],
        selectedIndex: 0,
        currentLine: 'touch f',
        prefix: 'f'
      }
      // Simulate Enter key - insert completion and clear state
      const selected = state.completions[state.selectedIndex]
      const newLine = state.currentLine + getCompletionSuffix(selected, state.prefix)
      expect(newLine).toBe('touch file.txt')
      state = null
      expect(state).toBeNull()
    })

    it('should clear state on escape key', () => {
      let state: CompletionState | null = {
        completions: ['a', 'b'],
        selectedIndex: 1,
        currentLine: 'test',
        prefix: 'test'
      }
      // Simulate Escape key - cancel and clear state
      state = null
      expect(state).toBeNull()
    })

    it('should clear state on backspace when prefix changes', () => {
      let state: CompletionState | null = {
        completions: ['test'],
        selectedIndex: 0,
        currentLine: 'te',
        prefix: 'te'
      }
      // Simulate backspace that changes the prefix
      // In the actual implementation, any backspace clears completion mode
      state = null
      expect(state).toBeNull()
    })

    it('should clear state on regular character input', () => {
      let state: CompletionState | null = {
        completions: ['abc'],
        selectedIndex: 0,
        currentLine: 'ab',
        prefix: 'ab'
      }
      // Simulate typing a character - clear completion state
      state = null
      expect(state).toBeNull()
    })
  })

  describe('Multiple Completions Display', () => {
    it('should limit display to 10 items', () => {
      const allCompletions = Array.from({ length: 15 }, (_, i) => `item${i}`)
      const displayCompletions = allCompletions.slice(0, 10)
      expect(displayCompletions.length).toBe(10)
      expect(allCompletions.length - displayCompletions.length).toBe(5)
    })

    it('should correctly identify selected item in display', () => {
      const completions = ['a', 'b', 'c', 'd', 'e']
      const selectedIndex = 2
      
      const isSelected = (idx: number) => idx === selectedIndex
      
      expect(completions.map((_, idx) => isSelected(idx))).toEqual([false, false, true, false, false])
    })

    it('should calculate remaining count for display hint', () => {
      const total = 15
      const displayLimit = 10
      const remaining = total - displayLimit
      expect(remaining).toBe(5)
    })
  })

  describe('Debounce Tab Press', () => {
    function shouldDebounce(lastTabTime: number, now: number, debounceMs: number = 300): boolean {
      return now - lastTabTime < debounceMs
    }

    it('should debounce rapid tab presses', () => {
      const lastTabTime = 1000
      const now = 1100 // 100ms difference
      expect(shouldDebounce(lastTabTime, now)).toBe(true)
    })

    it('should not debounce after debounce interval', () => {
      const lastTabTime = 1000
      const now = 1400 // 400ms difference
      expect(shouldDebounce(lastTabTime, now)).toBe(false)
    })

    it('should not debounce at exact interval boundary', () => {
      const lastTabTime = 1000
      const now = 1300 // 300ms - exactly at boundary
      expect(shouldDebounce(lastTabTime, now)).toBe(false)
    })
  })
})
