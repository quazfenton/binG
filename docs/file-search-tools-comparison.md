# File Search Tools: search_files vs grep_code

## Overview

The system provides two complementary file search tools with different purposes and capabilities:

1. **`search_files`** - Simple VFS search for finding files by name or basic content
2. **`grep_code`** - Advanced regex search using ripgrep for code analysis

## Comparison Table

| Feature | `search_files` | `grep_code` |
|---------|---------------|-------------|
| **Purpose** | Find files by name/path | Search code content with regex |
| **Search Method** | Simple string matching | Regex pattern matching |
| **Performance** | Fast for small queries | Very fast (ripgrep optimized) |
| **Context Lines** | No | Yes (before/after match) |
| **Glob Patterns** | No | Yes (`*.ts`, `**/*.tsx`) |
| **Case Sensitivity** | Always case-insensitive | Configurable |
| **Word Boundaries** | No | Yes (whole word matching) |
| **Fixed String** | Yes (default) | Optional |
| **Desktop Mode** | VFS only | Native ripgrep binary |
| **Web Mode** | VFS search | VFS search (fallback) |
| **Default in Tools** | Yes | Yes |

## When to Use Each Tool

### Use `search_files` when:
- Finding files by name or path pattern
- Quick lookup of specific files
- Searching for simple text strings
- You need a list of files containing a term
- Performance is not critical

### Use `grep_code` when:
- Searching for function definitions, imports, or symbols
- Using regex patterns (e.g., `function\s+\w+`)
- Need context lines around matches
- Filtering by file type (glob patterns)
- Searching large codebases efficiently
- Finding TODOs, FIXMEs, or code patterns

## Tool Definitions

### search_files

```typescript
search_files({
  query: string,      // Search term (simple string)
  path?: string,      // Optional directory to search within
  limit?: number      // Max results (default: 10)
})
```

**Example:**
```typescript
search_files({
  query: "useState",
  path: "src/",
  limit: 20
})
```

**Returns:**
```typescript
{
  success: boolean,
  files: Array<{
    path: string,
    name: string,
    language: string,
    score: number,
    snippet: string,
    lastModified: string
  }>,
  total: number
}
```

### grep_code

```typescript
grep_code({
  query: string,              // Regex pattern or literal text
  path?: string,              // Root directory to search
  glob?: string | string[],   // File filter (e.g., "*.ts")
  caseInsensitive?: boolean,  // Case-insensitive search
  wordRegexp?: boolean,       // Match whole words only
  fixedString?: boolean,      // Treat query as literal (not regex)
  contextLines?: number,      // Lines of context before/after
  maxResults?: number,        // Max total matches (default: 100)
  maxCountPerFile?: number    // Max matches per file (default: 50)
})
```

**Examples:**
```typescript
// Find function definitions
grep_code({
  query: "export function",
  glob: "*.ts"
})

// Find TODOs with context
grep_code({
  query: "TODO|FIXME",
  caseInsensitive: true,
  contextLines: 2
})

// Find imports in React files
grep_code({
  query: "import.*from",
  glob: "**/*.{ts,tsx}",
  maxResults: 50
})
```

**Returns:**
```typescript
{
  success: boolean,
  query: string,
  usedRipgrep: boolean,  // Whether native ripgrep was used
  usedVFS: boolean,      // Whether VFS search was used
  matches: Array<{
    path: string,
    line: number,
    content: string,
    contextBefore?: string[],
    contextAfter?: string[]
  }>,
  total: number,
  stats: {
    searches: number,
    matches: number,
    filesWithMatches: number,
    filesSearched: number,
    elapsedMs: number
  },
  errors?: string[]
}
```

## Implementation Details

### search_files Implementation

- **Desktop Mode**: Searches VFS in-memory map
- **Web Mode**: Searches VFS in-memory map + SQLite database
- **Algorithm**: Simple string matching with scoring
  - Exact filename match: +120 points
  - Filename contains query: +80 points
  - Path contains query: +40 points
  - Content contains query: +20 points
