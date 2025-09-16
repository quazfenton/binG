/**
 * Advanced File Management System
 *
 * Provides sophisticated file handling with:
 * - Diff-based updates with precise change tracking
 * - IDE-like functionality with state synchronization
 * - Auto-triggered workflows for multi-step operations
 * - Integration with CodePreviewPanel and SandpackEditor
 * - Version control and change history
 * - Real-time collaboration support
 */

import { EventEmitter } from 'events';
import { diff_match_patch, patch_obj } from 'diff-match-patch';
import { z } from 'zod';
import { EnhancedResponse, ProjectItem } from '../core/enhanced-prompt-engine';
import { SafeDiffOperations, ValidationResult, BackupState, Conflict } from './safe-diff-operations';

// File operation schemas
const FileOperationSchema = z.object({
  type: z.enum(['insert', 'replace', 'delete', 'move', 'rename', 'create']),
  target: z.string(),
  content: z.string().optional(),
  range: z.object({
    start: z.object({ line: z.number(), column: z.number() }),
    end: z.object({ line: z.number(), column: z.number() })
  }).optional(),
  newPath: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

const DiffOperationSchema = z.object({
  operation: z.enum(['insert', 'replace', 'delete', 'modify']),
  lineRange: z.tuple([z.number(), z.number()]),
  content: z.string(),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  preview: z.string().optional(),
  dependencies: z.array(z.string()).optional()
});

const FileStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  content: z.string(),
  language: z.string(),
  hasEdits: z.boolean(),
  lastModified: z.date(),
  version: z.number(),
  originalContent: z.string(),
  pendingDiffs: z.array(DiffOperationSchema),
  isLocked: z.boolean().default(false),
  metadata: z.record(z.any()).optional()
});

type FileOperation = z.infer<typeof FileOperationSchema>;
type DiffOperation = z.infer<typeof DiffOperationSchema>;
type FileState = z.infer<typeof FileStateSchema>;

interface CodePreviewPanelState {
  activeFile: string | null;
  showDiffs: boolean;
  pendingApprovals: DiffOperation[];
  previewContent: string;
  isEditing: boolean;
}

interface SandpackEditorState {
  activeFiles: Map<string, string>;
  hasUnsavedChanges: boolean;
  currentTheme: string;
  readOnly: boolean;
}

interface WorkflowStep {
  id: string;
  type: 'file_operation' | 'diff_apply' | 'validation' | 'user_approval';
  fileId: string;
  operation?: FileOperation;
  diffs?: DiffOperation[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  dependencies: string[];
  autoExecute: boolean;
}

interface AutoTriggerRule {
  id: string;
  condition: {
    type: 'file_change' | 'diff_applied' | 'user_action' | 'time_based';
    pattern?: RegExp;
    filePattern?: string;
    delay?: number;
  };
  action: {
    type: 'request_file' | 'generate_diffs' | 'validate_syntax' | 'run_workflow';
    target?: string;
    parameters?: any;
  };
  enabled: boolean;
}

class AdvancedFileManager extends EventEmitter {
  private fileStates: Map<string, FileState> = new Map();
  private workflowQueue: WorkflowStep[] = [];
  private autoTriggerRules: AutoTriggerRule[] = [];
  private dmp: diff_match_patch;
  private codePreviewState: CodePreviewPanelState;
  private sandpackState: SandpackEditorState;
  private changeHistory: Array<{
    timestamp: Date;
    fileId: string;
    operation: string;
    changes: any;
  }> = [];
  private safeDiffOperations: SafeDiffOperations;

