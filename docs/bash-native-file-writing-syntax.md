---
id: bash-native-file-writing-syntax
title: Bash-Native File Writing Syntax
aliases:
  - BASH_HEREDOC_FILE_WRITING_PLAN
  - BASH_HEREDOC_FILE_WRITING_PLAN.md
  - bash-native-file-writing-syntax
  - bash-native-file-writing-syntax.md
tags: []
layer: core
summary: "# Bash-Native File Writing Syntax\r\n\r\n## Problem Statement\r\n\r\nCurrent implementation uses XML-like syntax that's unnatural for LLMs trained on code:\r\n\r\n```xml\r\n<!-- Current syntax - VERBOSITY + PARSING COMPLEXITY -->\r\n<file_write path=\"src/app.ts\">\r\n  export default function App() {\r\n    return <div>"
anchors:
  - Problem Statement
  - 'Solution: Bash Heredoc Syntax'
  - Implementation Plan
  - 'Phase 1: Parser Support (Additive)'
  - 'Phase 2: Integration with Existing Parser'
  - 'Phase 3: System Prompt Update'
  - Writing Files
  - 'Phase 4: Sanitization Update'
  - 'Phase 5: Testing'
  - Migration Strategy
  - 'Week 1: Additive Support'
  - 'Week 2: System Prompt Update'
  - 'Week 3: Deprecation Warning'
  - 'Week 4: Remove Old Syntax (Optional)'
  - Benefits
  - Example LLM Output
  - Before (XML)
  - After (Bash)
  - Backward Compatibility
---
# Bash-Native File Writing Syntax

## Problem Statement

Current implementation uses XML-like syntax that's unnatural for LLMs trained on code:

```xml
<!-- Current syntax - VERBOSITY + PARSING COMPLEXITY -->
<file_write path="src/app.ts">
  export default function App() {
    return <div>Hello</div>;
  }
</file_write>

<!-- Alternative current syntax -->
WRITE path/to/file.txt <<<
content here
>>>
```

**Issues:**
1. ❌ Non-standard syntax (not bash, not markdown)
2. ❌ Requires custom XML parser
3. ❌ LLMs must learn special format
4. ❌ Hard to test in actual terminal
5. ❌ Verbose closing tags

---

## Solution: Bash Heredoc Syntax

Replace with **native bash heredoc** syntax that LLMs already know:

```bash
# PROPOSED: Native bash heredoc syntax
cat > src/app.ts << 'EOF'
export default function App() {
  return <div>Hello</div>;
}
EOF

# Multi-line with directory creation
mkdir -p src/components
cat > src/components/Button.tsx << 'EOF'
export function Button({ children }) {
  return <button>{children}</button>;
}
EOF

# Append mode
cat >> src/app.ts << 'EOF'
// Additional code
EOF

# Delete file
rm src/old-file.ts

# Patch with sed
sed -i 's/old/new/g' src/app.ts
```

---

## Implementation Plan

### Phase 1: Parser Support (Additive)

**New file: `/root/bing/lib/chat/bash-file-commands.ts`**

```typescript
/**
 * Bash-Native File Command Parser
 * 
 * Parses bash heredoc syntax for file operations:
 * - cat > file << 'EOF' ... EOF (create/overwrite)
 * - cat >> file << 'EOF' ... EOF (append)
 * - mkdir -p path (create directory)
 * - rm file (delete file)
 * - sed -i 's/old/new/g' file (patch)
 */

export interface BashFileEdit {
  path: string;
  content: string;
  mode: 'write' | 'append';
}

export interface BashDirectoryEdit {
  path: string;
  mode: 'create';
}

export interface BashDeleteEdit {
  path: string;
}

export interface BashPatchEdit {
  path: string;
  pattern: string;
  replacement: string;
}

/**
 * Extract cat heredoc commands: cat > file << 'EOF' ... EOF
 */
export function extractCatHeredocEdits(content: string): BashFileEdit[] {
  const edits: BashFileEdit[] = [];
  
  // Match: cat > path << 'EOF' ... EOF  OR  cat >> path << 'EOF' ... EOF
  const regex = /cat\s*(>>?)\s*([^\s<]+)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n?\3/gi;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(content)) !== null) {
    const mode = match[1] === '>>' ? 'append' : 'write';
    const path = match[2]?.trim();
    const fileContent = match[4] ?? '';
    
    if (!path) continue;
    
    edits.push({ path, content: fileContent, mode });
  }
  
  return edits;
}

/**
 * Extract mkdir commands: mkdir -p path
 */
export function extractMkdirEdits(content: string): BashDirectoryEdit[] {
  const edits: BashDirectoryEdit[] = [];
  
  const regex = /mkdir\s+(-p\s+)?([^\s&|;]+)/gi;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(content)) !== null) {
    const path = match[2]?.trim();
    if (!path || path.startsWith('-')) continue;
    
    edits.push({ path, mode: 'create' });
  }
  
  return edits;
}

/**
 * Extract rm commands: rm file
 */
export function extractRmEdits(content: string): BashDeleteEdit[] {
  const deletes: BashDeleteEdit[] = [];
  
  const regex = /rm\s+(-[rf]+\s+)?([^\s&|;]+)/gi;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(content)) !== null) {
    const path = match[2]?.trim();
    if (!path || path.startsWith('-')) continue;
    
    deletes.push({ path });
  }
  
  return deletes;
}

/**
 * Extract sed patch commands: sed -i 's/old/new/g' file
 */
export function extractSedEdits(content: string): BashPatchEdit[] {
  const patches: BashPatchEdit[] = [];
  
  const regex = /sed\s+-i\s+['"]s\/([^\/]+)\/([^\/]+)\/[gim]*['"]\s+([^\s&|;]+)/gi;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(content)) !== null) {
    const pattern = match[1];
    const replacement = match[2];
    const path = match[3]?.trim();
    
    if (!path || !pattern) continue;
    
    patches.push({ path, pattern, replacement });
  }
  
  return patches;
}

/**
 * Extract all bash file commands
 */
export function extractBashFileEdits(content: string): {
  writes: BashFileEdit[];
  directories: BashDirectoryEdit[];
  deletes: BashDeleteEdit[];
  patches: BashPatchEdit[];
} {
  return {
    writes: extractCatHeredocEdits(content),
    directories: extractMkdirEdits(content),
    deletes: extractRmEdits(content),
    patches: extractSedEdits(content),
  };
}
```

