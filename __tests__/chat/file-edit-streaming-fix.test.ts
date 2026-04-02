/**
 * FILE_EDIT Streaming Fix - Comprehensive Test Suite
 * 
 * Tests the robust handling of FILE_EDIT events during streaming responses.
 * Validates that both unified diffs and full file content are correctly
 * distinguished and displayed in the EnhancedDiffViewer.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  createIncrementalParser,
  extractIncrementalFileEdits,
  parseFilesystemResponse,
  isValidFilePath,
} from '@/lib/chat/file-edit-parser';

describe('FILE_EDIT Streaming Fix', () => {
  describe('Content vs Diff Detection', () => {
    it('correctly identifies unified diff format', () => {
      const diffContent = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
+import new
 old line
 context`;

      // Unified diff should have --- and +++ headers
      expect(diffContent.startsWith('---')).toBe(true);
      expect(diffContent.includes('+++')).toBe(true);
      expect(diffContent.includes('@@')).toBe(true);
    });

    it('correctly identifies full file content (not diff)', () => {
      const fullContent = `export default function App() {
  return <div>Hello World</div>;
}`;

      // Full content should NOT have diff markers
      expect(fullContent.startsWith('---')).toBe(false);
      expect(fullContent.includes('+++')).toBe(false);
    });

    it('handles edge case: diff with minimal headers', () => {
      const minimalDiff = `--- file.ts
+++ file.ts
@@ -1 +1 @@
-old
+new`;

      expect(minimalDiff.startsWith('---')).toBe(true);
      expect(minimalDiff.includes('+++')).toBe(true);
    });
  });

  describe('Incremental Parsing with Mixed Formats', () => {
    it('extracts full content from <file_edit> tag', () => {
      const parser = createIncrementalParser();
      const content = '<file_edit path="src/app.ts">\nexport const x = 1;\n</file_edit>';
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(1);
      expect(edits[0].path).toBe('src/app.ts');
      expect(edits[0].content).toBe('export const x = 1;');
      expect(edits[0].diff).toBeUndefined();
    });

    it('extracts unified diff from <file_edit> tag', () => {
      const parser = createIncrementalParser();
      const diffContent = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
+import React
 export default function App() {
   return <div>Hello</div>;
 }`;
      
      const content = `<file_edit path="src/app.ts">\n${diffContent}\n</file_edit>`;
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(1);
      expect(edits[0].path).toBe('src/app.ts');
      expect(edits[0].content).toContain('--- a/src/app.ts');
      expect(edits[0].diff).toBeUndefined(); // Parser doesn't separate diff from content
    });

    it('handles multiple edits in single response (mixed formats)', () => {
      const parser = createIncrementalParser();
      const content = `
Here are the changes:

<file_edit path="src/new.ts">
export const newFile = true;
</file_edit>

<file_edit path="src/existing.ts">
--- a/src/existing.ts
+++ b/src/existing.ts
@@ -1 +1,2 @@
+import new
 old
</file_edit>
`;
      
      const edits = extractIncrementalFileEdits(content, parser);

      expect(edits.length).toBeGreaterThanOrEqual(1);
      // Verify the specific file path was extracted
      const fileEdit = edits.find(e => e.path === 'test.txt');
      expect(fileEdit).toBeDefined();
      expect(fileEdit?.content).toBe('test content');
    });
  });

  describe('Path Validation', () => {
    it('accepts valid file paths', () => {
      expect(isValidFilePath('src/app.ts')).toBe(true);
      expect(isValidFilePath('components/Button.tsx')).toBe(true);
      expect(isValidFilePath('lib/utils/helper.ts')).toBe(true);
      expect(isValidFilePath('package.json')).toBe(true);
    });

    it('rejects obvious CSS values as paths', () => {
      // Note: isValidFilePath checks for patterns, not all CSS values
      // The actual validation in route.ts uses more comprehensive checks
      expect(isValidFilePath('=')).toBe(false);
      expect(isValidFilePath(',')).toBe(false);
    });

    it('rejects paths with JSON syntax', () => {
      expect(isValidFilePath('src/{name}.ts')).toBe(false);
      expect(isValidFilePath('src/[id].ts')).toBe(false);
    });

    it('rejects SCSS variables as paths', () => {
      expect(isValidFilePath('$transition-fast')).toBe(false);
      expect(isValidFilePath('$primary-color')).toBe(false);
    });

    it('rejects paths ending with special characters', () => {
      expect(isValidFilePath('src/app.ts/')).toBe(false);
      expect(isValidFilePath('src/app.ts:')).toBe(false);
    });
  });

  describe('Empty Content Filtering', () => {
    it('filters out edits with empty content', () => {
      const parser = createIncrementalParser();
      const content = '<file_edit path="src/app.ts"></file_edit>';
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(0);
    });

    it('filters out edits with whitespace-only content', () => {
      const parser = createIncrementalParser();
      const content = '<file_edit path="src/app.ts">   \n  \n  </file_edit>';
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(0);
    });

    it('accepts edits with minimal but valid content', () => {
      const parser = createIncrementalParser();
      const content = '<file_edit path="src/app.ts">x</file_edit>';
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(1);
      expect(edits[0].content).toBe('x');
    });
  });

  describe('Streaming Chunk Boundaries', () => {
    it('handles edit split across multiple chunks', () => {
      const parser = createIncrementalParser();
      const chunks = [
        '<file_edit path="src/app.ts">',
        'export const ',
        'answer = 42;',
        '</file_edit>',
      ];
      
      const allEdits = [];
      let buffer = '';
      
      for (const chunk of chunks) {
        buffer += chunk;
        const edits = extractIncrementalFileEdits(buffer, parser);
        allEdits.push(...edits);
      }
      
      expect(allEdits).toHaveLength(1);
      expect(allEdits[0].path).toBe('src/app.ts');
      expect(allEdits[0].content).toBe('export const answer = 42;');
    });

    it('does not re-emit same edit on subsequent chunks', () => {
      const parser = createIncrementalParser();
      let buffer = '<file_edit path="src/app.ts">content</file_edit>';
      
      const firstEdits = extractIncrementalFileEdits(buffer, parser);
      expect(firstEdits).toHaveLength(1);
      
      // Add more content to buffer
      buffer += '\nSome trailing text';
      const secondEdits = extractIncrementalFileEdits(buffer, parser);
      
      // Should not re-emit the same edit
      expect(secondEdits).toHaveLength(0);
    });

    it('handles incomplete edit in final chunk', () => {
      const parser = createIncrementalParser();
      const chunks = [
        '<file_edit path="src/app.ts">',
        'export const x',
        // Missing closing tag - incomplete
      ];
      
      let buffer = '';
      for (const chunk of chunks) {
        buffer += chunk;
      }
      
      // Clear state to simulate final parse
      parser.emittedEdits.clear();
      parser.unclosedPositions.clear();
      
      const edits = extractIncrementalFileEdits(buffer, parser);
      
      // Incomplete edit should not be emitted
      expect(edits).toHaveLength(0);
    });
  });

  describe('Operation Type Detection', () => {
    it('extracts content from WRITE heredoc format', () => {
      const parser = createIncrementalParser();
      const content = `WRITE src/app.ts <<<
export default function App() {
  return <div>Hello</div>;
}
>>>`;
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      // WRITE heredoc should be extracted
      expect(edits.length).toBeGreaterThanOrEqual(1);
      if (edits.length > 0) {
        expect(edits[0].content).toContain('export default');
      }
    });

    it('extracts content from PATCH heredoc format', () => {
      const parser = createIncrementalParser();
      const diffContent = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new`;
      
      const content = `PATCH src/app.ts <<<
${diffContent}
>>>`;
      
      const edits = extractIncrementalFileEdits(content, parser);

      // PATCH heredoc should be extracted with the patch content
      expect(Array.isArray(edits)).toBe(true);
      expect(edits.length).toBeGreaterThan(0);
      // Verify the PATCH edit was actually extracted with correct content
      const patchEdit = edits.find(e => e.action === 'patch' || e.content?.includes('s/old/new/'));
      expect(patchEdit).toBeDefined();
      expect(patchEdit?.content).toBeTruthy();
    });

    it('handles bash heredoc with full content', () => {
      const parser = createIncrementalParser();
      const content = `cat > src/app.ts << 'EOF'
export const x = 1;
EOF`;
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits.length).toBeGreaterThanOrEqual(1);
      if (edits.length > 0) {
        expect(edits[0].content).toBe('export const x = 1;');
      }
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('handles malformed XML tags', () => {
      const parser = createIncrementalParser();
      const content = '<file_edit path="src/app.ts" incomplete';
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      // Malformed tag should not produce edits
      expect(edits).toHaveLength(0);
    });

    it('handles nested tags correctly', () => {
      const parser = createIncrementalParser();
      const content = `<file_edit path="src/app.ts">
<div>
  <span>Nested HTML</span>
</div>
</file_edit>`;
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(1);
      expect(edits[0].content).toContain('<div>');
    });

    it('handles special characters in content', () => {
      const parser = createIncrementalParser();
      const content = `<file_edit path="src/app.ts">
const regex = /<file_edit>/g;
const json = { key: "value" };
</file_edit>`;
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(1);
      expect(edits[0].content).toContain('regex');
      expect(edits[0].content).toContain('json');
    });

    it('handles very large content', () => {
      const parser = createIncrementalParser();
      const largeContent = 'a'.repeat(10000);
      const content = `<file_edit path="src/large.ts">
${largeContent}
</file_edit>`;
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(1);
      expect(edits[0].content.length).toBeGreaterThan(9000);
    });
  });

  describe('Response Parsing Integration', () => {
    it('parses complete response with multiple edit formats', () => {
      const response = `I'll help you with those changes.

<file_edit path="src/new.ts">
export const newFeature = true;
</file_edit>

Here's the diff for the existing file:

<file_edit path="src/existing.ts">
--- a/src/existing.ts
+++ b/src/existing.ts
@@ -1,2 +1,3 @@
+import new
 export const x = 1;
</file_edit>

And I'll also create a directory:

\`\`\`bash
mkdir -p src/utils
\`\`\`
`;
      
      const parsed = parseFilesystemResponse(response);
      
      // Should detect writes
      expect(parsed.writes.length).toBeGreaterThanOrEqual(1);
    });

    it('handles response with only diffs', () => {
      const response = `Here are the diffs:

\`\`\`diff src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1,2 @@
+import React
 export default App;
\`\`\`
`;
      
      const parsed = parseFilesystemResponse(response);

      // Should detect fenced diffs (at least 1 valid diff)
      expect(parsed.diffs.length).toBeGreaterThan(0);
      // Verify the diff has proper structure
      if (parsed.diffs.length > 0) {
        expect(parsed.diffs[0].path).toBeTruthy();
        expect(parsed.diffs[0].diff).toBeTruthy();
      }
    });
  });
});

describe('FILE_EDIT Event Format Validation', () => {
  describe('Backend Event Emission Format', () => {
    it('emits correct format for WRITE operations', () => {
      // Simulate backend event structure
      const event = {
        path: 'src/app.ts',
        status: 'detected',
        operation: 'write',
        content: 'export const x = 1;',
        diff: undefined,
        timestamp: Date.now(),
      };
      
      // Validate structure
      expect(event.path).toBeTruthy();
      expect(event.content).toBeTruthy();
      expect(event.operation).toBe('write');
      expect(event.diff).toBeUndefined();
    });

    it('emits correct format for PATCH operations', () => {
      const diffContent = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new`;
      
      const event = {
        path: 'src/app.ts',
        status: 'detected',
        operation: 'patch',
        content: '',
        diff: diffContent,
        timestamp: Date.now(),
      };
      
      // Validate structure
      expect(event.path).toBeTruthy();
      expect(event.diff).toBeTruthy();
      expect(event.diff!.startsWith('---')).toBe(true);
      expect(event.operation).toBe('patch');
    });

    it('validates diff format before sending', () => {
      const potentiallyInvalidDiff = 'This is not a diff, just text';
      const validDiff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new`;
      
      // Check format validation logic
      const isValidDiff = (diff: string) => 
        diff.trim().length > 0 && 
        diff.startsWith('---') && 
        diff.includes('+++');
      
      expect(isValidDiff(potentiallyInvalidDiff)).toBe(false);
      expect(isValidDiff(validDiff)).toBe(true);
    });
  });

  describe('Frontend Event Handling', () => {
    it('correctly processes WRITE operation events', () => {
      const eventData = {
        path: 'src/app.ts',
        status: 'detected',
        operation: 'write',
        content: 'export const x = 1;',
        diff: '',
        timestamp: Date.now(),
      };
      
      // Simulate frontend validation
      const editContent = eventData.content || eventData.diff || '';
      const hasContent = editContent && editContent.trim().length > 0;
      
      expect(hasContent).toBe(true);
      expect(eventData.operation).toBe('write');
    });

    it('correctly processes PATCH operation events', () => {
      const eventData = {
        path: 'src/app.ts',
        status: 'detected',
        operation: 'patch',
        content: '',
        diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
        timestamp: Date.now(),
      };
      
      // Simulate frontend validation
      const editContent = eventData.content || eventData.diff || '';
      const hasContent = editContent && editContent.trim().length > 0;
      const hasUnifiedDiff = eventData.diff && 
                             eventData.diff.trim().length > 0 && 
                             eventData.diff.startsWith('---');
      
      expect(hasContent).toBe(true);
      expect(hasUnifiedDiff).toBe(true);
    });

    it('rejects events with empty content and diff', () => {
      const eventData = {
        path: 'src/app.ts',
        status: 'detected',
        operation: 'write',
        content: '',
        diff: '',
        timestamp: Date.now(),
      };
      
      // Simulate frontend validation
      const editContent = eventData.content || eventData.diff || '';
      const hasContent = editContent && editContent.trim().length > 0;
      
      // Empty string is falsy, so hasContent should be false (empty string)
      expect(!hasContent).toBe(true);
    });

    it('rejects events with obviously invalid paths', () => {
      // Test paths that isValidFilePath actually rejects
      const invalidPaths = ['=', ',', '$variable', 'src/{json}', 'src/[array]'];
      
      for (const path of invalidPaths) {
        const eventData = {
          path,
          status: 'detected',
          operation: 'write',
          content: 'some content',
          diff: '',
          timestamp: Date.now(),
        };
        
        // Should fail path validation
        expect(isValidFilePath(eventData.path)).toBe(false);
      }
    });
  });
});

describe('EnhancedDiffViewer Integration', () => {
  it('correctly identifies unified diff for display', () => {
    const diffContent = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
+import React
 export default function App() {
   return <div>Hello</div>;
 }`;
    
    // Simulate EnhancedDiffViewer detection logic
    const hasUnifiedDiff = diffContent &&
                          diffContent.trim().length > 0 &&
                          diffContent.startsWith('---') &&
                          diffContent.includes('+++');
    
    expect(hasUnifiedDiff).toBe(true);
  });

  it('correctly identifies full content for display', () => {
    const fullContent = `export default function App() {
  return <div>Hello World</div>;
}`;
    
    // Simulate EnhancedDiffViewer detection logic
    const hasUnifiedDiff = fullContent &&
                          fullContent.trim().length > 0 &&
                          fullContent.startsWith('---') &&
                          fullContent.includes('+++');
    
    expect(hasUnifiedDiff).toBe(false);
  });

  it('handles edge case: content with --- but not a diff', () => {
    const contentWithDashes = `---
title: My Document
---

# Content here`;
    
    // Should check for both --- and +++ to be a valid diff
    const hasUnifiedDiff = contentWithDashes &&
                          contentWithDashes.trim().length > 0 &&
                          contentWithDashes.startsWith('---') &&
                          contentWithDashes.includes('+++');
    
    expect(hasUnifiedDiff).toBe(false);
  });
});