  constructor(options: {
    autoSaveInterval?: number;
    maxHistoryEntries?: number;
    enableRealTimeSync?: boolean;
    safeDiffOptions?: {
      enablePreValidation?: boolean;
      enableSyntaxValidation?: boolean;
      enableConflictDetection?: boolean;
      enableAutoBackup?: boolean;
      enableRollback?: boolean;
      maxBackupHistory?: number;
      validationTimeout?: number;
      conflictResolutionStrategy?: 'manual' | 'auto' | 'hybrid';
    };
  } = {}) {
    super();

    this.dmp = new diff_match_patch();
    this.codePreviewState = {
      activeFile: null,
      showDiffs: false,
      pendingApprovals: [],
      previewContent: '',
      isEditing: false
    };

    this.sandpackState = {
      activeFiles: new Map(),
      hasUnsavedChanges: false,
      currentTheme: 'dark',
      readOnly: false
    };

    // Initialize safe diff operations
    this.safeDiffOperations = new SafeDiffOperations(options.safeDiffOptions);

    // Set up safe diff event handlers
    this.setupSafeDiffEventHandlers();

    // Initialize auto-trigger rules
    this.initializeAutoTriggerRules();

    // Set up periodic sync
    if (options.autoSaveInterval) {
      setInterval(() => this.syncStates(), options.autoSaveInterval);
    }
  }

  /**
   * Register a new project file with the manager
   */
  async registerFile(projectItem: ProjectItem): Promise<void> {
    const fileState: FileState = {
      id: projectItem.id,
      name: projectItem.name,
      path: projectItem.path,
      content: projectItem.content,
      language: projectItem.language,
      hasEdits: projectItem.hasEdits,
      lastModified: projectItem.lastModified,
      version: 1,
      originalContent: projectItem.content,
      pendingDiffs: [],
      isLocked: false,
      metadata: {}
    };

    this.fileStates.set(projectItem.id, fileState);
    this.emit('file_registered', { fileId: projectItem.id, fileState });

    // Update Sandpack state
    this.sandpackState.activeFiles.set(projectItem.id, projectItem.content);
  }

  /**
   * Apply diff operations to a file with comprehensive safety mechanisms
   */
  async applyDiffs(fileId: string, diffs: DiffOperation[], options: {
    requireApproval?: boolean;
    autoSync?: boolean;
    validateSyntax?: boolean;
    useSafeDiffOperations?: boolean;
  } = {}): Promise<{
    success: boolean;
    updatedContent: string;
    appliedDiffs: DiffOperation[];
    errors: string[];
    validationResult?: ValidationResult;
    backupId?: string;
    conflicts?: Conflict[];
  }> {
    const { 
      requireApproval = true, 
      autoSync = true, 
      validateSyntax = true,
      useSafeDiffOperations = true 
    } = options;

    const fileState = this.fileStates.get(fileId);
    if (!fileState) {
      throw new Error(`File ${fileId} not found`);
    }

    if (fileState.isLocked) {
      throw new Error(`File ${fileId} is locked and cannot be modified`);
    }

    // Use safe diff operations if enabled
    if (useSafeDiffOperations) {
      const safeResult = await this.safeDiffOperations.safelyApplyDiffs(
        fileId,
        fileState.content,
        diffs,
        fileState
      );

      if (safeResult.success) {
        // Update file state with safe result
        await this.updateFileContent(fileId, safeResult.updatedContent, {
          incrementVersion: true,
          trackChanges: true,
          syncStates: autoSync
        });

        this.emit('safe_diffs_applied', {
          fileId,
          appliedDiffs: safeResult.appliedDiffs,
          validationResult: safeResult.validationResult,
          backupId: safeResult.backupId
        });
      } else {
        this.emit('safe_diffs_failed', {
          fileId,
          errors: safeResult.errors,
          conflicts: safeResult.conflicts,
          validationResult: safeResult.validationResult
        });
      }

      return {
        success: safeResult.success,
        updatedContent: safeResult.updatedContent,
        appliedDiffs: safeResult.appliedDiffs,
        errors: safeResult.errors,
        validationResult: safeResult.validationResult,
        backupId: safeResult.backupId,
        conflicts: safeResult.conflicts
      };
    }

    // Fallback to original implementation for backward compatibility
    return this.applyDiffsLegacy(fileId, diffs, { requireApproval, autoSync, validateSyntax });
  }

