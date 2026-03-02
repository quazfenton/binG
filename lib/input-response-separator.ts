/**
 * Input Response Separator
 * 
 * Provides utilities to distinguish between user input processing
 * and API response processing to prevent incorrect code extraction
 * from user prompts.
 */

import { processResponse, type ProcessedResponse } from './mode-manager';

export interface InputContext {
  isUserInput: boolean;
  isApiResponse: boolean;
  source: 'user' | 'assistant' | 'system';
  timestamp: number;
}

/**
 * Process user input - should never extract code for file operations
 */
export function processUserInput(content: string): ProcessedResponse {
  return processResponse(content, true); // isInputParsing = true
}

/**
 * Process API response - can extract code for file operations
 */
export function processApiResponse(content: string): ProcessedResponse {
  return processResponse(content, false); // isInputParsing = false
}

/**
 * Determine if content is from user input or API response
 */
export function createInputContext(source: 'user' | 'assistant' | 'system'): InputContext {
  return {
    isUserInput: source === 'user',
    isApiResponse: source === 'assistant',
    source,
    timestamp: Date.now(),
  };
}

/**
 * Safe content processor that respects input/response context
 */
export function processSafeContent(
  content: string, 
  context: InputContext
): ProcessedResponse {
  if (context.isUserInput) {
    return processUserInput(content);
  } else if (context.isApiResponse) {
    return processApiResponse(content);
  } else {
    // System messages - treat as non-parsing
    return processResponse(content, true);
  }
}

/**
 * Extract code blocks safely based on context
 */
export function extractCodeBlocksSafely(
  content: string,
  context: InputContext
): { language: string; code: string; filename?: string; isFileEdit: boolean }[] {
  const processed = processSafeContent(content, context);
  return processed.codeBlocks || [];
}

/**
 * Check if diffs should be generated based on context
 */
export function shouldGenerateDiffsForContext(
  content: string,
  context: InputContext
): boolean {
  if (context.isUserInput) {
    return false; // Never generate diffs from user input
  }
  
  const processed = processSafeContent(content, context);
  return processed.shouldShowDiffs;
}

/**
 * Check if code preview should open based on context
 */
export function shouldOpenCodePreviewForContext(
  content: string,
  context: InputContext
): boolean {
  if (context.isUserInput) {
    return false; // Never auto-open from user input
  }
  
  const processed = processSafeContent(content, context);
  return processed.shouldOpenCodePreview;
}

/**
 * Validate that content processing respects input/response boundaries
 */
export function validateContentProcessing(
  content: string,
  context: InputContext,
  result: ProcessedResponse
): { isValid: boolean; violations: string[] } {
  const violations: string[] = [];

  // User input should never trigger file operations
  if (context.isUserInput) {
    if (result.shouldShowDiffs) {
      violations.push('User input should not generate diff proposals');
    }
    
    if (result.shouldOpenCodePreview) {
      violations.push('User input should not trigger code preview opening');
    }
    
    if (result.codeBlocks?.some(block => block.isFileEdit)) {
      violations.push('User input code blocks should not be treated as file edits');
    }
  }

  // API responses in chat mode should not trigger file operations
  if (context.isApiResponse && result.mode === 'chat') {
    if (result.shouldShowDiffs) {
      violations.push('Chat mode responses should not generate diff proposals');
    }
    
    if (result.shouldOpenCodePreview) {
      violations.push('Chat mode responses should not trigger code preview opening');
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

/**
 * Debug helper to log content processing decisions
 */
export function debugContentProcessing(
  content: string,
  context: InputContext,
  result: ProcessedResponse
): void {
  if (process.env.NODE_ENV === 'development') {
    const validation = validateContentProcessing(content, context, result);
    
    console.group(`Content Processing Debug - ${context.source}`);
    console.log('Context:', context);
    console.log('Content length:', content.length);
    console.log('Result:', {
      mode: result.mode,
      shouldShowDiffs: result.shouldShowDiffs,
      shouldOpenCodePreview: result.shouldOpenCodePreview,
      codeBlockCount: result.codeBlocks?.length || 0,
      fileDiffCount: result.fileDiffs?.length || 0,
    });
    
    if (!validation.isValid) {
      console.warn('Validation violations:', validation.violations);
    }
    
    console.groupEnd();
  }
}