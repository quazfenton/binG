/**
 * Mode Manager
 * 
 * Handles mode-aware response processing to ensure proper separation
 * between Chat and Code modes, preventing incorrect diff proposals
 * and code preview panel triggers.
 */

export type AppMode = 'chat' | 'code';

export interface ProcessedResponse {
  mode: AppMode;
  content: string;
  codeBlocks?: CodeBlock[];
  fileDiffs?: FileDiff[];
  shouldShowDiffs: boolean;
  shouldOpenCodePreview: boolean;
  isInputParsing: boolean;
}

export interface CodeBlock {
  language: string;
  code: string;
  filename?: string;
  isFileEdit: boolean;
}

export interface FileDiff {
  path: string;
  diff: string;
  type: 'create' | 'modify' | 'delete';
}

export interface FileOperation {
  type: 'create' | 'modify' | 'delete';
  path: string;
  content?: string;
  diff?: string;
}

/**
 * Mode Manager class for handling mode-aware response processing
 */
export class ModeManager {
  private currentMode: AppMode = 'chat';

  /**
   * Set the current application mode
   */
  setMode(mode: AppMode): void {
    this.currentMode = mode;
  }

  /**
   * Get the current application mode
   */
  getCurrentMode(): AppMode {
    return this.currentMode;
  }

  /**
   * Route and process response based on current mode
   */
  routeResponse(response: string, isInputParsing: boolean = false): ProcessedResponse {
    const codeBlocks = this.extractCodeBlocks(response);
    const fileDiffs = this.detectFileDiffs(response);
    
    // Never show diffs or open code preview for input parsing
    if (isInputParsing) {
      return {
        mode: this.currentMode,
        content: response,
        codeBlocks: codeBlocks.map(block => ({ ...block, isFileEdit: false })),
        fileDiffs: [],
        shouldShowDiffs: false,
        shouldOpenCodePreview: false,
        isInputParsing: true,
      };
    }

    // Mode-specific processing
    switch (this.currentMode) {
      case 'chat':
        return this.processChatResponse(response, codeBlocks, fileDiffs);
      case 'code':
        return this.processCodeResponse(response, codeBlocks, fileDiffs);
      default:
        return this.processChatResponse(response, codeBlocks, fileDiffs);
    }
  }

  /**
   * Process response for Chat mode
   */
  private processChatResponse(
    response: string, 
    codeBlocks: CodeBlock[], 
    fileDiffs: FileDiff[]
  ): ProcessedResponse {
    // In Chat mode, code blocks are for display only, not file edits
    const displayCodeBlocks = codeBlocks.map(block => ({
      ...block,
      isFileEdit: false, // Never treat as file edits in chat mode
    }));

    return {
      mode: 'chat',
      content: response,
      codeBlocks: displayCodeBlocks,
      fileDiffs: [], // Never show file diffs in chat mode
      shouldShowDiffs: false, // Never show diffs in chat mode
      shouldOpenCodePreview: false, // Never auto-open code preview in chat mode
      isInputParsing: false,
    };
  }

  /**
   * Process response for Code mode
   */
  private processCodeResponse(
    response: string, 
    codeBlocks: CodeBlock[], 
    fileDiffs: FileDiff[]
  ): ProcessedResponse {
    // In Code mode, determine which code blocks are actual file edits
    const processedCodeBlocks = codeBlocks.map(block => ({
      ...block,
      isFileEdit: this.isFileEdit(block),
    }));

    const actualFileDiffs = this.filterActualFileDiffs(fileDiffs);
    const hasActualCode = processedCodeBlocks.some(block => block.isFileEdit) || actualFileDiffs.length > 0;

    return {
      mode: 'code',
      content: response,
      codeBlocks: processedCodeBlocks,
      fileDiffs: actualFileDiffs,
      shouldShowDiffs: actualFileDiffs.length > 0,
      shouldOpenCodePreview: hasActualCode,
      isInputParsing: false,
    };
  }

  /**
   * Determine if a code block represents a file edit
   */
  private isFileEdit(codeBlock: CodeBlock): boolean {
    // Check if the code block has a filename and appears to be a complete file
    if (!codeBlock.filename) {
      return false;
    }

    // Check for file edit indicators
    const code = codeBlock.code.toLowerCase();
    const filename = codeBlock.filename.toLowerCase();

    // Exclude example/demo code
    if (
      code.includes('// example') ||
      code.includes('// demo') ||
      code.includes('/* example') ||
      code.includes('# example') ||
      filename.includes('example') ||
      filename.includes('demo') ||
      filename.includes('sample')
    ) {
      return false;
    }

    // Check for complete file structure indicators
    const hasFileStructure = 
      // JavaScript/TypeScript files
      (codeBlock.language.includes('javascript') || codeBlock.language.includes('typescript')) &&
      (code.includes('import') || code.includes('export') || code.includes('module.exports')) ||
      
      // HTML files
      codeBlock.language === 'html' && code.includes('<!doctype') ||
      
      // CSS files
      codeBlock.language === 'css' && (code.includes('{') && code.includes('}')) ||
      
      // Python files
      codeBlock.language === 'python' && (code.includes('def ') || code.includes('class ')) ||
      
      // Configuration files
      filename.includes('config') || filename.includes('.json') || filename.includes('.yml');

    return hasFileStructure;
  }