  /**
   * Legacy diff application method (for backward compatibility)
   */
  private async applyDiffsLegacy(fileId: string, diffs: DiffOperation[], options: {
    requireApproval?: boolean;
    autoSync?: boolean;
    validateSyntax?: boolean;
  } = {}): Promise<{
    success: boolean;
    updatedContent: string;
    appliedDiffs: DiffOperation[];
    errors: string[];
  }> {
    const { requireApproval = true, autoSync = true, validateSyntax = true } = options;

    const fileState = this.fileStates.get(fileId)!;
    const errors: string[] = [];
    const appliedDiffs: DiffOperation[] = [];
    let updatedContent = fileState.content;

    // Sort diffs by line number (descending) to apply from bottom up
    const sortedDiffs = [...diffs].sort((a, b) => b.lineRange[0] - a.lineRange[0]);

    if (requireApproval) {
      // Add to pending approvals
      fileState.pendingDiffs.push(...sortedDiffs);
      this.codePreviewState.pendingApprovals.push(...sortedDiffs);
      this.emit('diffs_pending_approval', { fileId, diffs: sortedDiffs });
      return {
        success: false,
        updatedContent: fileState.content,
        appliedDiffs: [],
        errors: ['Diffs require user approval']
      };
    }

    // Apply each diff operation
    for (const diff of sortedDiffs) {
      try {
        const result = await this.applyIndividualDiff(updatedContent, diff);
        if (result.success) {
          updatedContent = result.content;
          appliedDiffs.push(diff);
        } else {
          errors.push(result.error || `Failed to apply diff: ${diff.description}`);
        }
      } catch (error) {
        errors.push(`Error applying diff: ${error.message}`);
      }
    }

    // Validate syntax if requested
    if (validateSyntax && appliedDiffs.length > 0) {
      const syntaxValid = await this.validateSyntax(updatedContent, fileState.language);
      if (!syntaxValid) {
        errors.push('Syntax validation failed');
      }
    }

    // Update file state
    if (appliedDiffs.length > 0) {
      await this.updateFileContent(fileId, updatedContent, {
        incrementVersion: true,
        trackChanges: true,
        syncStates: autoSync
      });
    }

    this.emit('diffs_applied', {
      fileId,
      appliedDiffs,
      errors,
      updatedContent
    });

    return {
      success: errors.length === 0,
      updatedContent,
      appliedDiffs,
      errors
    };
  }

  /**
   * Apply individual diff operation
   */
  private async applyIndividualDiff(content: string, diff: DiffOperation): Promise<{
    success: boolean;
    content: string;
    error?: string;
  }> {
    const lines = content.split('\n');
    const [startLine, endLine] = diff.lineRange;

    try {
      switch (diff.operation) {
        case 'insert':
          lines.splice(startLine - 1, 0, ...diff.content.split('\n'));
          break;

        case 'replace':
          const deleteCount = endLine - startLine + 1;
          lines.splice(startLine - 1, deleteCount, ...diff.content.split('\n'));
          break;

        case 'delete':
          const linesToDelete = endLine - startLine + 1;
          lines.splice(startLine - 1, linesToDelete);
          break;

        case 'modify':
          // For modify operations, use more sophisticated diff matching
          const targetLines = lines.slice(startLine - 1, endLine);
          const originalText = targetLines.join('\n');
          const patches = this.dmp.patch_fromText(diff.content);
          const [newText] = this.dmp.patch_apply(patches, originalText);
          lines.splice(startLine - 1, targetLines.length, ...newText.split('\n'));
          break;

        default:
          return {
            success: false,
            content,
            error: `Unknown operation: ${diff.operation}`
          };
      }

      return {
        success: true,
        content: lines.join('\n')
      };
    } catch (error) {
      return {
        success: false,
        content,
        error: error.message
      };
    }
  }

