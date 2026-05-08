# Ripgrep VFS Integration

## Overview

The ripgrep VFS integration provides fast file search capabilities for both desktop and web modes of the application. It automatically adapts based on the environment:

- **Desktop Mode**: Uses native ripgrep binary on user's local filesystem
- **Web Mode**: Searches VFS (Virtual Filesystem) in-memory and database storage

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM Agent / User                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              CapabilityRouter (router.ts)                    │
│                  RipgrepProvider                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│          ripgrep-vfs-adapter.ts (Unified Interface)          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
    ┌───────────────────┐   ┌───────────────────┐
    │  Desktop Mode     │   │   Web Mode        │
    │  (ripgrep.ts)     │   │   (VFS Search)    │
    │                   │   │                   │
    │  Native rg binary │   │  In-memory +      │
    │  on local files   │   │  SQLite database  │
    └───────────────────┘   └───────────────────┘
```

## Files

### Core Files

- **`web/lib/search/ripgrep.ts`**: Native ripgrep wrapper for desktop mode
- **`web/lib/search/ripgrep-vfs-adapter.ts`**: Unified adapter that routes to native or VFS search
- **`web/lib/tools/router.ts`**: RipgrepProvider that integrates with capability system
- **`web/lib/tools/capabilities.ts`**: Defines `file.search` and `repo.search` capabilities

### Binaries

- **`tools/bin/rg.exe`**: Windows ripgrep binary (4.3MB)
- **`tools/bin/rg-linux`**: Linux ripgrep binary (6.6MB)
- **`tools/bin/rg-macos`**: macOS ripgrep binary (5.3MB)

## Usage

### From LLM Agent

The LLM can use the `file.search` or `repo.search` capabilities:

```typescript
// Example tool call from LLM
{
  "capability": "file.search",
  "input": {
    "query": "function handleSubmit",
    "path": "src",
    "glob": "*.ts",
    "caseInsensitive": true,
    "maxResults": 50
  }
}
```

### Programmatic Usage

```typescript
import { ripgrepVFS } from '@/lib/search/ripgrep-vfs-adapter';

const result = await ripgrepVFS({
  query: 'TODO',
  ownerId: userId,
  path: 'project/src',
  glob: '*.{ts,tsx}',
  caseInsensitive: false,
  maxResults: 100,
  contextLines: 2,
});

console.log(`Found ${result.matches.length} matches`);
console.log(`Used ripgrep: ${result.usedRipgrep}`);
console.log(`Used VFS: ${result.usedVFS}`);
```

## Options

### VFSRipgrepOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `query` | `string` | *required* | Search pattern (regex or literal) |
| `ownerId` | `string` | *required* | User/session ID for VFS workspace |
| `path` | `string` | `undefined` | Root path to search within |
| `glob` | `string \| string[]` | `undefined` | File pattern filter (e.g., `*.ts`, `**/*.{js,jsx}`) |
| `fixedString` | `boolean` | `false` | Treat query as literal string, not regex |
| `caseInsensitive` | `boolean` | `false` | Case-insensitive search |
| `wordRegexp` | `boolean` | `false` | Match whole words only |
| `maxResults` | `number` | `100` | Maximum total matches to return |
| `maxCountPerFile` | `number` | `50` | Maximum matches per file |
| `contextLines` | `number` | `0` | Number of context lines before/after match |
| `timeoutMs` | `number` | `10000` | Search timeout in milliseconds |

## Result Format

```typescript
interface VFSRipgrepResult {
  matches: Array<{
    path: string;           // File path
    lineNumber: number;     // Line number (1-indexed)
    content: string;        // Matched line content
    contextBefore?: string[]; // Lines before match (if contextLines > 0)
    contextAfter?: string[];  // Lines after match (if contextLines > 0)
  }>;
  stats: {
    searches: number;       // Number of searches performed (always 1)
    matches: number;        // Total matches found
    filesWithMatches: number; // Number of files with matches
    filesSearched: number;  // Total files searched
    elapsedMs: number;      // Search duration in milliseconds
  };
  errors: string[];         // Any errors encountered
  usedRipgrep: boolean;     // Whether native ripgrep was used
  usedVFS: boolean;         // Whether VFS search was used
}
```

## Platform Detection

The adapter automatically detects the environment:

```typescript
// Desktop mode with local filesystem
if (isDesktopMode() && isUsingLocalFS()) {
  // Use native ripgrep binary
  // Binary selection based on process.platform:
  // - win32 → rg.exe
  // - darwin → rg-macos
  // - linux → rg-linux
}

// Web mode with VFS
else {
  // Search VFS in-memory + database storage
  // Works with browser IndexedDB and server SQLite
}
```

## Performance

### Desktop Mode (Native Ripgrep)
- **Speed**: Extremely fast (100k+ files/sec)
- **Memory**: Low (streaming results)
- **Limitations**: Requires local filesystem access

### Web Mode (VFS Search)
- **Speed**: Fast for typical workspaces (<1000 files)
- **Memory**: Moderate (in-memory file map)
- **Limitations**: Limited by VFS size constraints (500MB total, 10k files)

## Glob Patterns

Supported glob patterns:

- `*.ts` - All TypeScript files
- `**/*.tsx` - All TSX files recursively
- `src/**/*.{js,jsx}` - All JS/JSX files in src directory
- `!node_modules/**` - Exclude node_modules (not yet implemented)

## Examples

### Search for TODO comments

```typescript
const result = await ripgrepVFS({
  query: 'TODO|FIXME',
  ownerId: userId,
  caseInsensitive: true,
  maxResults: 100,
});
```

### Search for function definitions

```typescript
const result = await ripgrepVFS({
  query: 'function\\s+\\w+',
  ownerId: userId,
  glob: '*.{ts,js}',
  maxResults: 50,
});
```

### Search with context

```typescript
const result = await ripgrepVFS({
  query: 'handleSubmit',
  ownerId: userId,
  contextLines: 3,
  maxResults: 20,
});

// Each match includes 3 lines before and after
result.matches.forEach(match => {
  console.log('Before:', match.contextBefore);
  console.log('Match:', match.content);
  console.log('After:', match.contextAfter);
});
```

### Literal string search

```typescript
const result = await ripgrepVFS({
  query: 'function App()',
  ownerId: userId,
  fixedString: true, // Treat as literal, not regex
});
```

## Environment Variables

- `RG_BIN`: Override ripgrep binary path (e.g., `/usr/local/bin/rg`)

## Testing

Run tests:

```bash
pnpm test web/lib/search/__tests__/ripgrep-vfs-adapter.test.ts
```

## Future Enhancements

- [ ] Support for exclude patterns (`!node_modules/**`)
- [ ] Incremental search with streaming results
- [ ] Search result caching
- [ ] Fuzzy matching support
- [ ] Multi-line regex support
- [ ] Binary file detection and skipping
- [ ] Syntax-aware search (AST-based)
