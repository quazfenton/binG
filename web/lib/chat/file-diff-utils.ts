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
import { withRetry, isRetryableError } from '@/lib/vector-memory/retry';

export interface DiffEdit {
  path: string;
  diff: string;
}

/**
 * Result of a smart patch application with metadata
 */
export interface PatchResult {
  content: string | null;
  strategy: 'unified' | 'fuzzy' | 'line' | 'symbol' | 'repaired' | 'full_file';
  confidence: number;
  attempts?: number;
}

/**
 * Symbol context for structure-aware patching
 */
export interface SymbolContext {
  name: string;
  kind: 'function' | 'class' | 'method' | 'block';
  startLine: number;
  endLine: number;
}

/**
 * LLM caller for the diff repair loop.
 * Consumers wire in their own LLM call (e.g. llmService.generateResponse)
 * so this module stays free of hard provider coupling.
 */
export type DiffRepairLLM = (prompt: string) => Promise<string>;

/**
 * Parse and apply diff result to content
 * Takes current content and diff body, returns applied result
 */
/**
 * Parse and apply diff result to content.
 *
 * CRITICAL: When diffBody contains unified diff markers (+/-/@@) but no
 * ---/+++ headers, `applyDiffToContent` will generate `--- path` / `+++ path`
 * headers. An empty path produces `--- \n+++ \n` which breaks `parsePatch`.
 * We use a sentinel path so the generated headers are valid.
 */