- **Caching**: Results cached for 60 seconds

### grep_code Implementation

- **Desktop Mode**: Uses native ripgrep binary (rg.exe, rg-linux, rg-macos)
  - Searches user's local filesystem directly
  - Ultra-fast performance (100k+ files/sec)
  - Full regex support
- **Web Mode**: Uses VFS adapter
  - Searches VFS in-memory map + database
  - JavaScript regex engine
  - Fast for typical workspaces (<1000 files)
- **Fallback**: If ripgrep fails, falls back to JavaScript search

### Path Normalization

Both tools return VFS-normalized paths:
- **Format**: `project/src/components/App.tsx`
- **No leading slash**: Paths are relative to workspace root
- **Forward slashes**: Always use `/` (even on Windows)
- **No traversal**: `..` segments are rejected

## Performance Characteristics

### search_files
- **Small workspaces** (<100 files): ~10-50ms
- **Medium workspaces** (100-1000 files): ~50-200ms
- **Large workspaces** (1000+ files): ~200-500ms
- **Memory**: Low (in-memory map)

### grep_code (Desktop Mode)
- **Small workspaces**: ~5-20ms
- **Medium workspaces**: ~20-100ms
- **Large workspaces**: ~100-500ms
- **Very large** (10k+ files): ~500-2000ms
- **Memory**: Very low (streaming)

### grep_code (Web Mode)
- **Small workspaces**: ~20-100ms
- **Medium workspaces**: ~100-500ms
- **Large workspaces**: Limited by VFS constraints (500MB, 10k files)
- **Memory**: Moderate (in-memory map)

## Common Use Cases

### Finding a Specific File
```typescript
// Use search_files for simple file lookup
search_files({ query: "App.tsx" })
```

### Finding Function Definitions
```typescript
// Use grep_code with regex
grep_code({
  query: "function handleSubmit",
  glob: "*.{ts,tsx}"
})
```

### Finding All TODOs
```typescript
// Use grep_code with context
grep_code({
  query: "TODO|FIXME",
  caseInsensitive: true,
  contextLines: 2
})
```

### Finding Imports
```typescript
// Use grep_code with regex
grep_code({
  query: "import .* from ['\"]react['\"]",
  glob: "**/*.{ts,tsx}"
})
```

### Finding Files in a Directory
```typescript
// Use search_files with path filter
search_files({
  query: "",
  path: "src/components",
  limit: 50
})
```

## LLM Integration

Both tools are **always available** to the LLM as default tools (like `write_file`, `read_file`). They are part of the VFS MCP tools and don't require special activation.

### Tool Selection Guidance for LLM

The LLM should choose:
- **`search_files`** for: "find files named X", "list files in directory Y"
- **`grep_code`** for: "find where function X is defined", "search for TODO comments", "find all imports of X"

### Result Handling

Both tools return structured results that the LLM can:
1. Parse and present to the user
2. Use to make decisions about next actions
3. Chain with other tools (e.g., read_file after finding matches)

The chat does **not stop** after these tools execute - the LLM receives the results and continues the conversation.

## Troubleshooting

### grep_code returns no results
- Check if ripgrep binary is available (`usedRipgrep: false` means fallback)
- Verify regex pattern is valid
- Try with `fixedString: true` for literal matching
- Check glob pattern matches your files

### search_files is slow
- Reduce `limit` parameter
- Use more specific `path` to narrow search
- Consider using `grep_code` for content search

### Paths look wrong
- All paths are VFS-normalized (relative to workspace root)
- Use the returned paths directly with `read_file` or other tools
- Don't add leading `/` or `./` prefixes

## Future Enhancements

- [ ] Exclude patterns for grep_code (`!node_modules/**`)
- [ ] Fuzzy matching in search_files
- [ ] Incremental/streaming results
- [ ] Search result caching
- [ ] Syntax-aware search (AST-based)
- [ ] Multi-line regex support
