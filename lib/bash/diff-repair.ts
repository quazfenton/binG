/**
 * Diff-Based Command Repair
 *
 * Minimal, targeted patches for bash command fixes.
 * Instead of full rewrites, applies surgical edits.
 *
 * @module bash/diff-repair
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Bash:DiffRepair');

export interface CommandPatch {
  type: 'replace' | 'insert' | 'delete';
  target: string;
  value?: string;
}

export interface CommandDiff {
  original: string;
  patched: string;
  patches: CommandPatch[];
  confidence: number;
  explanation?: string;
}

/**
 * Apply diff patches to a command
 */
export function applyDiff(command: string, diff: CommandDiff): string {
  let result = command;
  
  for (const patch of diff.patches) {
    switch (patch.type) {
      case 'replace':
        result = result.replace(patch.target, patch.value!);
        break;
      case 'insert':
        result += ` ${patch.value}`;
        break;
      case 'delete':
        result = result.replace(patch.target, '');
        break;
    }
  }
  
  return result;
}

/**
 * Generate minimal diff from original to fixed command
 */
export function generateMinimalDiff(
  original: string,
  fixed: string,
  explanation?: string
): CommandDiff {
  const patches: CommandPatch[] = [];
  
  // Simple word-based diff
  const originalWords = original.split(/\s+/);
  const fixedWords = fixed.split(/\s+/);
  
  const maxLength = Math.max(originalWords.length, fixedWords.length);
  
  for (let i = 0; i < maxLength; i++) {
    const orig = originalWords[i];
    const fix = fixedWords[i];
    
    if (orig === undefined) {
      // Insertion
      patches.push({
        type: 'insert',
        target: '',
        value: fix,
      });
    } else if (fix === undefined) {
      // Deletion
      patches.push({
        type: 'delete',
        target: orig,
      });
    } else if (orig !== fix) {
      // Replacement
      patches.push({
        type: 'replace',
        target: orig,
        value: fix,
      });
    }
  }
  
  // Calculate confidence based on change magnitude
  const changeRatio = patches.length / maxLength;
  const confidence = Math.max(0.3, 1 - changeRatio);
  
  return {
    original,
    patched: fixed,
    patches,
    confidence,
    explanation,
  };
}

/**
 * Validate that diff doesn't introduce dangerous patterns
 */
export function validateDiff(diff: CommandDiff): boolean {
  const dangerousPatterns = [
    'rm -rf /',
    'rm -rf /*',
    'shutdown',
    'reboot',
    'halt',
    ':(){ :|:& };:',
    'mkfs',
    'dd if=/dev/zero',
    'chmod -R 777 /',
    'chown -R root:root /',
    'wget.*\\|.*bash',
    'curl.*\\|.*bash',
    'rm.*--no-preserve-root',
  ];
  
  const patched = applyDiff(diff.original, diff);
  const lowerPatched = patched.toLowerCase();
  
  for (const pattern of dangerousPatterns) {
    if (new RegExp(pattern, 'i').test(lowerPatched)) {
      logger.error('Diff introduced dangerous pattern', {
        original: diff.original,
        patched,
        pattern,
      });
      return false;
    }
  }
  
  // Check for significant deviation (>50% change)
  const deviation = Math.abs(patched.length - diff.original.length) / diff.original.length;
  if (deviation > 0.5) {
    logger.warn('Diff introduces significant changes', {
      original: diff.original,
      patched,
      deviation,
    });
    return false;
  }
  
  return true;
}

/**
 * Parse LLM response to extract diff
 */
export function parseDiffResponse(response: string): CommandDiff | null {
  try {
    // Look for JSON in response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate structure
    if (!parsed.patches || !Array.isArray(parsed.patches)) {
      return null;
    }
    
    // Validate each patch
    for (const patch of parsed.patches) {
      if (!['replace', 'insert', 'delete'].includes(patch.type)) {
        return null;
      }
      if (!patch.target && patch.type !== 'insert') {
        return null;
      }
    }
    
    return {
      original: parsed.original || '',
      patched: parsed.patched || '',
      patches: parsed.patches,
      confidence: parsed.confidence || 0.5,
      explanation: parsed.explanation,
    };
  } catch (error: any) {
    logger.warn('Failed to parse diff response', { error: error.message });
    return null;
  }
}

/**
 * Merge multiple diffs into one
 */
export function mergeDiffs(diffs: CommandDiff[]): CommandDiff {
  if (diffs.length === 0) {
    throw new Error('Cannot merge empty diffs');
  }
  
  if (diffs.length === 1) {
    return diffs[0];
  }
  
  let current = diffs[0].patched;
  const allPatches = [...diffs[0].patches];
  
  for (let i = 1; i < diffs.length; i++) {
    const diff = diffs[i];
    
    // Apply patches relative to current state
    for (const patch of diff.patches) {
      allPatches.push(patch);
    }
    
    current = applyDiff(current, diff);
  }
  
  return {
    original: diffs[0].original,
    patched: current,
    patches: allPatches,
    confidence: diffs.reduce((sum, d) => sum + d.confidence, 0) / diffs.length,
    explanation: diffs.map(d => d.explanation).filter(Boolean).join('; '),
  };
}

/**
 * Get diff statistics
 */
export function getDiffStats(diff: CommandDiff): {
  insertions: number;
  deletions: number;
  replacements: number;
  totalChanges: number;
  changeRatio: number;
} {
  const insertions = diff.patches.filter(p => p.type === 'insert').length;
  const deletions = diff.patches.filter(p => p.type === 'delete').length;
  const replacements = diff.patches.filter(p => p.type === 'replace').length;
  const totalChanges = insertions + deletions + replacements;
  const changeRatio = totalChanges / diff.original.split(/\s+/).length;
  
  return {
    insertions,
    deletions,
    replacements,
    totalChanges,
    changeRatio,
  };
}