export function parseDiffResult(currentContent: string, diffBody: string): string | null {
  // Handle empty diff body
  if (!diffBody || diffBody.trim().length === 0) {
    return currentContent;
  }
  
  // Check if diffBody contains unified diff markers
  const lines = diffBody.split('\n');
  const hasDiffMarkers = lines.some(line => 
    line.startsWith('+') || line.startsWith('-') || line.startsWith('@@')
  );
  
  if (!hasDiffMarkers) {
    // No diff markers - might be full content, return as-is
    return diffBody;
  }
  
  // Use a sentinel path so generated ---/+++ headers are well-formed
  // (applyDiffToContent prepends headers when they're missing)
  const result = applyDiffToContent(currentContent, '__parsed_diff__', diffBody);
  return result;
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

// ============================================================================
// Symbol-based patching
// ============================================================================

/**
 * Apply a patch by replacing a symbol's line range in the original content.
 * Falls back gracefully if the symbol range is out of bounds.
 */
export function applySymbolPatch(
  content: string,
  symbol: SymbolContext,
  newCode: string
): string | null {
  const lines = content.split('\n');

  if (symbol.startLine < 0 || symbol.endLine >= lines.length) {
    console.warn('[applySymbolPatch] Symbol range out of bounds', {
      symbol: symbol.name,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      totalLines: lines.length,
    });
    return null;
  }

  const before = lines.slice(0, symbol.startLine);
  const after = lines.slice(symbol.endLine + 1);

  const result = [...before, newCode, ...after].join('\n');

  if (result.trim().length === 0 && content.trim().length > 0) {
    return null;
  }

  return result;
}

/**
 * Extract the "added" code from a unified diff (lines starting with +, excluding header).
 */
export function extractAddedCode(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

// ============================================================================
// LLM Response Extraction
// ============================================================================

/**
 * Extract file writes from bash/code blocks in LLM responses.
 * Handles echo, cat heredocs, unified diffs, Before/After blocks,
 * and code blocks with filename hints.
 *
 * CRITICAL: For diff patterns, matches ONLY the AFTER/CHANGED section,
 * never the "before applying the diff" original content block.
 */
export function extractFileWritesFromLLMResponse(
  content: string,
  options: { scopePath?: string } = {}
): Array<{ path: string; content: string }> {
  const writes: Array<{ path: string; content: string }> = [];
  const scopePath = options.scopePath || 'project';

  // Pattern 1: echo "content" > file or echo 'content' > file in bash blocks
  const bashBlockPattern = /```(?:bash|sh|shell)\s*\n([\s\S]*?)```/gi;
  let bashBlockMatch;
  while ((bashBlockMatch = bashBlockPattern.exec(content)) !== null) {
    const blockContent = bashBlockMatch[1];
    const echoPattern = /echo\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*>\s*([^\s\n;&|>]+)/gi;
    let echoMatch;
    while ((echoMatch = echoPattern.exec(blockContent)) !== null) {
      const fileContent = echoMatch[1] ?? echoMatch[2] ?? '';
      let filePath = echoMatch[3].trim();
      if (!filePath.startsWith('project/') && !filePath.startsWith('/')) {
        filePath = `${scopePath}/${filePath}`;
      }
      filePath = filePath.replace(/^\/+/, '');
      if (filePath && fileContent) {
        writes.push({ path: filePath, content: fileContent });
      }
    }
    // cat heredoc: cat > file << 'EOF'\ncontent\nEOF
    const catPattern = /cat\s*>\s*([^\s\n>]+)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\2/gi;
    let catMatch;
    while ((catMatch = catPattern.exec(blockContent)) !== null) {
      let filePath = catMatch[1].trim();
      const fileContent = catMatch[3].trim();
      if (!filePath.startsWith('project/') && !filePath.startsWith('/')) {
        filePath = `${scopePath}/${filePath}`;
      }
      filePath = filePath.replace(/^\/+/, '');
      if (filePath && fileContent) {
        writes.push({ path: filePath, content: fileContent });
      }
    }
  }

  // Pattern 2: Unified diff blocks (```diff ... --- a/path +++ b/path ...)
  const diffBlockPattern = /```(?:diff|patch)?\s*\n---\s*a\/([^\n]+)\n\+\+\+\s*b\/([^\n]+)\n@@[\s\S]*?```/gi;
  let diffMatch;
  while ((diffMatch = diffBlockPattern.exec(content)) !== null) {
    let filePath = diffMatch[2].trim();
    if (!filePath.startsWith('project/') && !filePath.startsWith('/')) {
      filePath = `${scopePath}/${filePath}`;
    }
    filePath = filePath.replace(/^\/+/, '');
    const fullDiffMatch = diffMatch[0];
    const addedLines = fullDiffMatch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n');
    if (filePath && addedLines) {
      writes.push({ path: filePath, content: addedLines });
    }
  }

  // Pattern 2b: AFTER/RESULT code blocks from diff responses
  // CRITICAL: These phrases ONLY appear in the AFTER section, never BEFORE.
  const diffApplyPatterns = [
    // "**After:**\n```" (Before/After blocks)
    /\*\*After:\*\*\s*\n```\w*\s*\n([\s\S]*?)```/gi,
    // "the file will contain:\n```" (ONLY in AFTER section)
    /the\s+file\s+will\s+contain[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi,
    // "the content becomes:\n```" (ONLY in AFTER section)
    /the\s+content\s+becomes[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi,
    // "(changed content):\n```" (ONLY after "After applying the diff")
    /\(changed\s+content\)[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi,
    // "Here's the result after applying the diff:\n```"
    /here['']?s?\s+(?:the\s+)?result\s+after\s+applying\s+(?:the\s+)?diff[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi,
    // "the result is:\n```" (ONLY in AFTER section)
    /the\s+result\s+is[\s:]*\n```\w*\s*\n([\s\S]*?)```/gi,
  ];
  for (const diffApplyPattern of diffApplyPatterns) {
    let diffApplyMatch;
    while ((diffApplyMatch = diffApplyPattern.exec(content)) !== null) {
      const fileContent = diffApplyMatch[1].trim();
      const pathMatch = content.match(/[`'"]?(project\/[\w\-\/]+\.[\w]+)[`'"]?/i);
      if (pathMatch && fileContent && fileContent.length > 3) {
        let filePath = pathMatch[1].trim();
        if (!filePath.startsWith('project/') && !filePath.startsWith('/')) {
          filePath = `${scopePath}/${filePath}`;
        }
        filePath = filePath.replace(/^\/+/, '');
        writes.push({ path: filePath, content: fileContent });
        break;
      }
    }
    if (writes.length > 0) break;
  }

  // Pattern 3: Code blocks with file path hints (```file: path or ```path/to/file)
  const codeWithFilePattern = /```\w*\s*(?:file:\s*)?([^\s\n]+)\s*\n([\s\S]*?)```/gi;
  let codeFileMatch;
  while ((codeFileMatch = codeWithFilePattern.exec(content)) !== null) {
    const pathHint = codeFileMatch[1].trim();
    const isFilePath = pathHint.includes('/') || /\.(js|ts|tsx|jsx|py|html|css|json|md|txt|sh|bash)$/i.test(pathHint);
    if (isFilePath && !pathHint.startsWith('bash') && !pathHint.startsWith('sh') && !pathHint.startsWith('javascript') && !pathHint.startsWith('python') && !pathHint.startsWith('diff')) {
      let filePath = pathHint;
      const fileContent = codeFileMatch[2].trim();
      if (!filePath.startsWith('project/') && !filePath.startsWith('/')) {
        filePath = `${scopePath}/${filePath}`;
      }
      filePath = filePath.replace(/^\/+/, '');
      if (filePath && fileContent && fileContent.length > 5) {
        writes.push({ path: filePath, content: fileContent });
      }
    }
  }

  // Pattern 4: JavaScript fs.writeFileSync calls
  const jsBlockPattern = /```(?:javascript|js|node|typescript|ts)\s*\n([\s\S]*?)```/gi;
  let jsBlockMatch;
  while ((jsBlockMatch = jsBlockPattern.exec(content)) !== null) {
    const blockContent = jsBlockMatch[1];
    const fsWritePattern = /fs\.writeFileSync\(\s*(?:path\.join\([^)]*,\s*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])\s*,\s*['"]((?:[^"\\]|\\.)*)['"]/gi;
    let fsMatch;
    while ((fsMatch = fsWritePattern.exec(blockContent)) !== null) {
      let filePath = (fsMatch[1] ?? fsMatch[2] ?? '').trim();
      const fileContent = fsMatch[3] ?? '';
      if (filePath && fileContent) {
        if (!filePath.startsWith('project/') && !filePath.startsWith('/')) {
          filePath = `${scopePath}/${filePath}`;
        }
        filePath = filePath.replace(/^\/+/, '');
        writes.push({ path: filePath, content: fileContent });
      }
    }
  }

  // Pattern 5: Python file writes
  const pyBlockPattern = /```(?:python|py)\s*\n([\s\S]*?)```/gi;
  let pyBlockMatch;
  while ((pyBlockMatch = pyBlockPattern.exec(content)) !== null) {
    const blockContent = pyBlockMatch[1];
    const pyWritePattern = /with\s+open\(\s*['"]([^'"]+)['"][\s\S]*?\.write\(\s*['"]((?:[^"\\]|\\.)*)['"]\)/gi;
    let pyMatch;
    while ((pyMatch = pyWritePattern.exec(blockContent)) !== null) {
      let filePath = pyMatch[1].trim();
      const fileContent = pyMatch[2] ?? '';
      if (filePath && fileContent) {
        if (!filePath.startsWith('project/') && !filePath.startsWith('/')) {
          filePath = `${scopePath}/${filePath}`;
        }
        filePath = filePath.replace(/^\/+/, '');
        writes.push({ path: filePath, content: fileContent });
      }
    }
  }

  // Deduplicate by path (keep last write for each path)
  const deduped = new Map<string, { path: string; content: string }>();
  for (const w of writes) deduped.set(w.path, w);
  return Array.from(deduped.values());
}

/**
 * Attempt to repair a broken diff by asking an LLM to fix it.
 * The `llm` parameter is an injected caller so the module stays decoupled.
 */
export async function repairDiff(opts: {
  original: string;
  diff: string;
  path: string;
  llm: DiffRepairLLM;
  maxAttempts?: number;
}): Promise<PatchResult> {
  const { original, diff, path, llm, maxAttempts = 3 } = opts;

  const repairPrompt = [
    'The following unified diff failed to apply to the file.',
    'Fix the diff so it applies cleanly. Return ONLY a valid unified diff, nothing else.',
    '',
    `File: ${path}`,
    '',
    '--- Original ---',
    original.length > 6000 ? original.slice(0, 6000) + '\n…(truncated)' : original,
    '',
    '--- Broken Diff ---',
    diff,
  ].join('\n');

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const fixedDiff = await llm(repairPrompt);
      if (!fixedDiff || fixedDiff.trim().length === 0) continue;

      const result = applyDiffToContent(original, path, fixedDiff);
      if (result !== null) {
        return {
          content: result,
          strategy: 'repaired',
          confidence: 0.7 - attempt * 0.1,
          attempts: attempt + 1,
        };
      }
    } catch (error) {
      console.warn(`[repairDiff] Attempt ${attempt + 1} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { content: null, strategy: 'repaired', confidence: 0, attempts: maxAttempts };
}

// ============================================================================
// Smart apply — hybrid strategy with confidence metadata
// ============================================================================

// ============================================================================
// LLM Response Extraction
// ============================================================================

export interface FileWrite {
  path: string;
  content: string;
}

export async function smartApply(opts: {
  content: string;
  path: string;
  diff: string;
  symbolContext?: SymbolContext;
  llm?: DiffRepairLLM;
}): Promise<PatchResult> {
  const { content, path, diff, symbolContext, llm } = opts;

  if (!diff || diff.trim().length === 0) {
    return { content: null, strategy: 'unified', confidence: 0 };
  }

  // Strategy 0: full-file content
  if (looksLikeCompleteFile(diff)) {
    return { content: diff, strategy: 'full_file', confidence: 0.95 };
  }

  // Strategy 1: unified diff
  const unified = applyUnifiedDiffToContent(content, path, diff);
  if (unified !== null && unified.trim().length > 0) {
    return { content: unified, strategy: 'unified', confidence: 0.95 };
  }

  // Strategy 2: fuzzy diff-match-patch
  const fuzzy = applyDiffMatchPatch(content, diff);
  if (fuzzy !== null && fuzzy.trim().length > 0) {
    return { content: fuzzy, strategy: 'fuzzy', confidence: 0.8 };
  }

  // Strategy 3: simple line diff
  const lineDiff = applySimpleLineDiff(content, diff);
  if (lineDiff !== null && lineDiff.trim().length > 0) {
    return { content: lineDiff, strategy: 'line', confidence: 0.6 };
  }

  // Strategy 4: symbol-based patching
  if (symbolContext) {
    const newCode = extractAddedCode(diff);
    if (newCode.trim().length > 0) {
      const symbolResult = applySymbolPatch(content, symbolContext, newCode);
      if (symbolResult !== null) {
        return { content: symbolResult, strategy: 'symbol', confidence: 0.7 };
      }
    }
  }

  // Strategy 5: LLM repair loop
  if (llm) {
    const repaired = await repairDiff({
      original: content,
      diff,
      path,
      llm,
    });
    if (repaired.content !== null) {
      return repaired;
    }
  }

  return { content: null, strategy: 'unified', confidence: 0 };
}
