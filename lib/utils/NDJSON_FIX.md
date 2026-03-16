# NDJSON Parsing Fix

## Problem

The existing NDJSON parsing is fragile:

```typescript
// OLD - FRAGILE
const parsed = JSON.parse(line)
```

**Issues:**
- ❌ Breaks on partial chunks (incomplete lines)
- ❌ No error handling for malformed JSON
- ❌ Loses data when parsing fails
- ❌ No buffering for multi-chunk lines

## Solution

Created robust NDJSON parser: `lib/utils/ndjson-parser.ts`

```typescript
// NEW - ROBUST
import { createNDJSONParser } from '@/lib/utils/ndjson-parser'

const parser = createNDJSONParser()
const parsedObjects = parser.parse(chunk)

for (const obj of parsedObjects) {
  // Process parsed object
}
```

**Benefits:**
- ✅ Handles partial chunks (buffers incomplete lines)
- ✅ Graceful error handling (logs warnings, continues)
- ✅ No data loss (buffers until complete)
- ✅ Supports async iteration

---

## Files Updated

### ✅ Completed

| File | Status | Changes |
|------|--------|---------|
| `lib/utils/ndjson-parser.ts` | ✅ Created | New NDJSON parser utility |
| `lib/agent/services/agent-worker/src/opencode-engine.ts` | ✅ Updated | Uses NDJSON parser |

### 🔄 To Update

| File | Line | Pattern | Priority |
|------|------|---------|----------|
| `lib/sandbox/spawn/opencode-cli.ts` | 235 | `JSON.parse(line)` | HIGH |
| `lib/sandbox/spawn/opencode-spawn.ts` | 133, 308 | `JSON.parse(line)` | HIGH |
| `lib/session/agent/opencode-engine-service.ts` | 279, 498 | `JSON.parse(line)` | HIGH |
| `lib/sandbox/spawn/e2b-codex-service.ts` | 320 | `JSON.parse(line)` | MEDIUM |
| `lib/sandbox/spawn/e2b-amp.ts` | 432 | `JSON.parse(line)` | MEDIUM |
| `lib/sandbox/spawn/e2b-amp-service.ts` | 122, 183 | `JSON.parse(line)` | MEDIUM |
| `lib/computer/e2b-desktop-provider-enhanced.ts` | 486 | `JSON.parse(line)` | MEDIUM |
| `lib/sandbox/providers/e2b-structured-output.ts` | 241 | `JSON.parse(line)` | MEDIUM |
| `lib/mcp/client.ts` | 652 | `JSON.parse(line)` | LOW |
| `lib/chat/puter.ts` | 98 | `JSON.parse(chunk)` | LOW |

---

## Usage Examples

### Basic Usage

```typescript
import { createNDJSONParser } from '@/lib/utils/ndjson-parser'

const parser = createNDJSONParser()

stream.on('data', (chunk) => {
  const objects = parser.parse(chunk.toString())
  
  for (const obj of objects) {
    console.log('Parsed:', obj)
  }
})
```

### Async Iterator

```typescript
import { parseNDJSONStream } from '@/lib/utils/ndjson-parser'

for await (const obj of parseNDJSONStream(readableStream)) {
  console.log('Parsed:', obj)
}
```

### String Parsing (Testing)

```typescript
import { parseNDJSONString } from '@/lib/utils/ndjson-parser'

const input = `{"a":1}\n{"b":2}\n{"c":3}`
const objects = parseNDJSONString(input)
// [{a:1}, {b:2}, {c:3}]
```

### Stringify

```typescript
import { stringifyNDJSON, stringifyNDJSONArray } from '@/lib/utils/ndjson-parser'

// Single object
const line = stringifyNDJSON({ foo: 'bar' })
// '{"foo":"bar"}\n'

// Array of objects
const lines = stringifyNDJSONArray([{a:1}, {b:2}])
// '{"a":1}\n{"b":2}\n'
```

---

## API Reference

### `createNDJSONParser()`

Creates NDJSON parser instance.

**Returns:**
```typescript
interface NDJSONParser {
  parse(chunk: string): any[]
  reset(): void
  getBufferedLines(): number
}
```

**Example:**
```typescript
const parser = createNDJSONParser()
const objects = parser.parse('{"a":1}\n{"b":2}')
// [{a:1}, {b:2}]
```