  /**
   * Extract code blocks from response content
   */
  private extractCodeBlocks(content: string): CodeBlock[] {
    const codeBlockRegex = /```(?:([a-zA-Z0-9+\-_.]+)(?:\s+(.+?))?)?\n([\s\S]*?)```/g;
    const blocks: CodeBlock[] = [];
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const [, language = 'text', filename, code] = match;
      
      blocks.push({
        language: language.toLowerCase(),
        code: code.trim(),
        filename: filename?.trim(),
        isFileEdit: false, // Will be determined later
      });
    }

    return blocks;
  }

  /**
   * Detect file diffs in response content
   */
  private detectFileDiffs(content: string): FileDiff[] {
    const diffs: FileDiff[] = [];

    // Look for diff blocks
    const diffRegex = /```diff\s+(.+?)\n([\s\S]*?)```/g;
    let match;

    while ((match = diffRegex.exec(content)) !== null) {
      const [, path, diffContent] = match;
      
      diffs.push({
        path: path.trim(),
        diff: diffContent.trim(),
        type: this.determineDiffType(diffContent),
      });
    }

    // Look for COMMANDS blocks with write_diffs
    const commandsRegex = /=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/g;
    while ((match = commandsRegex.exec(content)) !== null) {
      const commandBlock = match[1];
      const diffsMatch = commandBlock.match(/write_diffs:\s*\[([\s\S]*?)\]/);
      
      if (diffsMatch) {
        try {
          const items = diffsMatch[1]
            .split(/},/)
            .map((s) => (s.endsWith("}") ? s : s + "}"))
            .map((s) => s.trim())
            .filter(Boolean);

          items.forEach(item => {
            const pathMatch = item.match(/path:\s*"([^"]+)"/);
            const diffMatch = item.match(/diff:\s*"([\s\S]*)"/);
            
            if (pathMatch && diffMatch) {
              diffs.push({
                path: pathMatch[1],
                diff: diffMatch[1].replace(/\\n/g, "\n"),
                type: this.determineDiffType(diffMatch[1]),
              });
            }
          });
        } catch (error) {
          console.warn('Failed to parse COMMANDS diff block:', error);
        }
      }
    }

    return diffs;
  }

  /**
   * Determine the type of diff operation
   */
  private determineDiffType(diffContent: string): 'create' | 'modify' | 'delete' {
    const lines = diffContent.split('\n');
    const addedLines = lines.filter(line => line.startsWith('+')).length;
    const removedLines = lines.filter(line => line.startsWith('-')).length;

    if (addedLines > 0 && removedLines === 0) {
      return 'create';
    } else if (addedLines === 0 && removedLines > 0) {
      return 'delete';
    } else {
      return 'modify';
    }
  }

  /**
   * Filter out non-actual file diffs (e.g., examples, demos)
   */
  private filterActualFileDiffs(diffs: FileDiff[]): FileDiff[] {
    return diffs.filter(diff => {
      const path = diff.path.toLowerCase();
      
      // Exclude example/demo files
      if (
        path.includes('example') ||
        path.includes('demo') ||
        path.includes('sample') ||
        path.includes('test') && !path.includes('src/test') // Exclude test files unless in src/test
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * Extract file operations from response
   */
  extractFileOperations(response: string): FileOperation[] {
    const operations: FileOperation[] = [];
    const fileDiffs = this.detectFileDiffs(response);

    fileDiffs.forEach(diff => {
      operations.push({
        type: diff.type,
        path: diff.path,
        diff: diff.diff,
      });
    });

    return operations;
  }

  /**
   * Check if response should generate diffs based on mode
   */
  shouldGenerateDiffs(response: string, mode?: AppMode): boolean {
    const currentMode = mode || this.currentMode;
    
    // Never generate diffs in chat mode
    if (currentMode === 'chat') {
      return false;
    }

    // In code mode, only generate diffs if there are actual file operations
    const fileDiffs = this.detectFileDiffs(response);
    const actualDiffs = this.filterActualFileDiffs(fileDiffs);
    
    return actualDiffs.length > 0;
  }

  /**
   * Check if code preview panel should open based on mode and content
   */
  shouldOpenCodePreview(response: string, mode?: AppMode): boolean {
    const currentMode = mode || this.currentMode;
    
    // Never auto-open code preview in chat mode
    if (currentMode === 'chat') {
      return false;
    }

    // In code mode, only open if there's actual code to preview
    const codeBlocks = this.extractCodeBlocks(response);
    const hasActualCode = codeBlocks.some(block => this.isFileEdit(block));
    const fileDiffs = this.detectFileDiffs(response);
    const hasActualDiffs = this.filterActualFileDiffs(fileDiffs).length > 0;

    return hasActualCode || hasActualDiffs;
  }
}

// Create singleton instance
export const modeManager = new ModeManager();

// Export utility functions
export function setCurrentMode(mode: AppMode): void {
  modeManager.setMode(mode);
}

export function getCurrentMode(): AppMode {
  return modeManager.getCurrentMode();
}

export function processResponse(response: string, isInputParsing: boolean = false): ProcessedResponse {
  return modeManager.routeResponse(response, isInputParsing);
}

export function shouldShowDiffs(response: string, mode?: AppMode): boolean {
  return modeManager.shouldGenerateDiffs(response, mode);
}

export function shouldOpenCodePreview(response: string, mode?: AppMode): boolean {
  return modeManager.shouldOpenCodePreview(response, mode);
}