  /**
   * Update file content with comprehensive state management
   */
  async updateFileContent(fileId: string, newContent: string, options: {
    incrementVersion?: boolean;
    trackChanges?: boolean;
    syncStates?: boolean;
    preserveOriginal?: boolean;
  } = {}): Promise<void> {
    const {
      incrementVersion = true,
      trackChanges = true,
      syncStates = true,
      preserveOriginal = true
    } = options;

    const fileState = this.fileStates.get(fileId);
    if (!fileState) {
      throw new Error(`File ${fileId} not found`);
    }

    const oldContent = fileState.content;

    // Track changes in history
    if (trackChanges) {
      this.changeHistory.push({
        timestamp: new Date(),
        fileId,
        operation: 'content_update',
        changes: {
          oldContent: preserveOriginal ? oldContent : null,
          newContent,
          version: fileState.version
        }
      });
    }

    // Update file state
    fileState.content = newContent;
    fileState.hasEdits = newContent !== fileState.originalContent;
    fileState.lastModified = new Date();

    if (incrementVersion) {
      fileState.version += 1;
    }

    // Clear pending diffs that have been applied
    fileState.pendingDiffs = [];

    this.fileStates.set(fileId, fileState);

    // Sync with UI components
    if (syncStates) {
      await this.syncStates();
    }

    // Check auto-trigger rules
    await this.checkAutoTriggerRules(fileId, 'file_change');

    this.emit('file_content_updated', {
      fileId,
      newContent,
      oldContent,
      version: fileState.version,
      hasEdits: fileState.hasEdits
    });
  }

  /**
   * Handle user approval for pending diffs
   */
  async handleUserApproval(fileId: string, approved: DiffOperation[], action: 'apply' | 'dismiss'): Promise<void> {
    const fileState = this.fileStates.get(fileId);
    if (!fileState) {
      throw new Error(`File ${fileId} not found`);
    }

    if (action === 'apply') {
      // Apply approved diffs
      const result = await this.applyDiffs(fileId, approved, {
        requireApproval: false,
        autoSync: true,
        validateSyntax: true
      });

      if (result.success) {
        this.emit('user_approval_applied', { fileId, diffs: approved });
      } else {
        this.emit('user_approval_failed', { fileId, diffs: approved, errors: result.errors });
      }
    } else {
      // Remove from pending approvals
      fileState.pendingDiffs = fileState.pendingDiffs.filter(
        diff => !approved.some(approvedDiff => this.diffsEqual(diff, approvedDiff))
      );

      this.codePreviewState.pendingApprovals = this.codePreviewState.pendingApprovals.filter(
        diff => !approved.some(approvedDiff => this.diffsEqual(diff, approvedDiff))
      );

      this.emit('user_approval_dismissed', { fileId, diffs: approved });
    }
  }

