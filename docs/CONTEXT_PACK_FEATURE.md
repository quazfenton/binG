# Context Pack Feature - VFS Context Packing for LLM

## Overview

The **Context Pack** feature bundles the Virtual Filesystem (VFS) directory structure and file contents into dense, LLM-friendly formats. Inspired by tools like **Repomix** and **Gitingest**, this feature allows the LLM to efficiently understand project structure and codebase contents before making edits or providing analysis.

## What is Context Packing?

Context packing creates a comprehensive snapshot of your project including:
- **Directory tree visualization** (like the `tree` command)
- **File contents** bundled together with metadata
- **Configurable filtering** (include/exclude patterns)
- **Size limits** to prevent token overflow
- **Multiple output formats** (Markdown, XML, JSON, Plain Text)

## Components

### 1. Context Pack Service (`lib/virtual-filesystem/context-pack-service.ts`)

Core service that generates context packs with configurable options.

**Key Features:**
- Directory tree building
- Recursive file collection
- Pattern-based filtering (glob-style)
- File truncation for large files
- Multiple output format generators
- Token count estimation

### 2. API Endpoint (`/api/filesystem/context-pack`)

RESTful API for generating context packs.

**GET Request:**
```bash
GET /api/filesystem/context-pack?path=/src&format=markdown&includeContents=true
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | `/` | Directory path to pack |
| `format` | string | `markdown` | Output format: `markdown`, `xml`, `json`, `plain` |
| `includeContents` | boolean | `true` | Include file contents |
| `includeTree` | boolean | `true` | Include directory tree |
| `maxFileSize` | number | `102400` | Max file size in bytes |
| `maxLinesPerFile` | number | `500` | Max lines per file |
| `excludePatterns` | string | (built-in) | Comma-separated glob patterns |
| `includePatterns` | string | (all) | Comma-separated glob patterns |

**POST Request:**
```bash
POST /api/filesystem/context-pack
Content-Type: application/json

