/**
 * File Diff Utilities
 * 
 * PURPOSE: Apply parsed diffs/edit content to existing file content.
 * This module handles the math of applying changes - it does NOT parse
 * LLM text or write to VFS/sandbox.
 * 
 * ARCHITECTURE LAYER: Diff Application (structured commands → modified content)
 * 
 * USE CASES:
 * - UI Preview (conversation-interface.tsx): Applies diffs locally for preview
 *   in the filesystem tree before actual write operations
 * 
 * NOT THIS MODULE'S JOB:
 * - tool-executor.ts: Server-side application to sandbox/VFS with search/replace
 * - safe-diff-operations.ts: Enterprise validation with backup/rollback/conflict detection
 *   (2,300+ lines of advanced features, 59% test pass rate, not wired in)
 * 
 * These are DIFFERENT modules for DIFFERENT purposes:
 * 1. file-edit-parser.ts → Parse LLM text (extract commands)
 * 2. file-diff-utils.ts → Apply parsed diffs to content (UI preview only)
 * 3. tool-executor.ts → Apply structured diffs to VFS/sandbox (server execution)
 * 4. safe-diff-operations.ts → Enterprise validation (not wired in, 59% tests passing)
 */

import { parsePatch, applyPatch } from 'diff';

export interface DiffEdit {
  path: string;
  diff: string;
}

/**
 * Apply unified diff to content
 */
export function applyUnifiedDiffToContent(currentContent: string, path: string, diffBody: string): string | null {
  const diffText = diffBody.endsWith("\n") ? diffBody : `${diffBody}\n`;
  const hasHeaders = diffText.includes("--- ") && diffText.includes("+++ ");
  const unifiedDiff = hasHeaders
    ? diffText
    : `--- ${path}\n+++ ${path}\n${diffText}`;
  try {
    const parsed = parsePatch(unifiedDiff);
    if (!parsed.length) return null;
    const patched = applyPatch(currentContent, parsed[0]);
    return patched === false ? null : patched;
  } catch (error) {
    console.error('Failed to apply unified diff:', error);
    return null;
  }
}

/**
 * Check if content looks like full file content (not a diff)
 * Full file content typically doesn't have diff markers (+ or -)
 */
export function isFullFileContent(content: string): boolean {
  const lines = content.split('\n');
  return !lines.some(line => /^[\s]*[+-]/.test(line));
}

/**
 * Apply simple line-based diff to content
 * Handles both diffs (+/- markers) and full file content
 */
export function applySimpleLineDiff(currentContent: string, diffBody: string): string | null {
  // Check if this looks like full file content (not a diff)
  if (isFullFileContent(diffBody)) {
    // No diff markers - treat as full content
    if (!currentContent || currentContent.trim().length === 0) {
      return diffBody;
    }
    // Existing content but no diff markers - might be overwrite
    return diffBody;
  }
  
  // For new files (empty content), still try to apply the diff as it may contain the full file content
  // Only skip if there's existing content that would be overwritten
  if (currentContent && currentContent.trim().length > 0) {
    // Still try to apply - the diff might be for modifying existing content
  }
  const diffLines = diffBody
    .split("\n")
    .filter((l) => /^(\+\s|\-\s|\s\s)/.test(l.trimStart()))
    .map((l) => l.replace(/^\s+/, ""));
  if (!diffLines.length) return null;
  const resultLines: string[] = [];
  for (const line of diffLines) {
    if (line.startsWith("+ ")) {
      resultLines.push(line.slice(2));
    } else if (line.startsWith("- ")) {
      continue;
    } else if (line.startsWith("  ")) {
      resultLines.push(line.slice(2));
    }
  }
  const result = resultLines.join("\n");
  return result && result !== currentContent ? result : null;
}

/**
 * Apply a diff/edit to content, trying multiple strategies
 * Returns the new content, or null if all strategies fail
 */
export function applyDiffToContent(currentContent: string, path: string, diffBody: string): string | null {
  return (
    applyUnifiedDiffToContent(currentContent, path, diffBody) ??
    applySimpleLineDiff(currentContent, diffBody)
  );
}

/**
 * Check if content appears to be a complete file that should be written directly
 */
export function looksLikeCompleteFile(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  
  const lines = content.split('\n');
  
  // Check for structural patterns
  const hasImports = lines.some(l => l.trimStart().startsWith('import ') || l.trimStart().startsWith('from '));
  const hasExports = lines.some(l => l.trimStart().startsWith('export '));
  const hasDoctype = content.toLowerCase().includes('<!doctype') || content.toLowerCase().includes('<html');
  const hasFunction = lines.some(l => /\bfunction\s+\w+/.test(l) || /\bdef\s+\w+/.test(l) || /\bclass\s+\w+/.test(l));
  const hasPackageJson = content.includes('"name"') && content.includes('"version"');
  
  // If it has structural patterns typical of complete files, treat as full content
  if (hasImports || hasExports || hasDoctype || hasFunction || hasPackageJson) {
    return true;
  }
  
  // Check for lack of diff markers (most reliable indicator)
  return isFullFileContent(content);
}