---

### Phase 2: Integration with Existing Parser

**Update `/root/bing/lib/chat/file-edit-parser.ts`:**

```typescript
// Add import
import { extractBashFileEdits } from './bash-file-commands';

// Update extractFileEdits function
export function extractFileEdits(content: string): FileEdit[] {
  const allEdits: FileEdit[] = [];

  // NEW: Try bash heredoc syntax first (more natural for LLMs)
  const bashEdits = extractBashFileEdits(content);
  
  // Convert bash writes to FileEdit format
  for (const write of bashEdits.writes) {
    allEdits.push({ path: write.path, content: write.content });
  }
  
  // Existing parsers (keep for backward compatibility)
  if (content.includes('<file_edit')) {
    allEdits.push(...extractCompactFileEdits(content));
    allEdits.push(...extractMultiLineFileEdits(content));
  }
  if (content.includes('<file_write')) {
    allEdits.push(...extractFileWriteEdits(content));
  }
  if (content.includes('WRITE')) {
    allEdits.push(...extractFsActionWrites(content));
    allEdits.push(...extractTopLevelWrites(content));
  }
  
  // Deduplicate by path
  const dedupedEdits = new Map<string, FileEdit>();
  for (const edit of allEdits) {
    if (!dedupedEdits.has(edit.path)) {
      dedupedEdits.set(edit.path, edit);
    }
  }

  return Array.from(dedupedEdits.values());
}
```

---

### Phase 3: System Prompt Update

**Update system prompt to encourage bash syntax:**

```typescript
// In lib/prompts/system-prompt.ts or wherever system prompt is defined

const FILE_WRITING_INSTRUCTIONS = `
## Writing Files

You can write files using **bash heredoc syntax**:

