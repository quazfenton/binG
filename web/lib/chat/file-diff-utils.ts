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

import { parsePatch, applyPatch, createTwoFilesPatch } from 'diff';
import diff_match_patch from 'diff-match-patch';

export interface DiffEdit {
  path: string;
  diff: string;
}

/**
 * Apply unified diff to content with robust error handling
 */
export function applyUnifiedDiffToContent(currentContent: string, path: string, diffBody: string): string | null {
  if (!diffBody || diffBody.trim().length === 0) {
    return null;
  }

  const diffText = diffBody.endsWith("\n") ? diffBody : `${diffBody}\n`;
  const hasHeaders = diffText.includes("--- ") && diffText.includes("+++ ");
  const unifiedDiff = hasHeaders
    ? diffText
    : `--- ${path}\n+++ ${path}\n${diffText}`;
  
  try {
    const parsed = parsePatch(unifiedDiff);
    if (!parsed || !parsed.length) {
      console.warn('[applyUnifiedDiffToContent] parsePatch returned no results');
      return null;
    }
    
    const patch = parsed[0];
    
    // Validate patch has required hunks
    if (!patch.hunks || !patch.hunks.length) {
      console.warn('[applyUnifiedDiffToContent] No hunks in patch');
      return null;
    }
    
    const patched = applyPatch(currentContent, patch);
    if (patched === false) {
      console.warn('[applyUnifiedDiffToContent] applyPatch returned false - diff may not match content');
      return null;
    }
    
    return patched;
  } catch (error: any) {
    // More detailed error logging for debugging
    console.error('[applyUnifiedDiffToContent] Failed to apply unified diff:', {
      error: error.message,
      path,
      diffLength: diffBody.length,
      contentLength: currentContent.length,
      hasHeaders,
      stack: error.stack,
    });
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
  
  // Parse diff lines preserving the diff marker prefix
  const diffLines = diffBody.split("\n");
  if (!diffLines.length) return null;

  const resultLines: string[] = [];
  for (const line of diffLines) {
    // CRITICAL FIX: Check raw prefix first before any trimming
    // This prevents misclassifying context lines that start with + or -
    if (line.startsWith("+ ")) {
      // Added line - keep content without the marker
      resultLines.push(line.slice(2));
    } else if (line.startsWith("- ")) {
      // Removed line - skip it
      continue;
    } else if (line.startsWith("  ")) {
      // Context line (starts with exactly two spaces) - preserve content
      resultLines.push(line.slice(2));
    }
  }
  
  const result = resultLines.join("\n");
  if (!result) return null;
  if (result === currentContent) {
    return currentContent;
  }
  return result;
}

/**
 * Apply diff using Google's diff-match-patch library (more robust fuzzy matching)
 * This library can handle diffs even when context lines don't match exactly
 */
export function applyDiffMatchPatch(currentContent: string, diffBody: string): string | null {
  try {
    const dmp = new diff_match_patch();
    
    // Parse the diff text
    const diffs = dmp.patch_fromText(diffBody);
    
    if (!diffs || diffs.length === 0) {
      return null;
    }
    
    // Apply patches with fuzzy matching
    // diff-match-patch can handle minor mismatches in context lines
    const [result, successes] = dmp.patch_apply(diffs, currentContent);
    
    // Check if all patches were applied successfully
    // If some failed, still return result if at least one succeeded
    const allSuccess = successes.every(s => s);
    
    if (!allSuccess) {
      console.warn('[applyDiffMatchPatch] Some patches failed to apply', {
        totalPatches: diffs.length,
        successfulPatches: successes.filter(s => s).length,
        failedPatches: successes.filter(s => !s).length,
        diffPreviewLength: Math.min(diffBody.length, 200),
      });
      
      // If more than half failed, reject the diff
      if (successes.filter(s => !s).length > successes.length / 2) {
        return null;
      }
    }
    
    // Verify result is not empty unless original was empty
    if (result.trim().length === 0 && currentContent.trim().length > 0) {
      console.warn('[applyDiffMatchPatch] Result would empty non-empty file, rejecting');
      return null;
    }
    
    return result;
  } catch (error: any) {
    console.error('[applyDiffMatchPatch] Failed:', {
      error: error.message,
      diffLength: diffBody.length,
      contentLength: currentContent.length,
      diffPreviewLength: Math.min(diffBody.length, 200),
    });
    return null;
  }
}

/**
 * Apply a diff/edit to content, trying multiple strategies with robust error handling
 * Returns the new content, or null if all strategies fail
 *
 * IMPROVED: Now handles both diff format AND full file content from LLM responses
 */
export function applyDiffToContent(currentContent: string, path: string, diffBody: string): string | null {
  // CRITICAL FIX: Reject empty diffs immediately to prevent infinite loops
  if (!diffBody || diffBody.trim().length === 0) {
    console.debug('[applyDiffToContent] Empty diff body - skipping (prevents infinite loop)');
    return null;
  }

  // Check if this looks like full file content (not a diff)
  const lines = diffBody.split('\n');
  const hasRealDiffMarkers = lines.some(line =>
    line.startsWith('+') || line.startsWith('-')
  );
  const hasUnifiedDiffHeader = lines.some(line =>
    line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@ ')
  );
  const isLikelyFullFileContent = !hasRealDiffMarkers && !hasUnifiedDiffHeader;

  // STRATEGY 0: If content looks like a complete file, use it directly
  // This handles LLM responses that send full file content instead of diffs
  if (isLikelyFullFileContent && looksLikeCompleteFile(diffBody)) {
    console.log('[applyDiffToContent] Content appears to be full file, using directly', {
      path,
      contentLength: diffBody.length,
    });
    return diffBody;
  }

  // SAFETY CHECK: Reject if diffBody has no diff markers AND doesn't look like a complete file
  // This prevents accidental overwrites from malformed content
  if (!hasRealDiffMarkers && !hasUnifiedDiffHeader && diffBody.length > 100 && !looksLikeCompleteFile(diffBody)) {
    // Long content with no diff markers and no file structure - likely malformed
    console.warn('[applyDiffToContent] Content appears malformed (no diff markers, not recognizable file), rejecting for safety', {
      path,
      diffPreviewLength: Math.min(diffBody.length, 200),
    });
    return null;
  }

  // Strategy 1: Try unified diff format (most reliable for proper diffs)
  const unifiedResult = applyUnifiedDiffToContent(currentContent, path, diffBody);
  if (unifiedResult !== null) {
    // SAFETY CHECK 2: Verify result is not empty unless original was empty
    if (unifiedResult.trim().length === 0 && currentContent.trim().length > 0) {
      console.warn('[applyDiffToContent] Unified diff would empty non-empty file, rejecting', {
        path,
        diffPreviewLength: Math.min(diffBody.length, 200),
      });
      return null;
    }
    return unifiedResult;
  }

  // Strategy 2: Try diff-match-patch (fuzzy matching for imperfect diffs)
  const dmpResult = applyDiffMatchPatch(currentContent, diffBody);
  if (dmpResult !== null) {
    // SAFETY CHECK 3: Verify result is not empty unless original was empty
    if (dmpResult.trim().length === 0 && currentContent.trim().length > 0) {
      console.warn('[applyDiffToContent] diff-match-patch would empty non-empty file, rejecting', {
        path,
        diffPreviewLength: Math.min(diffBody.length, 200),
      });
      return null;
    }
    return dmpResult;
  }

  // Strategy 3: Try simple line-based diff (fallback for simple +/- format)
  const lineDiffResult = applySimpleLineDiff(currentContent, diffBody);
  if (lineDiffResult !== null) {
    // SAFETY CHECK 4: Verify result is not empty unless original was empty
    if (lineDiffResult.trim().length === 0 && currentContent.trim().length > 0) {
      console.warn('[applyDiffToContent] Line diff would empty non-empty file, rejecting', {
        path,
        diffPreviewLength: Math.min(diffBody.length, 200),
      });
      return null;
    }
    return lineDiffResult;
  }

  // All strategies failed - DO NOT fall back to full file replacement
  // This is intentional for safety - better to fail than corrupt files
  console.error('[applyDiffToContent] All diff application strategies failed (safely rejected)', {
    path,
    diffLength: diffBody.length,
    contentLength: currentContent.length,
    hasRealDiffMarkers,
    diffPreviewLength: Math.min(diffBody.length, 200),
  });

  return null;
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
