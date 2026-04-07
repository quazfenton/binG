import { describe, expect, it } from 'vitest';

import {
  createIncrementalParser,
  extractReasoningContent,
  extractIncrementalFileEdits,
  parseFilesystemResponse,
  sanitizeAssistantDisplayContent,
  extractAndSanitize,
} from '@/lib/chat/file-edit-parser';

describe('file-edit-parser incremental parsing', () => {
  it('detects a file edit that spans multiple streamed chunks', () => {
    const parser = createIncrementalParser();
    const chunks = [
      'Intro text\n<file_edit path="src/app.ts">',
      "export const answer = 'hello';",
      '\n</file_edit>\nTrailing text',
    ];

    const seen = [];
    let buffer = '';

    for (const chunk of chunks) {
      buffer += chunk;
      seen.push(...extractIncrementalFileEdits(buffer, parser));
    }

    expect(seen).toEqual([
      {
        path: 'src/app.ts',
        content: "export const answer = 'hello';",
      },
    ]);
  });

  it('does not re-emit the same edit when later chunks extend the buffer', () => {
    const parser = createIncrementalParser();
    let buffer = '<file_edit path="src/app.ts">x</file_edit>';

    const firstPass = extractIncrementalFileEdits(buffer, parser);
    buffer += '\nMore assistant text after the edit.';
    const secondPass = extractIncrementalFileEdits(buffer, parser);

    expect(firstPass).toHaveLength(1);
    expect(secondPass).toEqual([]);
  });

  it('sanitizes assistant display content using the shared parser rules', () => {
    const content = [
      'Here is the result.',
      '```fs-actions',
      'WRITE src/app.ts',
      '<<<',
      "console.log('x')",
      '>>>',
      '```',
      '[CONTINUE_REQUESTED]',
    ].join('\n');

    expect(sanitizeAssistantDisplayContent(content)).toBe('Here is the result.');
  });

  it('extracts reasoning sections from shared assistant content formats', () => {
    const content = [
      '<think>first pass</think>',
      '**Reasoning:**second pass',
      '**Thought:**third pass',
      'Visible answer',
    ].join('\n\n');

    expect(extractReasoningContent(content)).toEqual({
      reasoning: ['first pass', '**Reasoning:**second pass', '**Thought:**third pass'].join('\n\n'),
      mainContent: 'Visible answer',
    });
  });

  it('parses large filesystem operations without truncating at 5000 chars', () => {
    const largeChunk = 'a'.repeat(7000);
    const content = [
      '```fs-actions',
      'WRITE src/large.txt',
      '<<<',
      largeChunk,
      '>>>',
      'PATCH src/patch.txt',
      '<<<',
      largeChunk,
      '>>>',
      'APPLY_DIFF src/edit.txt',
      '<<<',
      largeChunk,
      '===',
      `${largeChunk}b`,
      '>>>',
      'DELETE src/old.txt',
      '```',
    ].join('\n');

    const parsed = parseFilesystemResponse(content);

    expect(parsed.writes.find(edit => edit.path === 'src/large.txt')?.content).toBe(largeChunk);
    expect(parsed.diffs.find(edit => edit.path === 'src/patch.txt')?.diff).toBe(largeChunk);
    expect(parsed.applyDiffs.find(edit => edit.path === 'src/edit.txt')?.search).toBe(largeChunk);
    expect(parsed.deletes).toContain('src/old.txt');
  });
});

describe('extractAndSanitize', () => {
  it('extracts file edits and sanitizes content in one pass', () => {
    const content = [
      'Here is the file.',
      '<file_edit path="src/app.ts">',
      "export const x = 1;",
      '</file_edit>',
    ].join('\n');

    const result = extractAndSanitize(content);

    expect(result.edits.writes).toHaveLength(1);
    expect(result.edits.writes[0].path).toBe('src/app.ts');
    expect(result.edits.writes[0].content).toBe("export const x = 1;");
    // Sanitizer removes file_edit tags and trims
    expect(result.sanitized).toBe('Here is the file.');
  });

  it('strips heredoc markers from extracted content', () => {
    const content = [
      'Writing file...',
      '```fs-actions',
      'WRITE src/test.py',
      '<<<',
      "print('hello')",
      '>>>',
      '```',
    ].join('\n');

    const result = extractAndSanitize(content);

    // Content should be extracted with heredoc markers stripped
    const writeEdit = result.edits.writes.find(e => e.path === 'src/test.py');
    expect(writeEdit).toBeDefined();
    expect(writeEdit?.content).toBe("print('hello')");
    // Sanitized content should remove the entire fs-actions block
    expect(result.sanitized).toBe('Writing file...');
  });

  it('handles empty content gracefully', () => {
    const result = extractAndSanitize('');

    expect(result.edits.writes).toEqual([]);
    expect(result.edits.diffs).toEqual([]);
    expect(result.edits.deletes).toEqual([]);
    expect(result.sanitized).toBe('');
  });

  it('preserves prose while removing file edit tags', () => {
    const content = [
      'I created a new component for you.',
      '<file_edit path="src/Button.tsx">',
      'export const Button = () => <button>Click</button>;',
      '</file_edit>',
      'Let me know if you need changes.',
    ].join('\n');

    const result = extractAndSanitize(content);

    expect(result.edits.writes).toHaveLength(1);
    expect(result.sanitized).toContain('I created a new component for you.');
    expect(result.sanitized).toContain('Let me know if you need changes.');
    expect(result.sanitized).not.toContain('<file_edit');
  });

  it('respects forceExtract parameter for incremental parsing', () => {
    const content = '<file_edit path="src/app.ts">const x = 1;</file_edit>';

    // Without forceExtract, should still extract
    const result = extractAndSanitize(content, true);
    expect(result.edits.writes).toHaveLength(1);
  });
});