\`\`\`bash
# Create/overwrite a file
cat > src/app.ts << 'EOF'
export default function App() {
  return <div>Hello World</div>;
}
EOF

# Append to existing file
cat >> src/app.ts << 'EOF'
// Additional code
EOF

# Create directory structure
mkdir -p src/components/buttons
cat > src/components/buttons/Primary.tsx << 'EOF'
export function PrimaryButton({ children }) {
  return <button className="primary">{children}</button>;
}
EOF

# Delete a file
rm src/old-file.ts

# Patch existing file
sed -i 's/oldValue/newValue/g' src/config.ts
\`\`\`

**Benefits:**
- Natural bash syntax you already know
- Works in real terminals
- No special XML tags to remember
- Supports any content (no escaping needed)

**Alternative formats** (still supported but deprecated):
- <file_write path="...">...</file_write>
- WRITE path <<< content >>>
`;
```

---

### Phase 4: Sanitization Update

**Update `/root/bing/lib/chat/file-edit-parser.ts` sanitize function:**

```typescript
export function sanitizeFileEditTags(content: string): string {
  let sanitized = content;

  // NEW: Remove bash heredoc blocks for display
  if (sanitized.includes('cat >') || sanitized.includes('cat >>')) {
    // Remove cat heredoc blocks
    sanitized = sanitized.replace(/cat\s*>>?\s*[^\s<]+\s*<<\s*['"]?\w+['"]?\s*\n[\s\S]*?\n?\w+/gi, '[FILE_EDIT]');
  }
  
  if (sanitized.includes('mkdir -p')) {
    sanitized = sanitized.replace(/mkdir\s+-p\s+[^\s&|;]+/gi, '[DIR_CREATE]');
  }
  
  if (sanitized.includes('rm ')) {
    sanitized = sanitized.replace(/rm\s+(-[rf]+\s+)?[^\s&|;]+/gi, '[FILE_DELETE]');
  }
  
  if (sanitized.includes('sed -i')) {
    sanitized = sanitized.replace(/sed\s+-i\s+['"][^'"]+['"]\s+[^\s&|;]+/gi, '[PATCH]');
  }

  // Existing sanitizers (keep for backward compatibility)
  if (sanitized.includes('<file_edit')) {
    // ... existing code
  }
  
  return sanitized;
}
```

---

### Phase 5: Testing

**Test cases for bash heredoc parser:**

```typescript
// __tests__/bash-file-commands.test.ts
import { extractBashFileEdits } from '@/lib/chat/bash-file-commands';

describe('Bash Heredoc Parser', () => {
  it('should extract cat heredoc write', () => {
    const content = `
      cat > src/app.ts << 'EOF'
      export default function App() {
        return <div>Hello</div>;
      }
      EOF
    `;
    
    const edits = extractBashFileEdits(content);
    expect(edits.writes).toHaveLength(1);
    expect(edits.writes[0]).toEqual({
      path: 'src/app.ts',
      content: 'export default function App() {\n  return <div>Hello</div>;\n}',
      mode: 'write',
    });
  });
  
  it('should extract append mode', () => {
    const content = `
      cat >> src/app.ts << 'EOF'
      // Additional code
      EOF
    `;
    
    const edits = extractBashFileEdits(content);
    expect(edits.writes[0].mode).toBe('append');
  });
  
  it('should extract mkdir', () => {
    const content = 'mkdir -p src/components';
    const edits = extractBashFileEdits(content);
    expect(edits.directories).toHaveLength(1);
    expect(edits.directories[0].path).toBe('src/components');
  });
  
  it('should extract rm', () => {
    const content = 'rm src/old-file.ts';
    const edits = extractBashFileEdits(content);
    expect(edits.deletes).toHaveLength(1);
    expect(edits.deletes[0].path).toBe('src/old-file.ts');
  });
  
  it('should extract sed patch', () => {
    const content = "sed -i 's/old/new/g' src/config.ts";
    const edits = extractBashFileEdits(content);
    expect(edits.patches).toHaveLength(1);
    expect(edits.patches[0]).toEqual({
      path: 'src/config.ts',
      pattern: 'old',
      replacement: 'new',
    });
  });
  
  it('should handle multiple commands', () => {
    const content = `
      mkdir -p src/components
      cat > src/components/Button.tsx << 'EOF'
      export function Button() {
        return <button>Click</button>;
      }
      EOF
      rm src/old.ts
    `;
    
    const edits = extractBashFileEdits(content);
    expect(edits.writes).toHaveLength(1);
    expect(edits.directories).toHaveLength(1);
    expect(edits.deletes).toHaveLength(1);
  });
});
```

---

## Migration Strategy

### Week 1: Additive Support
- [ ] Create `bash-file-commands.ts`
- [ ] Add tests
- [ ] Integrate with `extractFileEdits()`
- [ ] Both old and new syntax work

### Week 2: System Prompt Update
- [ ] Update system prompts
- [ ] Update documentation
- [ ] Test with LLM (verify it uses bash syntax)

### Week 3: Deprecation Warning
- [ ] Add warnings when old syntax detected
- [ ] Log migration metrics

### Week 4: Remove Old Syntax (Optional)
- [ ] Remove XML parsers if migration >90%
- [ ] Clean up code

---

## Benefits

| Aspect | Old (XML) | New (Bash) |
|--------|-----------|------------|
| **LLM Training** | Rare in training data | Common in bash tutorials |
| **Parsing** | Custom XML parser | Simple regex |
| **Testing** | Can't test in terminal | Works in real bash |
| **Escaping** | Need to escape `<`, `>`, `&` | No escaping needed |
| **Verbosity** | `<file_write path="x">...</file_write>` | `cat > x << 'EOF'...EOF` |
| **Append mode** | Special attribute | `>>` (natural) |
| **Directory create** | Separate tag | `mkdir -p` (natural) |
| **Delete** | Separate tag | `rm` (natural) |
| **Patch** | Complex diff | `sed -i` (natural) |

---

## Example LLM Output

### Before (XML)
```
I'll create the component for you.

<file_write path="src/components/Button.tsx">
export function Button({ children }) {
  return <button className="btn">{children}</button>;
}
</file_write>

The component is ready to use.
```

### After (Bash)
```
I'll create the component for you.

```bash
cat > src/components/Button.tsx << 'EOF'
export function Button({ children }) {
  return <button className="btn">{children}</button>;
}
EOF
```

The component is ready to use.
```

---

## Backward Compatibility

✅ **100% backward compatible** - old syntax still works:
- `<file_write>` tags
- `WRITE path <<< >>>`
- JSON formats
- All existing formats

New syntax is **additive**, not replacement (until optional Week 4).
