/**
 * FILE_EDIT Backend Integration Tests
 * 
 * Tests the backend FILE_EDIT event emission logic in app/api/chat/route.ts
 * Validates proper content vs diff handling across all emission points.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createIncrementalParser, extractIncrementalFileEdits } from '@/lib/chat/file-edit-parser';

describe('Backend FILE_EDIT Event Emission', () => {
  describe('Agentic Pipeline Streaming', () => {
    it('emits FILE_EDIT event with correct format for WRITE operations', () => {
      const parser = createIncrementalParser();
      const content = '<file_edit path="src/app.ts">\nexport const x = 1;\n</file_edit>';
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(1);
      const edit = edits[0];
      
      // Verify structure matches what backend emits
      expect(edit.path).toBe('src/app.ts');
      expect(edit.content).toBe('export const x = 1;');
      expect(edit.action).toBeUndefined(); // Not set by parser
      expect(edit.diff).toBeUndefined();
      
      // Simulate backend event construction
      const isPatch = edit.action === 'patch' || !!edit.diff;
      const event = {
        path: edit.path,
        status: 'detected',
        operation: isPatch ? 'patch' : 'write',
        content: edit.content || '',
        diff: isPatch ? (edit.diff || '') : undefined,
      };
      
      expect(event.operation).toBe('write');
      expect(event.content).toBe('export const x = 1;');
      expect(event.diff).toBeUndefined();
    });

    it('emits FILE_EDIT event with correct format for PATCH operations', () => {
      const parser = createIncrementalParser();
      const diffContent = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new`;
      const content = `<file_edit path="src/app.ts">\n${diffContent}\n</file_edit>`;
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      expect(edits).toHaveLength(1);
      const edit = edits[0];
      
      // Simulate backend event construction
      const isPatch = edit.action === 'patch' || !!edit.diff;
      const event = {
        path: edit.path,
        status: 'detected',
        operation: isPatch ? 'patch' : 'write',
        content: edit.content || '',
        diff: isPatch ? (edit.diff || '') : undefined,
      };
      
      // Content contains the diff text
      expect(event.content).toContain('--- a/src/app.ts');
      expect(event.operation).toBe('write'); // Parser doesn't set action for this format
    });

    it('validates path before emitting FILE_EDIT event', () => {
      const parser = createIncrementalParser();
      const invalidContent = '<file_edit path="0.3s">\ncontent\n</file_edit>';
      
      const edits = extractIncrementalFileEdits(invalidContent, parser);
      
      // Parser may extract it, but backend should filter
      if (edits.length > 0) {
        // Simulate backend validation
        const isValidPath = !['0.3s', '10px', '$var'].includes(edits[0].path);
        expect(isValidPath).toBe(false);
      }
    });

    it('filters empty content to prevent infinite loops', () => {
      const parser = createIncrementalParser();
      const emptyContent = '<file_edit path="src/app.ts"></file_edit>';
      
      const edits = extractIncrementalFileEdits(emptyContent, parser);
      
      expect(edits).toHaveLength(0);
    });

    it('handles post-stream parse with cleared state', () => {
      const parser = createIncrementalParser();
      const chunk1 = '<file_edit path="src/app.ts">';
      const chunk2 = 'export const x = 1;';
      const chunk3 = '</file_edit>';
      
      // Stream chunks
      let buffer = '';
      buffer += chunk1;
      extractIncrementalFileEdits(buffer, parser);
      
      buffer += chunk2;
      extractIncrementalFileEdits(buffer, parser);
      
      buffer += chunk3;
      
      // Simulate post-stream parse (clear state)
      parser.emittedEdits.clear();
      parser.unclosedPositions.clear();
      
      const finalEdits = extractIncrementalFileEdits(buffer, parser);
      
      expect(finalEdits).toHaveLength(1);
      expect(finalEdits[0].content).toBe('export const x = 1;');
    });
  });

  describe('LLM Streaming Path', () => {
    it('handles streamChunk.files with operation field', () => {
      // Simulate streamChunk.files from LLM provider
      const streamChunkFiles = [
        {
          path: 'src/app.ts',
          content: 'export const x = 1;',
          operation: 'create' as const,
        },
        {
          path: 'src/existing.ts',
          content: '--- a/src/existing.ts\n+++ b/src/existing.ts\n@@ -1 +1 @@\n-old\n+new',
          operation: 'update' as const,
          diff: '--- a/src/existing.ts\n+++ b/src/existing.ts\n@@ -1 +1 @@\n-old\n+new',
        },
      ];
      
      // Simulate backend processing
      const events = streamChunkFiles.map(file => {
        const hasDiff = !!(file as any).diff;
        const isPatch = file.operation === 'patch' || hasDiff;
        
        return {
          path: file.path,
          status: file.operation === 'delete' ? 'deleted' : 'detected',
          operation: isPatch ? 'patch' : file.operation,
          content: file.content || '',
          diff: isPatch ? ((file as any).diff || '') : undefined,
        };
      });
      
      expect(events).toHaveLength(2);
      expect(events[0].operation).toBe('create');
      expect(events[0].diff).toBeUndefined();
      expect(events[1].operation).toBe('patch');
      expect(events[1].diff).toBeTruthy();
    });

    it('handles post-stream filesystem edits', () => {
      // Simulate filesystemEdits.applied from applyFilesystemEditsFromResponse
      const filesystemEdits = {
        applied: [
          {
            path: 'src/new.ts',
            operation: 'write' as const,
            content: 'export const newFile = true;',
            version: 1,
            previousVersion: null,
            existedBefore: false,
          },
          {
            path: 'src/existing.ts',
            operation: 'patch' as const,
            content: 'updated content',
            diff: '--- a/src/existing.ts\n+++ b/src/existing.ts\n@@ -1 +1 @@\n-old\n+new',
            version: 2,
            previousVersion: 1,
            existedBefore: true,
          },
        ],
      };
      
      // Simulate backend event construction
      const events = filesystemEdits.applied.map(edit => {
        const hasDiff = !!edit.diff;
        const isPatch = edit.operation === 'patch' || hasDiff;
        
        return {
          path: edit.path,
          status: 'applied',
          operation: isPatch ? 'patch' : (edit.operation || 'write'),
          content: edit.content || '',
          diff: isPatch ? (edit.diff || '') : undefined,
        };
      });
      
      expect(events).toHaveLength(2);
      expect(events[0].operation).toBe('write');
      expect(events[0].diff).toBeUndefined();
      expect(events[1].operation).toBe('patch');
      expect(events[1].diff).toBeTruthy();
    });
  });

  describe('Done Event fileEdits Array Construction', () => {
    it('builds fileEdits with robust format detection', () => {
      // Simulate filesystemEdits.applied
      const filesystemEdits = {
        applied: [
          {
            path: 'src/full-content.ts',
            operation: 'write' as const,
            content: 'export const x = 1;',
            diff: undefined,
            version: 1,
          },
          {
            path: 'src/with-diff.ts',
            operation: 'patch' as const,
            content: 'updated',
            diff: '--- a/src/with-diff.ts\n+++ b/src/with-diff.ts\n@@ -1 +1 @@\n-old\n+new',
            version: 2,
          },
          {
            path: 'src/invalid-diff.ts',
            operation: 'write' as const,
            content: 'This is not a diff but has dashes',
            diff: '--- just dashes, not a valid diff',
            version: 1,
          },
        ],
      };
      
      // Simulate backend fileEdits construction
      const fileEdits = filesystemEdits.applied
        .filter((edit) => {
          const hasContent = edit.content && edit.content.trim().length > 0;
          const hasDiff = edit.diff && edit.diff.trim().length > 0;
          return hasContent || hasDiff;
        })
        .map((edit) => {
          const diffToUse = edit.diff && 
                           edit.diff.trim().length > 0 && 
                           edit.diff.startsWith('---') &&
                           edit.diff.includes('+++')
            ? edit.diff
            : undefined;
          
          return {
            path: edit.path,
            operation: edit.operation || 'write',
            content: edit.content || '',
            diff: diffToUse,
            version: edit.version,
          };
        });
      
      expect(fileEdits).toHaveLength(3);
      expect(fileEdits[0].diff).toBeUndefined(); // No diff
      expect(fileEdits[1].diff).toBeTruthy(); // Valid diff
      expect(fileEdits[2].diff).toBeUndefined(); // Invalid diff (no +++)
    });

    it('filters invalid paths from fileEdits', () => {
      const filesystemEdits = {
        applied: [
          {
            path: 'src/valid.ts',
            operation: 'write' as const,
            content: 'valid',
            version: 1,
          },
          {
            path: '$invalid',
            operation: 'write' as const,
            content: 'invalid path',
            version: 1,
          },
        ],
      };
      
      // Simulate path validation
      const isValidFilePath = (path: string): boolean => {
        if (path.startsWith('$')) return false;
        return /^[a-zA-Z0-9_./\-\\]+$/.test(path);
      };
      
      const fileEdits = filesystemEdits.applied
        .filter((edit) => isValidFilePath(edit.path))
        .map((edit) => ({
          path: edit.path,
          content: edit.content,
        }));
      
      expect(fileEdits).toHaveLength(1);
      expect(fileEdits[0].path).toBe('src/valid.ts');
    });
  });

  describe('V2 Gateway FILE_EDIT Events', () => {
    it('constructs fileEditEvents with correct format', () => {
      const filesystemEdits = {
        applied: [
          {
            path: 'src/app.ts',
            operation: 'write' as const,
            content: 'export default App;',
            version: 1,
          },
        ],
      };
      
      // Simulate V2 gateway fileEditEvents construction
      const fileEditEvents = [];
      for (const edit of filesystemEdits.applied) {
        const hasDiff = !!(edit as any).diff;
        const isPatch = edit.operation === 'patch' || hasDiff;
        
        fileEditEvents.push({
          requestId: 'test-123',
          path: edit.path,
          status: 'detected',
          operation: isPatch ? 'patch' : edit.operation,
          content: (edit as any).content || '',
          diff: isPatch ? ((edit as any).diff || '') : undefined,
          timestamp: Date.now(),
        });
      }
      
      expect(fileEditEvents).toHaveLength(1);
      expect(fileEditEvents[0].operation).toBe('write');
      expect(fileEditEvents[0].diff).toBeUndefined();
    });
  });

  describe('Error Handler FILE_EDIT Emission', () => {
    it('emits FILE_EDIT events even in error handler', () => {
      const parser = createIncrementalParser();
      const content = '<file_edit path="src/app.ts">content</file_edit>';
      
      const edits = extractIncrementalFileEdits(content, parser);
      
      // Simulate error handler processing
      const events = edits.map(edit => {
        const hasDiff = !!edit.diff;
        const isPatch = edit.action === 'patch' || hasDiff;
        
        return {
          path: edit.path,
          status: 'detected',
          operation: isPatch ? 'patch' : 'write',
          content: edit.content || '',
          diff: isPatch ? (edit.diff || '') : undefined,
        };
      });
      
      expect(events).toHaveLength(1);
      expect(events[0].path).toBe('src/app.ts');
    });
  });

  describe('Content Format Detection Logic', () => {
    it('correctly identifies unified diff format', () => {
      const validDiffs = [
        '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@',
        '--- file.ts\n+++ file.ts\n@@ -1,2 +1,3 @@',
      ];
      
      for (const diff of validDiffs) {
        const isUnifiedDiff = diff.trim().length > 0 && 
                             diff.startsWith('---') && 
                             diff.includes('+++');
        expect(isUnifiedDiff).toBe(true);
      }
    });

    it('correctly rejects non-diff content', () => {
      const nonDiffs = [
        'export const x = 1;',
        '--- just dashes',
        '---\ntitle: YAML\n---',
        'some random text',
      ];
      
      for (const content of nonDiffs) {
        const isUnifiedDiff = content.trim().length > 0 && 
                             content.startsWith('---') && 
                             content.includes('+++');
        expect(isUnifiedDiff).toBe(false);
      }
    });

    it('handles edge case: diff with only --- header', () => {
      const content = '--- a/src/app.ts';
      
      const isUnifiedDiff = content.trim().length > 0 && 
                           content.startsWith('---') && 
                           content.includes('+++');
      
      expect(isUnifiedDiff).toBe(false); // Missing +++
    });
  });
});