{
  "path": "/src",
  "format": "xml",
  "includeContents": true,
  "maxFileSize": 51200,
  "excludePatterns": ["*.test.ts", "**/__tests__/**"]
}
```

**Response Headers:**
- `X-Context-Pack-Files`: Number of files included
- `X-Context-Pack-Size`: Total size in bytes
- `X-Context-Pack-Tokens`: Estimated token count
- `X-Context-Pack-Truncated`: Whether files were truncated

### 3. LLM Tool (`context_pack`)

A tool that LLM agents can call to request packed context.

**Tool Definition:**
```json
{
  "name": "context_pack",
  "description": "Generate a dense, LLM-friendly bundle of directory structure and file contents",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Root directory path" },
      "format": { "type": "string", "enum": ["markdown", "xml", "json", "plain"] },
      "includeContents": { "type": "boolean" },
      "includeTree": { "type": "boolean" },
      "maxFileSize": { "type": "number" },
      "maxLinesPerFile": { "type": "number" },
      "excludePatterns": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

**LLM Usage Example:**
```
User: "Can you analyze the entire project structure?"

Assistant: [Calls context_pack tool]
  context_pack({
    "path": "/",
    "format": "markdown",
    "maxLinesPerFile": 200
  })

[Receives bundled context with tree + file contents]

Assistant: "I've analyzed your project. Here's what I found..."
```

### 4. Chat Integration (`app/api/chat/route.ts`)

Automatic context pack generation when user requests comprehensive project context.

**Trigger Keywords:**
- "full project"
- "entire codebase"
- "project structure"
- "all files"
- "context pack"
- "repomix"
- "gitingest"
- "analyze project"
- "review codebase"

**Example User Requests:**
```
"Give me an overview of the full project"
"Analyze the entire codebase structure"
"I want to understand the project architecture"
"Show me all files in this project"
```

## Output Formats

### Markdown Format (Default)

```markdown
# Project Context Pack

**Format:** Markdown
**Files:** 42
**Generated:** 2024-01-15T10:30:00Z

## Directory Structure

```
├── src/
│   ├── components/
│   │   ├── Button.tsx
│   │   └── Modal.tsx
│   ├── utils/
│   │   └── helpers.ts
│   └── app.tsx
├── package.json
└── README.md
```

## File Contents

### src/app.tsx

```tsx
import React from 'react';
// ... file content ...
```

### src/utils/helpers.ts

```ts
export function formatDate() {
  // ... file content ...
}
```
```

### XML Format (Repomix-style)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<context_pack>
  <meta>
    <format>XML</format>
    <file_count>42</file_count>
    <generated>2024-01-15T10:30:00Z</generated>
  </meta>
  
  <directory_tree>
    <![CDATA[
    src/
    ├── components/
    │   ├── Button.tsx
    ...
    ]]>
  </directory_tree>
  
  <files>
    <file path="src/app.tsx">
      <size>1234</size>
      <lines>56</lines>
      <content>
        <![CDATA[
        import React from 'react';
        ...
        ]]>
      </content>
    </file>
  </files>
</context_pack>
```

### JSON Format

```json
{
  "meta": {
    "format": "JSON",
    "fileCount": 42,
    "generated": "2024-01-15T10:30:00Z"
  },
  "tree": "src/\n├── ...",
  "files": [
    {
      "path": "src/app.tsx",
      "size": 1234,
      "lines": 56,
      "content": "import React from 'react';..."
    }
  ]
}
```

### Plain Text Format

```
=== PROJECT CONTEXT PACK ===
Format: Plain Text
Files: 42
Generated: 2024-01-15T10:30:00Z

=== DIRECTORY STRUCTURE ===

src/
├── components/
│   ├── Button.tsx
...

=== FILE CONTENTS ===

--- FILE: src/app.tsx ---
import React from 'react';
...

=== END OF CONTEXT PACK ===
```

## Configuration Options

### Default Exclude Patterns

By default, these patterns are excluded:
```javascript
[
  'node_modules/**',
  '.git/**',
  '.next/**',
  'dist/**',
  'build/**',
  '*.log',
  '*.lock',
  '.env*',
  '*.min.js',
  '*.min.css',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]
```

### Custom Patterns

Override or extend the exclude patterns:

```javascript
// API Request
GET /api/filesystem/context-pack?excludePatterns=*.test.ts,**/__tests__/**,coverage/**

// Tool Call
context_pack({
  "path": "/",
  "excludePatterns": ["*.test.ts", "**/__tests__/**", "coverage/**"]
})
```

### Size Limits

| Option | Default | Max | Description |
|--------|---------|-----|-------------|
| `maxFileSize` | 100KB | 10MB | Per-file size limit |
| `maxLinesPerFile` | 500 | 10000 | Lines per file before truncation |
| `maxTotalSize` | 2MB | - | Total bundle size limit |

## Usage Examples

### Example 1: Quick Project Overview

```bash
curl http://localhost:3000/api/filesystem/context-pack \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Example 2: Specific Directory

```bash
curl "http://localhost:3000/api/filesystem/context-pack?path=/src/components&format=markdown" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Example 3: XML Format for LLM

```bash
curl "http://localhost:3000/api/filesystem/context-pack?format=xml&maxLinesPerFile=100" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o context-pack.xml
```

### Example 4: Exclude Test Files

```bash
curl "http://localhost:3000/api/filesystem/context-pack?excludePatterns=*.test.ts,*.spec.ts" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Example 5: Include Only TypeScript Files

```bash
curl "http://localhost:3000/api/filesystem/context-pack?includePatterns=*.ts,*.tsx" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Integration with LLM Workflow

### Automatic Detection

The chat route automatically detects when a user wants comprehensive context:

```typescript
// User says: "Analyze the full project structure"
// System detects context pack keywords
// Generates context pack automatically
// Includes in system message to LLM
```

### Manual Tool Call

LLM can explicitly request context pack:

```typescript
// LLM decides to call context_pack tool
const result = await context_pack({
  path: "/src",
  format: "markdown",
  maxLinesPerFile: 200
});

// Receives bundled context
// Analyzes and responds
```

### Token Management

Context packs include token estimation:
```javascript
{
  estimatedTokens: 12500,  // ~50KB bundle
  totalSize: 51234,
  hasTruncation: false
}
```

Use this to manage context window limits:
- GPT-4: ~128K tokens
- Claude: ~200K tokens
- Adjust `maxLinesPerFile` accordingly

## Benefits

1. **Efficient Discovery**: LLM gets complete project view in one request
2. **Token Optimization**: Dense format reduces token usage vs. individual file reads
3. **Pattern Filtering**: Exclude irrelevant files automatically
4. **Format Flexibility**: Choose format based on LLM preferences
5. **Size Control**: Prevent token overflow with configurable limits
6. **Truncation Handling**: Clear indicators when files are truncated

## Best Practices

### When to Use Context Pack

✅ **Good Use Cases:**
- Project onboarding / analysis
- Architecture review
- Refactoring planning
- Bug investigation across files
- Feature scaffolding
- Codebase documentation

❌ **When NOT to Use:**
- Single file edits (use `read_file` instead)
- Large monorepos (scope to specific directory)
- When you already have recent context
- Binary files or assets

### Optimal Configuration

```javascript
// For analysis tasks
{
  maxLinesPerFile: 200,      // Enough for most functions
  maxFileSize: 50 * 1024,    // 50KB per file
  excludePatterns: ['node_modules/**', '*.test.ts']
}

// For detailed review
{
  maxLinesPerFile: 500,
  maxFileSize: 100 * 1024,
  includeTree: true,
  lineNumbers: true
}
```

## API Reference

### ContextPackResult

```typescript
interface ContextPackResult {
  tree: string;                    // Directory tree visualization
  files: ContextPackFile[];        // File metadata and contents
  bundle: string;                  // Complete formatted output
  format: ContextPackFormat;       // Output format used
  totalSize: number;               // Size in bytes
  estimatedTokens: number;         // Approximate token count
  fileCount: number;               // Number of files included
  directoryCount: number;          // Number of directories
  hasTruncation: boolean;          // Whether files were truncated
  warnings: string[];              // Generation warnings
}
```

### ContextPackFile

```typescript
interface ContextPackFile {
  path: string;        // File path
  size: number;        // Size in bytes
  lines: number;       // Line count
  content?: string;    // File content (if included)
  truncated?: boolean; // Whether content was truncated
  error?: string;      // Error message if read failed
}
```

## Troubleshooting

### Issue: Context pack too large

**Solution:** Reduce limits or scope
```bash
# Smaller file limits
?maxLinesPerFile=100&maxFileSize=25000

# Narrower scope
?path=/src/components

# More exclusions
?excludePatterns=*.test.ts,**/__tests__/**,*.stories.tsx
```

### Issue: Missing files

**Solution:** Check exclude patterns
```bash
# Override default exclusions
?excludePatterns=*.log  # Only exclude logs

# Or specify inclusions
?includePatterns=*.ts,*.tsx,*.js,*.jsx
```

### Issue: Token limit exceeded

**Solution:** Use token estimation to pre-check
```javascript
const pack = await contextPackService.generateContextPack(...);
if (pack.estimatedTokens > MAX_TOKENS) {
  // Regenerate with stricter limits
}
```

## Related Files

- `lib/virtual-filesystem/context-pack-service.ts` - Core service
- `app/api/filesystem/context-pack/route.ts` - API endpoint
- `lib/mastra/tools/fsystem-tools.ts` - LLM tool definition
- `app/api/chat/route.ts` - Chat integration

## Future Enhancements

- [ ] Streaming context pack generation for large projects
- [ ] Incremental packs (only changed files since last pack)
- [ ] Compression support (gzip, brotli)
- [ ] Custom template formats
- [ ] Multi-directory packs
- [ ] File content summarization for very large files
- [ ] Binary file handling (base64, metadata only)
