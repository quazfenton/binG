---
id: file.read
name: Read File
version: 1.0.0
description: "Reads the content of a file from the filesystem. Supports multiple encodings (utf-8, base64, binary), optional byte truncation, and automatic language detection."
category: file
source: core
runtime:
  type: native
  providerPriority:
    - mcp-filesystem
    - local-fs
    - vfs
triggers:
  - read
  - cat
  - file
  - open
  - view
  - show
actions:
  - name: read_file
    description: "Reads the content of a specified file and returns it along with metadata (size, encoding, language)."
    paramsSchema:
      type: object
      properties:
        path:
          type: string
          description: "The path to the file to read."
        encoding:
          type: string
          enum:
            - utf-8
            - base64
            - binary
          default: utf-8
        maxBytes:
          type: number
          description: "Maximum bytes to read. 0 or omitted = read all."
      required:
        - path
    returns:
      type: object
      properties:
        content:
          type: string
        encoding:
          type: string
        size:
          type: number
        exists:
          type: boolean
        language:
          type: string
    timeoutMs: 10000
permissions:
  requiredScopes:
    - file:read
tags:
  - file
  - read
  - filesystem
  - io
  - cat
metadata:
  latency: low
  cost: low
  reliability: 0.99
enabled: true
---

# Read File

This power allows the agent to read the content of a file. It supports different encodings and optionally truncates the read content.

## Usage

Use the `read_file` action to read a file.

**Parameters:**
- `path` (string, required): The path to the file to read. Can be absolute or relative to the workspace root.
- `encoding` (enum, optional, default: 'utf-8'): The encoding of the file. Use 'base64' for binary files (images, PDFs), 'binary' for raw bytes.
- `maxBytes` (number, optional): The maximum number of bytes to read from the file. Useful for previewing large files without loading them entirely.

**Returns:**
- `content` (string): The content of the file (or base64-encoded content for binary encoding).
- `encoding` (string): The encoding used for reading.
- `size` (number): The size of the file in bytes.
- `exists` (boolean): Whether the file exists at the given path.
- `language` (string): Detected programming language (e.g., 'typescript', 'python').

## Behavior

1. If the file does not exist, returns `{ exists: false, content: '', size: 0 }`.
2. If `maxBytes` is specified, content is truncated to that limit with a truncation marker appended.
3. The `language` field is auto-detected from the file extension for syntax highlighting support.

## Examples

```bash
# Read a TypeScript file
read_file({ path: 'src/index.ts' })

# Read first 1024 bytes of a large file
read_file({ path: 'data/large.json', maxBytes: 1024 })

# Read a binary image as base64
read_file({ path: 'assets/logo.png', encoding: 'base64' })
```

## Error Handling

- **Path traversal**: Paths outside the workspace root are rejected with a security error.
- **Permission denied**: Returns an error message without exposing system paths.
- **File too large**: If the file exceeds `maxBytes`, content is truncated.