### `parseNDJSONStream(stream)`

Async iterator for NDJSON streams.

**Parameters:**
- `stream`: Node.js ReadableStream or Web ReadableStream

**Returns:** `AsyncGenerator<any>`

**Example:**
```typescript
for await (const obj of parseNDJSONStream(process.stdin)) {
  console.log(obj)
}
```

### `parseNDJSONString(input)`

Parse NDJSON from string.

**Parameters:**
- `input`: NDJSON string

**Returns:** `any[]`

**Example:**
```typescript
const objects = parseNDJSONString('{"a":1}\n{"b":2}')
// [{a:1}, {b:2}]
```

### `stringifyNDJSON(obj)`

Stringify object to NDJSON line.

**Parameters:**
- `obj`: Any JSON-serializable object

**Returns:** `string`

**Example:**
```typescript
const line = stringifyNDJSON({ foo: 'bar' })
// '{"foo":"bar"}\n'
```

### `stringifyNDJSONArray(arr)`

Stringify array to NDJSON.

**Parameters:**
- `arr`: Array of objects

**Returns:** `string`

**Example:**
```typescript
const lines = stringifyNDJSONArray([{a:1}, {b:2}])
// '{"a":1}\n{"b":2}\n'
```

---

## Error Handling

The parser handles errors gracefully:

```typescript
const parser = createNDJSONParser()

// Invalid JSON - logs warning, continues
const objects = parser.parse('{"valid":1}\n{invalid}\n{"valid":2}')
// [{valid:1}, {valid:2}]

// Warning logged:
// [NDJSON Parser] Failed to parse line: {
//   error: "Unexpected token i in JSON...",
//   line: "{invalid}"
// }
```

---

## Performance

- **Memory efficient**: Only buffers incomplete lines
- **Fast**: Simple split + parse, no complex state
- **Streaming**: Processes chunks as they arrive
- **Zero dependencies**: Pure TypeScript, no npm packages needed

---

## Testing

```typescript
import { createNDJSONParser, parseNDJSONString } from '@/lib/utils/ndjson-parser'

// Test complete lines
const parser = createNDJSONParser()
const result = parser.parse('{"a":1}\n{"b":2}\n')
assert.deepEqual(result, [{a:1}, {b:2}])

// Test partial chunks
const parser2 = createNDJSONParser()
const partial1 = parser2.parse('{"a":1}\n{"b":')
assert.deepEqual(partial1, [{a:1}])
assert.equal(parser2.getBufferedLines(), 1)

const partial2 = parser2.parse('2}\n{"c":3}')
assert.deepEqual(partial2, [{b:2}, {c:3}])

// Test error handling
const parser3 = createNDJSONParser()
const result3 = parser3.parse('{"valid":1}\n{invalid}\n{"valid":2}')
assert.deepEqual(result3, [{valid:1}, {valid:2}])

// Test string parsing
const stringResult = parseNDJSONString('{"a":1}\n{"b":2}')
assert.deepEqual(stringResult, [{a:1}, {b:2}])
```

---

## Migration Guide

### Before

```typescript
let buffer = ''

stream.on('data', (chunk) => {
  buffer += chunk.toString()
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      handleOutput(parsed)
    } catch {
      // Silent fail or emit as text
    }
  }
})
```

### After

```typescript
import { createNDJSONParser } from '@/lib/utils/ndjson-parser'

const parser = createNDJSONParser()

stream.on('data', (chunk) => {
  const parsedObjects = parser.parse(chunk.toString())
  
  for (const parsed of parsedObjects) {
    handleOutput(parsed)
  }
})
```

**Benefits:**
- ✅ Less code (8 lines → 5 lines)
- ✅ Better error handling (logs warnings)
- ✅ More robust (handles edge cases)
- ✅ Easier to test

---

## Summary

**Created:**
- ✅ `lib/utils/ndjson-parser.ts` - Complete NDJSON parser utility

**Updated:**
- ✅ `lib/agent/services/agent-worker/src/opencode-engine.ts` - Uses NDJSON parser

**To Update:**
- 🔄 10 files with fragile `JSON.parse(line)` patterns

**Impact:**
- 🎯 Fixes "Unexpected end of JSON input" errors
- 🎯 Handles partial chunks gracefully
- 🎯 No data loss from parsing failures
- 🎯 Better error logging for debugging