  /**
   * Execute multi-step workflow with auto-triggered actions
   */
  async executeWorkflow(steps: WorkflowStep[]): Promise<{
    completedSteps: WorkflowStep[];
    failedSteps: WorkflowStep[];
    results: any[];
  }> {
    const completedSteps: WorkflowStep[] = [];
    const failedSteps: WorkflowStep[] = [];
    const results: any[] = [];

    // Add steps to queue
    this.workflowQueue.push(...steps);

    this.emit('workflow_started', { stepCount: steps.length });

    while (this.workflowQueue.length > 0) {
      const step = this.workflowQueue.shift()!;

      // Check dependencies
      const dependenciesMet = step.dependencies.every(depId =>
        completedSteps.some(completed => completed.id === depId)
      );

      if (!dependenciesMet) {
        // Re-queue step if dependencies not met
        this.workflowQueue.push(step);
        continue;
      }

      step.status = 'in_progress';
      this.emit('workflow_step_started', { step });

      try {
        let result;

        switch (step.type) {
          case 'file_operation':
            result = await this.executeFileOperation(step.fileId, step.operation!);
            break;

          case 'diff_apply':
            result = await this.applyDiffs(step.fileId, step.diffs!, {
              requireApproval: !step.autoExecute
            });
            break;

          case 'validation':
            result = await this.validateFile(step.fileId);
            break;

          case 'user_approval':
            // Skip auto-execution for user approval steps
            if (!step.autoExecute) {
              step.status = 'pending';
              this.emit('workflow_step_pending_approval', { step });
              continue;
            }
            result = { approved: true };
            break;
        }

        step.result = result;
        step.status = 'completed';
        completedSteps.push(step);
        results.push(result);

        this.emit('workflow_step_completed', { step, result });

      } catch (error) {
        step.error = error.message;
        step.status = 'failed';
        failedSteps.push(step);

        this.emit('workflow_step_failed', { step, error: error.message });
      }
    }

    this.emit('workflow_completed', {
      completed: completedSteps.length,
      failed: failedSteps.length,
      results
    });

    return { completedSteps, failedSteps, results };
  }

  /**
   * Synchronize states between CodePreviewPanel and SandpackEditor
   */
  async syncStates(): Promise<void> {
    // Update CodePreviewPanel with current active file
    if (this.codePreviewState.activeFile) {
      const fileState = this.fileStates.get(this.codePreviewState.activeFile);
      if (fileState) {
        this.codePreviewState.previewContent = fileState.content;
        this.codePreviewState.isEditing = fileState.hasEdits;
      }
    }

    // Update SandpackEditor with all file changes
    for (const [fileId, fileState] of this.fileStates.entries()) {
      if (this.sandpackState.activeFiles.has(fileId)) {
        const sandpackContent = this.sandpackState.activeFiles.get(fileId);
        if (sandpackContent !== fileState.content) {
          this.sandpackState.activeFiles.set(fileId, fileState.content);
          this.sandpackState.hasUnsavedChanges = true;
        }
      }
    }

    this.emit('states_synchronized', {
      codePreviewState: this.codePreviewState,
      sandpackState: this.sandpackState
    });
  }

  /**
   * Request next file based on dependencies and workflow logic
   */
  async requestNextFile(currentFileId: string, context?: any): Promise<{
    nextFileId: string | null;
    reason: string;
    autoAttach?: boolean;
  }> {
    const currentFile = this.fileStates.get(currentFileId);
    if (!currentFile) {
      return { nextFileId: null, reason: 'Current file not found' };
    }

    // Analyze dependencies
    const dependencies = this.extractFileDependencies(currentFile.content);

    // Find next file based on dependencies
    for (const dep of dependencies) {
      const depFile = this.findFileByPath(dep);
      if (depFile && !depFile.hasEdits) {
        return {
          nextFileId: depFile.id,
          reason: `Dependency ${dep} needs updates`,
          autoAttach: true
        };
      }
    }

    // Check workflow queue for next file
    const nextWorkflowStep = this.workflowQueue.find(step => step.fileId !== currentFileId);
    if (nextWorkflowStep) {
      return {
        nextFileId: nextWorkflowStep.fileId,
        reason: `Workflow step: ${nextWorkflowStep.type}`,
        autoAttach: false
      };
    }

    return { nextFileId: null, reason: 'No next file required' };
  }

  /**
   * Generate precise diffs between two versions of content
   */
  generateDiffs(originalContent: string, newContent: string, options: {
    contextLines?: number;
    ignoreWhitespace?: boolean;
    semantic?: boolean;
  } = {}): DiffOperation[] {
    const { contextLines = 3, ignoreWhitespace = false, semantic = true } = options;

    const diffs = this.dmp.diff_main(originalContent, newContent);

    if (semantic) {
      this.dmp.diff_cleanupSemantic(diffs);
    }

    const operations: DiffOperation[] = [];
    let lineNumber = 1;
    let charIndex = 0;

    for (const [operation, text] of diffs) {
      if (operation === 0) {
        // No change
        lineNumber += text.split('\n').length - 1;
        charIndex += text.length;
        continue;
      }

      const lines = text.split('\n');
      const startLine = lineNumber;
      const endLine = lineNumber + lines.length - 1;

      let diffOperation: DiffOperation['operation'];
      let description: string;

      if (operation === 1) {
        diffOperation = 'insert';
        description = `Insert ${lines.length} line(s) at line ${startLine}`;
      } else {
        diffOperation = 'delete';
        description = `Delete ${lines.length} line(s) from line ${startLine}`;
      }

      operations.push({
        operation: diffOperation,
        lineRange: [startLine, endLine],
        content: text,
        description,
        confidence: 0.95,
        preview: text.length > 100 ? text.substring(0, 100) + '...' : text
      });

      if (operation !== -1) {
        lineNumber += lines.length - 1;
      }
      charIndex += text.length;
    }

    return operations;
  }

  /**
   * Validate file syntax
   */
  private async validateSyntax(content: string, language: string): Promise<boolean> {
    try {
      switch (language.toLowerCase()) {
        case 'typescript':
        case 'javascript':
          // Basic JS/TS validation - in real implementation, use TypeScript compiler API
          return !content.includes('SyntaxError') && this.validateBrackets(content);

        case 'json':
          JSON.parse(content);
          return true;

        case 'css':
        case 'scss':
          // Basic CSS validation
          return this.validateCSSBrackets(content);

        default:
          return true; // Skip validation for unknown languages
      }
    } catch {
      return false;
    }
  }

  /**
   * Validate balanced brackets
   */
  private validateBrackets(content: string): boolean {
    const brackets = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];

    for (const char of content) {
      if (char in brackets) {
        stack.push(brackets[char as keyof typeof brackets]);
      } else if (Object.values(brackets).includes(char)) {
        if (stack.pop() !== char) {
          return false;
        }
      }
    }

    return stack.length === 0;
  }

  /**
   * Validate CSS brackets and syntax
   */
  private validateCSSBrackets(content: string): boolean {
    const braceCount = (content.match(/\{/g) || []).length;
    const closeBraceCount = (content.match(/\}/g) || []).length;
    return braceCount === closeBraceCount;
  }

  /**
   * Initialize auto-trigger rules
   */
  private initializeAutoTriggerRules(): void {
    this.autoTriggerRules = [
      {
        id: 'auto_request_dependencies',
        condition: {
          type: 'file_change',
          pattern: /import.*from\s+['"`]\..*['"`]/g
        },
        action: {
          type: 'request_file',
          target: 'dependency'
        },
        enabled: true
      },
      {
        id: 'auto_validate_syntax',
        condition: {
          type: 'diff_applied'
        },
        action: {
          type: 'validate_syntax'
        },
        enabled: true
      }
    ];
  }

  /**
   * Check and execute auto-trigger rules
   */
  private async checkAutoTriggerRules(fileId: string, triggerType: string): Promise<void> {
    const fileState = this.fileStates.get(fileId);
    if (!fileState) return;

    for (const rule of this.autoTriggerRules) {
      if (!rule.enabled || rule.condition.type !== triggerType) continue;

      let shouldTrigger = false;

      switch (rule.condition.type) {
        case 'file_change':
          if (rule.condition.pattern) {
            shouldTrigger = rule.condition.pattern.test(fileState.content);
          } else {
            shouldTrigger = true;
          }
          break;

        case 'diff_applied':
          shouldTrigger = fileState.hasEdits;
          break;
      }

      if (shouldTrigger) {
        await this.executeAutoTriggerAction(rule, fileId);
      }
    }
  }

  /**
   * Execute auto-trigger action
   */
  private async executeAutoTriggerAction(rule: AutoTriggerRule, fileId: string): Promise<void> {
    try {
      switch (rule.action.type) {
        case 'request_file':
          const nextFile = await this.requestNextFile(fileId);
          if (nextFile.nextFileId) {
            this.emit('auto_file_requested', {
              ruleId: rule.id,
              currentFileId: fileId,
              nextFileId: nextFile.nextFileId,
              reason: nextFile.reason
            });
          }
          break;

        case 'validate_syntax':
          const fileState = this.fileStates.get(fileId);
          if (fileState) {
            const isValid = await this.validateSyntax(fileState.content, fileState.language);
            this.emit('auto_validation_completed', {
              ruleId: rule.id,
              fileId,
              isValid
            });
          }
          break;
      }
    } catch (error) {
      this.emit('auto_trigger_error', {
        ruleId: rule.id,
        fileId,
        error: error.message
      });
    }
  }

  /**
   * Helper methods
   */
  private diffsEqual(diff1: DiffOperation, diff2: DiffOperation): boolean {
    return diff1.operation === diff2.operation &&
           diff1.lineRange[0] === diff2.lineRange[0] &&
           diff1.lineRange[1] === diff2.lineRange[1] &&
           diff1.content === diff2.content;
  }

  private findFileByPath(path: string): FileState | null {
    for (const fileState of this.fileStates.values()) {
      if (fileState.path.endsWith(path) || fileState.name === path) {
        return fileState;
      }
    }
    return null;
  }

  private extractFileDependencies(content: string): string[] {
    const importRegex = /(?:import|from)\s+['"`]([^'"`]+)['"`]/g;
    const dependencies: string[] = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      if (match[1].startsWith('./') || match[1].startsWith('../')) {
        dependencies.push(match[1]);
      }
    }

    return dependencies;
  }

  private async executeFileOperation(fileId: string, operation: FileOperation): Promise<any> {
    switch (operation.type) {
      case 'create':
        // Handle file creation
        return { created: true, fileId };
      case 'rename':
        // Handle file rename
        return { renamed: true, oldName: fileId, newName: operation.newPath };
      case 'move':
        // Handle file move
        return { moved: true, oldPath: fileId, newPath: operation.newPath };
      default:
        throw new Error(`Unsupported file operation: ${operation.type}`);
    }
  }

  private async validateFile(fileId: string): Promise<any> {
    const fileState = this.fileStates.get(fileId);
    if (!fileState) {
      throw new Error(`File ${fileId} not found`);
    }

    const syntaxValid = await this.validateSyntax(fileState.content, fileState.language);
    return {
      fileId,
      syntaxValid,
      hasEdits: fileState.hasEdits,
      version: fileState.version
    };
  }

  // Public getter methods for UI integration
  getFileState(fileId: string): FileState | undefined {
    return this.fileStates.get(fileId);
  }

  getAllFileStates(): Map<string, FileState> {
    return new Map(this.fileStates);
  }

  getCodePreviewState(): CodePreviewPanelState {
    return { ...this.codePreviewState };
  }

  getSandpackState(): SandpackEditorState {
    return {
      ...this.sandpackState,
      activeFiles: new Map(this.sandpackState.activeFiles)
    };
  }

  getChangeHistory(): typeof this.changeHistory {
    return [...this.changeHistory];
  }

  getPendingWorkflowSteps(): WorkflowStep[] {
    return [...this.workflowQueue];
  }

  /**
   * Set up event handlers for safe diff operations
   */
  private setupSafeDiffEventHandlers(): void {
    this.safeDiffOperations.on('backup_created', (data) => {
      this.emit('safe_diff_backup_created', data);
    });

    this.safeDiffOperations.on('conflicts_detected', (data) => {
      this.emit('safe_diff_conflicts_detected', data);
    });

    this.safeDiffOperations.on('rollback_completed', (data) => {
      this.emit('safe_diff_rollback_completed', data);
    });

    this.safeDiffOperations.on('change_tracked', (data) => {
      this.emit('safe_diff_change_tracked', data);
    });

    this.safeDiffOperations.on('conflict_resolved', (data) => {
      this.emit('safe_diff_conflict_resolved', data);
    });

    this.safeDiffOperations.on('syntax_validation_failed_rollback', (data) => {
      this.emit('safe_diff_syntax_validation_failed_rollback', data);
    });

    this.safeDiffOperations.on('emergency_rollback', (data) => {
      this.emit('safe_diff_emergency_rollback', data);
    });
  }

  /**
   * Get backup history for a file
   */
  getBackupHistory(fileId: string): BackupState[] {
    return this.safeDiffOperations.getBackupHistory(fileId);
  }

  /**
   * Get change history for a file
   */
  getSafeDiffChangeHistory(fileId: string) {
    return this.safeDiffOperations.getChangeHistory(fileId);
  }

  /**
   * Get active conflicts for a file
   */
  getActiveConflicts(fileId: string): Conflict[] {
    return this.safeDiffOperations.getActiveConflicts(fileId);
  }

  /**
   * Get all active conflicts across all files
   */
  getAllActiveConflicts(): Map<string, Conflict[]> {
    return this.safeDiffOperations.getAllActiveConflicts();
  }

  /**
   * Rollback a file to a previous backup
   */
  async rollbackToBackup(fileId: string, backupId: string): Promise<{
    success: boolean;
    restoredContent: string;
    errors: string[];
  }> {
    const rollbackResult = await this.safeDiffOperations.rollbackToBackup(fileId, backupId);
    
    if (rollbackResult.success) {
      // Update file state with restored content
      await this.updateFileContent(fileId, rollbackResult.restoredContent, {
        incrementVersion: true,
        trackChanges: true,
        syncStates: true
      });

      this.emit('file_rolled_back', {
        fileId,
        backupId,
        restoredContent: rollbackResult.restoredContent
      });
    }

    return {
      success: rollbackResult.success,
      restoredContent: rollbackResult.restoredContent,
      errors: rollbackResult.errors
    };
  }

  /**
   * Resolve conflicts for a file
   */
  async resolveConflicts(fileId: string, resolutions: Array<{
    conflictId: string;
    resolution: 'accept_current' | 'accept_incoming' | 'merge' | 'manual';
    mergedContent?: string;
    selectedDiffs?: DiffOperation[];
  }>): Promise<{
    success: boolean;
    resolvedConflicts: string[];
    remainingConflicts: Conflict[];
    errors: string[];
  }> {
    const result = await this.safeDiffOperations.resolveConflicts(fileId, resolutions);

    if (result.success && result.resolvedConflicts.length > 0) {
      this.emit('conflicts_resolved', {
        fileId,
        resolvedConflicts: result.resolvedConflicts,
        remainingConflicts: result.remainingConflicts
      });
    }

    return result;
  }

  /**
   * Update safe diff operations options
   */
  updateSafeDiffOptions(options: {
    enablePreValidation?: boolean;
    enableSyntaxValidation?: boolean;
    enableConflictDetection?: boolean;
    enableAutoBackup?: boolean;
    enableRollback?: boolean;
    maxBackupHistory?: number;
    validationTimeout?: number;
    conflictResolutionStrategy?: 'manual' | 'auto' | 'hybrid';
  }): void {
    this.safeDiffOperations.updateOptions(options);
    this.emit('safe_diff_options_updated', options);
  }

  /**
   * Get current safe diff operations options
   */
  getSafeDiffOptions() {
    return this.safeDiffOperations.getOptions();
  }
}

export {
  AdvancedFileManager,
  type FileOperation,
  type DiffOperation,
  type FileState,
  type CodePreviewPanelState,
  type SandpackEditorState,
  type WorkflowStep,
  type AutoTriggerRule,
  FileOperationSchema,
  DiffOperationSchema,
  FileStateSchema
};
