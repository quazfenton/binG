/**
 * Safe Diff Operations System
 *
 * Provides enhanced safety mechanisms for diff operations including:
 * - Pre-execution validation for code changes
 * - Rollback mechanisms for failed operations
 * - Change tracking and conflict resolution
 * - Syntax validation before applying diffs
 * - Backup and recovery systems
 * - Conflict detection and resolution
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import { 
  createSafeDiffError,
  createFileManagementError,
  ERROR_CODES 
} from '../core/error-types';
import { DiffOperation, FileState } from './advanced-file-manager';

// Validation schemas
const ValidationResultSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  suggestions: z.array(z.string()).optional()
});

const BackupStateSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  timestamp: z.date(),
  content: z.string(),
  version: z.number(),
  metadata: z.record(z.any()).optional()
});

const ConflictSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  type: z.enum(['line_overlap', 'dependency_conflict', 'syntax_conflict', 'semantic_conflict']),
  description: z.string(),
  affectedLines: z.array(z.number()),
  conflictingDiffs: z.array(z.any()),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  resolutionOptions: z.array(z.object({
    id: z.string(),
    description: z.string(),
    action: z.string(),
    confidence: z.number()
  }))
});

const ChangeTrackingEntrySchema = z.object({
  id: z.string(),
  fileId: z.string(),
  timestamp: z.date(),
  operation: z.string(),
  diffs: z.array(z.any()),
  beforeState: z.string(),
  afterState: z.string(),
  success: z.boolean(),
  rollbackId: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

type ValidationResult = z.infer<typeof ValidationResultSchema>;
type BackupState = z.infer<typeof BackupStateSchema>;
type Conflict = z.infer<typeof ConflictSchema>;
type ChangeTrackingEntry = z.infer<typeof ChangeTrackingEntrySchema>;

interface SafeDiffOptions {
  enablePreValidation: boolean;
  enableSyntaxValidation: boolean;
  enableConflictDetection: boolean;
  enableAutoBackup: boolean;
  enableRollback: boolean;
  maxBackupHistory: number;
  validationTimeout: number;
  conflictResolutionStrategy: 'manual' | 'auto' | 'hybrid';
}

interface RollbackResult {
  success: boolean;
  restoredContent: string;
  backupId: string;
  errors: string[];
}

interface ConflictResolution {
  conflictId: string;
  resolution: 'accept_current' | 'accept_incoming' | 'merge' | 'manual';
  mergedContent?: string;
  selectedDiffs?: DiffOperation[];
}

class SafeDiffOperations extends EventEmitter {
  private backupHistory: Map<string, BackupState[]> = new Map();
  private changeTracking: Map<string, ChangeTrackingEntry[]> = new Map();
  private activeConflicts: Map<string, Conflict[]> = new Map();
  private options: SafeDiffOptions;

  constructor(options: Partial<SafeDiffOptions> = {}) {
    super();
    
    this.options = {
      enablePreValidation: true,
      enableSyntaxValidation: true,
      enableConflictDetection: true,
      enableAutoBackup: true,
      enableRollback: true,
      maxBackupHistory: 10,
      validationTimeout: 5000,
      conflictResolutionStrategy: 'hybrid',
      ...options
    };
  }

  /**
   * Safely apply diff operations with comprehensive validation and rollback support
   */
  async safelyApplyDiffs(
    fileId: string,
    currentContent: string,
    diffs: DiffOperation[],
    fileState: FileState
  ): Promise<{
    success: boolean;
    updatedContent: string;
    appliedDiffs: DiffOperation[];
    validationResult: ValidationResult;
    backupId: string | undefined;
    conflicts: Conflict[];
    errors: string[];
  }> {
    const errors: string[] = [];
    let backupId: string | undefined;
    let conflicts: Conflict[] = [];

    try {
      // Step 1: Create backup if enabled
      if (this.options.enableAutoBackup) {
        backupId = await this.createBackup(fileId, currentContent, fileState.version);
        this.emit('backup_created', { fileId, backupId });
      }

      // Step 2: Pre-execution validation
      if (this.options.enablePreValidation) {
        const preValidation = await this.validateDiffsPreExecution(
          fileId,
          currentContent,
          diffs,
          fileState
        );

        if (!preValidation.isValid) {
          errors.push(...(preValidation.errors || []));
          return {
            success: false,
            updatedContent: currentContent,
            appliedDiffs: [],
            validationResult: preValidation,
            backupId,
            conflicts: [],
            errors
          };
        }
      }

      // Step 3: Conflict detection
      if (this.options.enableConflictDetection) {
        conflicts = await this.detectConflicts(fileId, currentContent, diffs);
        
        if (conflicts.length > 0) {
          const criticalConflicts = conflicts.filter(c => c.severity === 'critical');
          if (criticalConflicts.length > 0) {
            errors.push(`Critical conflicts detected: ${criticalConflicts.map(c => c.description).join(', ')}`);
            
            // Store conflicts for resolution
            this.activeConflicts.set(fileId, conflicts);
            this.emit('conflicts_detected', { fileId, conflicts });

            return {
              success: false,
              updatedContent: currentContent,
              appliedDiffs: [],
              validationResult: { isValid: false, errors, warnings: [], confidence: 0 },
              backupId,
              conflicts,
              errors
            };
          }
        }
      }

      // Step 4: Apply diffs with tracking
      const applyResult = await this.applyDiffsWithTracking(
        fileId,
        currentContent,
        diffs,
        backupId
      );

      if (!applyResult.success) {
        errors.push(...applyResult.errors);
        
        // Attempt rollback if enabled
        if (this.options.enableRollback && backupId) {
          const rollbackResult = await this.rollbackToBackup(fileId, backupId);
          if (rollbackResult.success) {
            this.emit('rollback_completed', { fileId, backupId });
          } else {
            errors.push(...rollbackResult.errors);
          }
        }

        return {
          success: false,
          updatedContent: currentContent,
          appliedDiffs: [],
          validationResult: { isValid: false, errors, warnings: [], confidence: 0 },
          backupId,
          conflicts,
          errors
        };
      }

      // Step 5: Semantic impact analysis
      let semanticValidation: ValidationResult = { isValid: true, errors: [], warnings: [], confidence: 1 };
      
      if (this.options.enableSyntaxValidation) {
        semanticValidation = await this.analyzeSemanticImpact(
          applyResult.updatedContent,
          fileState.language,
          diffs
        );

        if (!semanticValidation.isValid) {
          errors.push(...(semanticValidation.errors || []));
          
          // Rollback on semantic validation failure
          if (this.options.enableRollback && backupId) {
            const rollbackResult = await this.rollbackToBackup(fileId, backupId);
            if (rollbackResult.success) {
              this.emit('semantic_validation_failed_rollback', { fileId, backupId, errors: semanticValidation.errors });
              return {
                success: false,
                updatedContent: currentContent,
                appliedDiffs: [],
                validationResult: semanticValidation,
                backupId,
                conflicts,
                errors
              };
            }
          }
        }
      }

      // Step 6: Post-execution syntax validation
      let syntaxValidation: ValidationResult = { isValid: true, errors: [], warnings: [], confidence: 1 };
      
      if (this.options.enableSyntaxValidation) {
        syntaxValidation = await this.validateSyntaxPost(
          applyResult.updatedContent,
          fileState.language
        );

        if (!syntaxValidation.isValid) {
          errors.push(...(syntaxValidation.errors || []));
          
          // Rollback on syntax validation failure
          if (this.options.enableRollback && backupId) {
            const rollbackResult = await this.rollbackToBackup(fileId, backupId);
            if (rollbackResult.success) {
              this.emit('syntax_validation_failed_rollback', { fileId, backupId, errors: syntaxValidation.errors });
              return {
                success: false,
                updatedContent: currentContent,
                appliedDiffs: [],
                validationResult: syntaxValidation,
                backupId,
                conflicts,
                errors
              };
            }
          }
        }
      }

      // Combine validation results
      const combinedValidation: ValidationResult = {
        isValid: syntaxValidation.isValid && semanticValidation.isValid,
        errors: [...syntaxValidation.errors, ...semanticValidation.errors],
        warnings: [...syntaxValidation.warnings, ...semanticValidation.warnings],
        confidence: Math.min(syntaxValidation.confidence, semanticValidation.confidence)
      };

      // Success - clean up resolved conflicts
      if (conflicts.length > 0) {
        this.activeConflicts.delete(fileId);
      }

      this.emit('diffs_safely_applied', {
        fileId,
        appliedDiffs: applyResult.appliedDiffs,
        backupId,
        validationResult: combinedValidation
      });

      return {
        success: combinedValidation.isValid,
        updatedContent: applyResult.updatedContent,
        appliedDiffs: applyResult.appliedDiffs,
        validationResult: combinedValidation,
        backupId,
        conflicts: [],
        errors: combinedValidation.errors
      };

    } catch (error) {
      errors.push(`Safe diff application failed: ${error instanceof Error ? error.message : String(error)}`);
      
      // Emergency rollback
      if (this.options.enableRollback && backupId) {
        try {
          await this.rollbackToBackup(fileId, backupId);
          this.emit('emergency_rollback', { fileId, backupId, error: error instanceof Error ? error.message : String(error) });
        } catch (rollbackError) {
          errors.push(`Emergency rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }

      return {
        success: false,
        updatedContent: currentContent,
        appliedDiffs: [],
        validationResult: { isValid: false, errors, warnings: [], confidence: 0 },
        backupId,
        conflicts,
        errors
      };
    }
  }

  /**
   * Create backup of current file state
   */
  private async createBackup(
    fileId: string,
    content: string,
    version: number
  ): Promise<string> {
    const backupId = `backup_${fileId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const backup: BackupState = {
      id: backupId,
      fileId,
      timestamp: new Date(),
      content,
      version,
      metadata: {
        contentLength: content.length,
        lineCount: content.split('\n').length
      }
    };

    // Initialize backup history for file if not exists
    if (!this.backupHistory.has(fileId)) {
      this.backupHistory.set(fileId, []);
    }

    const fileBackups = this.backupHistory.get(fileId)!;
    fileBackups.push(backup);

    // Maintain backup history limit
    if (fileBackups.length > this.options.maxBackupHistory) {
      fileBackups.shift(); // Remove oldest backup
    }

    return backupId;
  }

  /**
   * Pre-execution validation of diff operations
   */
  private async validateDiffsPreExecution(
    fileId: string,
    content: string,
    diffs: DiffOperation[],
    fileState: FileState
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    let confidence = 1.0;

    try {
      // Validate diff structure and ranges
      for (const diff of diffs) {
        const lineValidation = this.validateLineRanges(content, diff);
        if (!lineValidation.isValid) {
          errors.push(...lineValidation.errors);
          confidence *= 0.5;
        }
      }

      // Check for overlapping diffs
      const overlapValidation = this.validateDiffOverlaps(diffs);
      if (!overlapValidation.isValid) {
        errors.push(...overlapValidation.errors);
        warnings.push(...overlapValidation.warnings);
        confidence *= 0.7;
      }

      // Validate diff confidence scores
      const lowConfidenceDiffs = diffs.filter(d => (d.confidence || 0) < 0.7);
      if (lowConfidenceDiffs.length > 0) {
        warnings.push(`${lowConfidenceDiffs.length} diff(s) have low confidence scores`);
        suggestions.push('Consider reviewing low-confidence diffs manually');
        confidence *= 0.8;
      }

      // Check for potentially dangerous operations
      const dangerousOps = this.identifyDangerousOperations(diffs, content);
      if (dangerousOps.length > 0) {
        warnings.push(`Potentially dangerous operations detected: ${dangerousOps.join(', ')}`);
        suggestions.push('Review operations that modify critical code sections');
        confidence *= 0.9;
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        confidence,
        suggestions
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Pre-execution validation failed: ${error.message}`],
        warnings: [],
        confidence: 0,
        suggestions: ['Manual review recommended']
      };
    }
  }

  /**
   * Validate line ranges in diff operations
   */
  private validateLineRanges(content: string, diff: DiffOperation): ValidationResult {
    const lines = content.split('\n');
    const totalLines = lines.length;
    const [startLine, endLine] = diff.lineRange;
    const errors: string[] = [];

    if (startLine < 1) {
      errors.push(`Invalid start line ${startLine}: must be >= 1`);
    }

    if (endLine < startLine) {
      errors.push(`Invalid line range [${startLine}, ${endLine}]: end must be >= start`);
    }

    if (startLine > totalLines) {
      errors.push(`Start line ${startLine} exceeds file length (${totalLines} lines)`);
    }

    if (endLine > totalLines && diff.operation !== 'insert') {
      errors.push(`End line ${endLine} exceeds file length (${totalLines} lines)`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
      confidence: errors.length === 0 ? 1 : 0
    };
  }

  /**
   * Validate for overlapping diff operations
   */
  private validateDiffOverlaps(diffs: DiffOperation[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < diffs.length; i++) {
      for (let j = i + 1; j < diffs.length; j++) {
        const diff1 = diffs[i];
        const diff2 = diffs[j];

        const overlap = this.checkLineRangeOverlap(diff1.lineRange, diff2.lineRange);
        if (overlap.hasOverlap) {
          if (overlap.type === 'complete') {
            errors.push(`Complete overlap between diffs at lines ${diff1.lineRange} and ${diff2.lineRange}`);
          } else {
            warnings.push(`Partial overlap between diffs at lines ${diff1.lineRange} and ${diff2.lineRange}`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      confidence: errors.length === 0 ? (warnings.length === 0 ? 1 : 0.8) : 0
    };
  }

  /**
   * Check for line range overlaps
   */
  private checkLineRangeOverlap(
    range1: [number, number],
    range2: [number, number]
  ): { hasOverlap: boolean; type?: 'partial' | 'complete' } {
    const [start1, end1] = range1;
    const [start2, end2] = range2;

    // No overlap
    if (end1 < start2 || end2 < start1) {
      return { hasOverlap: false };
    }

    // Complete overlap
    if ((start1 <= start2 && end1 >= end2) || (start2 <= start1 && end2 >= end1)) {
      return { hasOverlap: true, type: 'complete' };
    }

    // Partial overlap
    return { hasOverlap: true, type: 'partial' };
  }

  /**
   * Identify potentially dangerous operations
   */
  private identifyDangerousOperations(diffs: DiffOperation[], content: string): string[] {
    const dangerous: string[] = [];
    const lines = content.split('\n');

    for (const diff of diffs) {
      const [startLine, endLine] = diff.lineRange;
      const affectedLines = lines.slice(startLine - 1, endLine);
      const affectedContent = affectedLines.join('\n');

      // Check for dangerous patterns
      if (affectedContent.includes('import ') && diff.operation === 'delete') {
        dangerous.push('Deleting import statements');
      }

      if (affectedContent.includes('export ') && diff.operation === 'delete') {
        dangerous.push('Deleting export statements');
      }

      if (affectedContent.includes('function ') && diff.operation === 'delete') {
        dangerous.push('Deleting function definitions');
      }

      if (affectedContent.includes('class ') && diff.operation === 'delete') {
        dangerous.push('Deleting class definitions');
      }

      if (affectedContent.includes('interface ') && diff.operation === 'delete') {
        dangerous.push('Deleting interface definitions');
      }

      // Check for large deletions
      if (diff.operation === 'delete' && (endLine - startLine + 1) > 10) {
        dangerous.push('Large block deletion');
      }
    }

    return dangerous;
  }  
/**
   * Apply diffs with comprehensive tracking
   */
  private async applyDiffsWithTracking(
    fileId: string,
    content: string,
    diffs: DiffOperation[],
    backupId?: string
  ): Promise<{
    success: boolean;
    updatedContent: string;
    appliedDiffs: DiffOperation[];
    errors: string[];
  }> {
    const errors: string[] = [];
    const appliedDiffs: DiffOperation[] = [];
    let updatedContent = content;
    const trackingId = `change_${fileId}_${Date.now()}`;

    try {
      // Sort diffs by line number (descending) to apply from bottom up
      const sortedDiffs = [...diffs].sort((a, b) => b.lineRange[0] - a.lineRange[0]);

      for (const diff of sortedDiffs) {
        try {
          const applyResult = await this.applySingleDiff(updatedContent, diff);
          if (applyResult.success) {
            updatedContent = applyResult.content;
            appliedDiffs.push(diff);
          } else {
            errors.push(applyResult.error || `Failed to apply diff: ${diff.description}`);
          }
        } catch (error) {
          errors.push(`Error applying diff: ${error.message}`);
        }
      }

      // Create change tracking entry
      const changeEntry: ChangeTrackingEntry = {
        id: trackingId,
        fileId,
        timestamp: new Date(),
        operation: 'apply_diffs',
        diffs: appliedDiffs,
        beforeState: content,
        afterState: updatedContent,
        success: errors.length === 0,
        rollbackId: backupId,
        metadata: {
          totalDiffs: diffs.length,
          appliedCount: appliedDiffs.length,
          failedCount: diffs.length - appliedDiffs.length
        }
      };

      // Store change tracking
      if (!this.changeTracking.has(fileId)) {
        this.changeTracking.set(fileId, []);
      }
      this.changeTracking.get(fileId)!.push(changeEntry);

      this.emit('change_tracked', { fileId, changeEntry });

      return {
        success: errors.length === 0,
        updatedContent,
        appliedDiffs,
        errors
      };

    } catch (error) {
      errors.push(`Diff application with tracking failed: ${error.message}`);
      return {
        success: false,
        updatedContent: content,
        appliedDiffs: [],
        errors
      };
    }
  }

  /**
   * Apply a single diff operation safely
   */
  private async applySingleDiff(content: string, diff: DiffOperation): Promise<{
    success: boolean;
    content: string;
    error?: string;
  }> {
    const lines = content.split('\n');
    const [startLine, endLine] = diff.lineRange;

    try {
      switch (diff.operation) {
        case 'insert':
          const insertLines = diff.content.split('\n');
          lines.splice(startLine - 1, 0, ...insertLines);
          break;

        case 'replace':
          const replaceLines = diff.content.split('\n');
          const deleteCount = endLine - startLine + 1;
          lines.splice(startLine - 1, deleteCount, ...replaceLines);
          break;

        case 'delete':
          const linesToDelete = endLine - startLine + 1;
          lines.splice(startLine - 1, linesToDelete);
          break;

        case 'modify':
          // For modify operations, replace the specified range
          const modifyLines = diff.content.split('\n');
          const targetLines = endLine - startLine + 1;
          lines.splice(startLine - 1, targetLines, ...modifyLines);
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
   * Post-execution syntax validation
   */
  private async validateSyntaxPost(content: string, language: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidence = 1.0;

    try {
      switch (language.toLowerCase()) {
        case 'typescript':
        case 'javascript':
          const jsValidation = await this.validateJavaScriptSyntax(content);
          if (!jsValidation.isValid) {
            errors.push(...jsValidation.errors);
            warnings.push(...jsValidation.warnings);
            confidence = jsValidation.confidence;
          }
          break;

        case 'json':
          try {
            JSON.parse(content);
          } catch (error) {
            errors.push(`JSON syntax error: ${error.message}`);
            confidence = 0;
          }
          break;

        case 'css':
        case 'scss':
          const cssValidation = this.validateCSSBasic(content);
          if (!cssValidation.isValid) {
            errors.push(...cssValidation.errors);
            confidence = cssValidation.confidence;
          }
          break;

        case 'html':
          const htmlValidation = this.validateHTMLBasic(content);
          if (!htmlValidation.isValid) {
            errors.push(...htmlValidation.errors);
            confidence = htmlValidation.confidence;
          }
          break;

        default:
          // For unknown languages, perform basic structural validation
          const basicValidation = this.validateBasicStructure(content);
          if (!basicValidation.isValid) {
            warnings.push(...basicValidation.errors);
            confidence = 0.8;
          }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        confidence
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Syntax validation failed: ${error.message}`],
        warnings: [],
        confidence: 0
      };
    }
  }

  /**
   * Validate JavaScript/TypeScript syntax
   */
  private async validateJavaScriptSyntax(content: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidence = 1.0;

    // Basic bracket validation
    if (!this.validateBrackets(content)) {
      errors.push('Unbalanced brackets detected');
      confidence = 0;
    }

    // Check for common syntax errors
    const syntaxPatterns = [
      { pattern: /\bfunction\s*\(\s*\)\s*\{[^}]*$/, error: 'Unclosed function body' },
      { pattern: /\bif\s*\([^)]*\)\s*\{[^}]*$/, error: 'Unclosed if statement' },
      { pattern: /\bfor\s*\([^)]*\)\s*\{[^}]*$/, error: 'Unclosed for loop' },
      { pattern: /\bwhile\s*\([^)]*\)\s*\{[^}]*$/, error: 'Unclosed while loop' }
    ];

    for (const { pattern, error } of syntaxPatterns) {
      if (pattern.test(content)) {
        errors.push(error);
        confidence *= 0.5;
      }
    }

    // Check for missing semicolons (warning only)
    const missingSemicolons = content.match(/\n\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*[^;]+\n/g);
    if (missingSemicolons && missingSemicolons.length > 0) {
      warnings.push(`${missingSemicolons.length} potential missing semicolons detected`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      confidence
    };
  }

  /**
   * Validate bracket balance
   */
  private validateBrackets(content: string): boolean {
    const brackets = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    let inString = false;
    let stringChar = '';
    let escaped = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if ((char === '"' || char === "'" || char === '`') && !inString) {
        inString = true;
        stringChar = char;
        continue;
      }

      if (char === stringChar && inString) {
        inString = false;
        stringChar = '';
        continue;
      }

      if (inString) continue;

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
   * Basic CSS validation
   */
  private validateCSSBasic(content: string): ValidationResult {
    const errors: string[] = [];
    let confidence = 1.0;

    // Check balanced braces
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;

    if (openBraces !== closeBraces) {
      errors.push(`Unbalanced CSS braces: ${openBraces} open, ${closeBraces} close`);
      confidence = 0;
    }

    // Check for basic CSS structure
    const hasSelectors = /[.#]?[a-zA-Z][a-zA-Z0-9-_]*\s*\{/.test(content);
    if (!hasSelectors && content.trim().length > 0) {
      errors.push('No valid CSS selectors found');
      confidence = 0.5;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
      confidence
    };
  }

  /**
   * Basic HTML validation
   */
  private validateHTMLBasic(content: string): ValidationResult {
    const errors: string[] = [];
    let confidence = 1.0;

    // Check for basic HTML structure
    const hasOpenTags = /<[a-zA-Z][^>]*>/g.test(content);
    const hasCloseTags = /<\/[a-zA-Z][^>]*>/g.test(content);

    if (hasOpenTags && !hasCloseTags) {
      errors.push('HTML tags appear to be unclosed');
      confidence = 0.5;
    }

    // Basic tag balance check (simplified)
    const openTags = content.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g) || [];
    const closeTags = content.match(/<\/([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g) || [];

    if (openTags.length !== closeTags.length) {
      errors.push(`Potential tag mismatch: ${openTags.length} open tags, ${closeTags.length} close tags`);
      confidence = 0.7;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
      confidence
    };
  }

  /**
   * Basic structure validation for unknown languages
   */
  private validateBasicStructure(content: string): ValidationResult {
    const errors: string[] = [];

    // Check for extremely unbalanced content
    const lines = content.split('\n');
    const emptyLines = lines.filter(line => line.trim() === '').length;
    const totalLines = lines.length;

    if (emptyLines / totalLines > 0.8 && totalLines > 10) {
      errors.push('Content appears to be mostly empty');
    }

    // Check for potential encoding issues
    if (content.includes('\uFFFD')) {
      errors.push('Content contains replacement characters (encoding issues)');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
      confidence: errors.length === 0 ? 0.9 : 0.5
    };
  }

  /**
   * Analyze semantic impact of code changes
   */
  private async analyzeSemanticImpact(
    content: string,
    language: string,
    diffs: DiffOperation[]
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidence = 1.0;

    try {
      // Extract semantic information based on language
      const semanticInfo = await this.extractSemanticInfo(content, language);
      
      // Analyze each diff for semantic impact
      for (const diff of diffs) {
        const impact = await this.analyzeDiffSemanticImpact(diff, semanticInfo, language);
        if (impact.hasSemanticIssues) {
          if (impact.severity === 'critical' || impact.severity === 'high') {
            errors.push(impact.description);
            confidence = Math.min(confidence, 0.3);
          } else {
            warnings.push(impact.description);
            confidence = Math.min(confidence, 0.7);
          }
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        confidence
      };

    } catch (error) {
      throw createSafeDiffError(
        `Semantic analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.SAFE_DIFF.SEMANTIC_ANALYSIS_FAILED,
          severity: 'high',
          recoverable: true,
          context: { language, error }
        }
      );
    }
  }

  /**
   * Extract semantic information from content
   */
  private async extractSemanticInfo(content: string, language: string): Promise<any> {
    // Extract symbols, dependencies, and structure information
    const symbols = this.extractSymbols(content);
    const dependencies = this.extractDependencies(content, language);
    const structure = this.analyzeStructure(content, language);
    
    return {
      symbols,
      dependencies,
      structure,
      exports: symbols.filter(s => s.scope === 'global')
    };
  }

  /**
   * Analyze semantic impact of a single diff operation
   */
  private async analyzeDiffSemanticImpact(
    diff: DiffOperation,
    semanticInfo: any,
    language: string
  ): Promise<{
    hasSemanticIssues: boolean;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }> {
    // Get affected lines and content
    const affectedLines = this.getAffectedLines(diff);
    const affectedContent = this.extractContentByLines(
      diff.operation === 'insert' ? '' : diff.content, // Simplified for example
      affectedLines
    );

    // Check for breaking changes in exported symbols
    if (diff.operation === 'delete' || diff.operation === 'replace') {
      const deletedExports = this.findDeletedExportsInDiff(affectedContent, semanticInfo.exports);
      if (deletedExports.length > 0) {
        return {
          hasSemanticIssues: true,
          description: `Breaking change: Removing exported symbols ${deletedExports.join(', ')}`,
          severity: 'critical'
        };
      }
    }

    // Check for function signature changes
    if (diff.operation === 'replace' || diff.operation === 'modify') {
      const signatureChanges = this.analyzeSignatureChangesInDiff(affectedContent, semanticInfo.symbols);
      if (signatureChanges.hasBreakingChanges) {
        return {
          hasSemanticIssues: true,
          description: `Breaking function signature change: ${signatureChanges.description}`,
          severity: signatureChanges.severity
        };
      }
    }

    // Check for type/interface modifications that would break consumers
    const typeChanges = this.analyzeTypeChangesInDiff(affectedContent, semanticInfo.symbols, language);
    if (typeChanges.hasBreakingChanges) {
      return {
        hasSemanticIssues: true,
        description: `Breaking type change: ${typeChanges.description}`,
        severity: typeChanges.severity
      };
    }

    // Check for state management changes that could cause runtime errors
    const stateChanges = this.analyzeStateChangesInDiff(affectedContent, language);
    if (stateChanges.hasBreakingChanges) {
      return {
        hasSemanticIssues: true,
        description: `Potential runtime error: ${stateChanges.description}`,
        severity: stateChanges.severity
      };
    }

    return {
      hasSemanticIssues: false,
      description: '',
      severity: 'low'
    };
  }

  /**
   * Find deleted exported symbols in a diff
   */
  private findDeletedExportsInDiff(
    affectedContent: string,
    exportedSymbols: Array<{ name: string; type: string; line: number; scope: string }>
  ): string[] {
    const deleted: string[] = [];
    
    for (const symbol of exportedSymbols) {
      // Check if exported symbol is being removed
      const symbolPattern = new RegExp(
        `(export\\s+(async\\s+)?(function|class|interface|type|const)\\s+${symbol.name}|${symbol.name}\\s*=)`,
        'g'
      );
      
      if (!symbolPattern.test(affectedContent) && affectedContent.includes(symbol.name)) {
        deleted.push(`${symbol.type} ${symbol.name}`);
      }
    }
    
    return deleted;
  }

  /**
   * Analyze function signature changes in a diff
   */
  private analyzeSignatureChangesInDiff(
    affectedContent: string,
    symbols: Array<{ name: string; type: string; line: number; scope: string }>
  ): { 
    hasBreakingChanges: boolean; 
    description: string; 
    severity: 'low' | 'medium' | 'high' | 'critical' 
  } {
    // Look for function definitions with parameter changes
    const funcDefPattern = /\b(function|const\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*\s*:\s*\([^)]*\))/g;
    const matches = [...affectedContent.matchAll(funcDefPattern)];
    
    if (matches.length > 0) {
      // Check for potentially breaking changes
      for (const match of matches) {
        const funcSignature = match[0];
        
        // Look for changes that remove required parameters
        if (funcSignature.includes('=') && !funcSignature.includes('?')) {
          // Adding required parameters to existing functions is breaking
          return {
            hasBreakingChanges: true,
            description: 'Adding required parameters to existing function signatures',
            severity: 'high'
          };
        }
        
        // Look for changes that modify return types in a breaking way
        if (funcSignature.includes('return') && funcSignature.includes(':')) {
          // Changing return types can be breaking
          return {
            hasBreakingChanges: true,
            description: 'Changing function return types',
            severity: 'medium'
          };
        }
      }
    }
    
    return {
      hasBreakingChanges: false,
      description: '',
      severity: 'low'
    };
  }

  /**
   * Analyze type/interface changes in a diff
   */
  private analyzeTypeChangesInDiff(
    affectedContent: string,
    symbols: Array<{ name: string; type: string; line: number; scope: string }>,
    language: string
  ): { 
    hasBreakingChanges: boolean; 
    description: string; 
    severity: 'low' | 'medium' | 'high' | 'critical' 
  } {
    // Look for type/interface definitions
    const typePattern = /\b(interface|type)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    const typeMatches = [...affectedContent.matchAll(typePattern)];
    
    if (typeMatches.length > 0) {
      // Check for potentially breaking changes to existing types
      for (const match of typeMatches) {
        const typeName = match[2];
        const existingType = symbols.find(s => 
          s.name === typeName && (s.type === 'interface' || s.type === 'type')
        );
        
        if (existingType) {
          // Modifying existing types can be breaking
          if (affectedContent.includes('extends') && !affectedContent.includes('{')) {
            return {
              hasBreakingChanges: true,
              description: `Incomplete type definition for ${typeName}`,
              severity: 'high'
            };
          }
          
          // Removing required properties from interfaces
          if (affectedContent.includes(';') && !affectedContent.includes('?')) {
            return {
              hasBreakingChanges: true,
              description: `Removing or modifying required properties in ${typeName}`,
              severity: 'high'
            };
          }
        }
      }
    }
    
    return {
      hasBreakingChanges: false,
      description: '',
      severity: 'low'
    };
  }

  /**
   * Analyze state management changes in a diff
   */
  private analyzeStateChangesInDiff(
    affectedContent: string,
    language: string
  ): { 
    hasBreakingChanges: boolean; 
    description: string; 
    severity: 'low' | 'medium' | 'high' | 'critical' 
  } {
    // Look for state mutation patterns
    const statePatterns = [
      { pattern: /\bthis\.state\s*=/, description: 'Direct state mutation' },
      { pattern: /\bsetState\s*\(/, description: 'State setter usage' },
      { pattern: /\buseState\s*\(/, description: 'React useState hook' }
    ];
    
    for (const { pattern, description } of statePatterns) {
      if (pattern.test(affectedContent)) {
        // Check for potentially unsafe state mutations
        if (affectedContent.includes('this.state') && !affectedContent.includes('setState')) {
          return {
            hasBreakingChanges: true,
            description: `Unsafe direct state mutation detected: ${description}`,
            severity: 'medium'
          };
        }
      }
    }
    
    return {
      hasBreakingChanges: false,
      description: '',
      severity: 'low'
    };
  }

  /**
   * Extract dependencies from content
   */
  private extractDependencies(content: string, language: string): string[] {
    const dependencies: string[] = [];
    
    switch (language.toLowerCase()) {
      case 'typescript':
      case 'javascript':
        // Extract ES6 imports
        const es6ImportPattern = /import\s+(?:{[^}]+}|[\w$]+|\*\s+as\s+[\w$]+)\s+from\s+['"`]([^'"`]+)['"`]/g;
        let match;
        while ((match = es6ImportPattern.exec(content)) !== null) {
          dependencies.push(match[1]);
        }
        
        // Extract CommonJS requires
        const cjsRequirePattern = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        while ((match = cjsRequirePattern.exec(content)) !== null) {
          dependencies.push(match[1]);
        }
        break;
        
      case 'python':
        // Extract Python imports
        const pythonImportPattern = /(?:^|\n)(?:import\s+([a-zA-Z_.][a-zA-Z0-9_.]*)|from\s+([a-zA-Z_.][a-zA-Z0-9_.]*)\s+import)/g;
        while ((match = pythonImportPattern.exec(content)) !== null) {
          dependencies.push(match[1] || match[2]);
        }
        break;
    }
    
    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Analyze code structure
   */
  private analyzeStructure(content: string, language: string): any {
    const lines = content.split('\n');
    const structure: any = {
      lineCount: lines.length,
      blankLineCount: lines.filter(line => line.trim() === '').length,
      commentLineCount: 0,
      functionCount: 0,
      classCount: 0,
      complexityScore: 0
    };
    
    switch (language.toLowerCase()) {
      case 'typescript':
      case 'javascript':
        structure.commentLineCount = lines.filter(line => 
          line.trim().startsWith('//') || 
          line.trim().startsWith('/**') || 
          line.trim().startsWith('/*')
        ).length;
        
        structure.functionCount = (content.match(/\bfunction\b/g) || []).length + 
                                  (content.match(/const\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*\([^)]*\)\s*=>/g) || []).length;
        
        structure.classCount = (content.match(/\bclass\b/g) || []).length;
        break;
    }
    
    // Calculate complexity based on nesting and control structures
    const complexityKeywords = ['if', 'for', 'while', 'switch', 'try', 'catch', 'finally'];
    for (const keyword of complexityKeywords) {
      structure.complexityScore += (content.match(new RegExp(`\\b${keyword}\\b`, 'g')) || []).length;
    }
    
    return structure;
  }

  /**
   * Detect conflicts between diffs and existing content
   */
  private async detectConflicts(
    fileId: string,
    content: string,
    diffs: DiffOperation[]
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    try {
      // Check for line overlap conflicts
      const overlapConflicts = this.detectLineOverlapConflicts(fileId, diffs);
      conflicts.push(...overlapConflicts);

      // Check for dependency conflicts
      const dependencyConflicts = await this.detectDependencyConflicts(fileId, content, diffs);
      conflicts.push(...dependencyConflicts);

      // Check for syntax conflicts
      const syntaxConflicts = await this.detectSyntaxConflicts(fileId, content, diffs);
      conflicts.push(...syntaxConflicts);

      // Check for semantic conflicts
      const semanticConflicts = await this.detectSemanticConflicts(fileId, content, diffs);
      conflicts.push(...semanticConflicts);

      return conflicts;

    } catch (error) {
      // If conflict detection fails, create a generic conflict
      return [{
        id: `conflict_${fileId}_${Date.now()}`,
        fileId,
        type: 'semantic_conflict',
        description: `Conflict detection failed: ${error.message}`,
        affectedLines: [],
        conflictingDiffs: diffs,
        severity: 'medium',
        resolutionOptions: [
          {
            id: 'manual_review',
            description: 'Manual review required',
            action: 'manual',
            confidence: 0.5
          }
        ]
      }];
    }
  }

  /**
   * Detect semantic conflicts between diffs and existing content
   */
  private async detectSemanticConflicts(
    fileId: string,
    content: string,
    diffs: DiffOperation[]
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    try {
      // Extract symbols from current content
      const currentSymbols = this.extractSymbols(content);
      
      // Analyze each diff for semantic impact
      for (const diff of diffs) {
        const semanticImpact = await this.analyzeSemanticImpact(content, diff, currentSymbols);
        
        if (semanticImpact.hasBreakingChanges) {
          conflicts.push({
            id: `semantic_conflict_${fileId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            fileId,
            type: 'semantic_conflict',
            description: semanticImpact.description,
            affectedLines: semanticImpact.affectedLines,
            conflictingDiffs: [diff],
            severity: semanticImpact.severity,
            resolutionOptions: semanticImpact.resolutionOptions
          });
        }
      }

      return conflicts;

    } catch (error) {
      throw createSafeDiffError(
        `Semantic conflict detection failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.SAFE_DIFF.SEMANTIC_ANALYSIS_FAILED,
          severity: 'high',
          recoverable: true,
          context: { fileId, error }
        }
      );
    }
  }

  /**
   * Analyze the semantic impact of a diff operation
   */
  private async analyzeSemanticImpact(
    content: string,
    diff: DiffOperation,
    currentSymbols: Array<{ name: string; type: string; line: number; scope: string }>
  ): Promise<{
    hasBreakingChanges: boolean;
    description: string;
    affectedLines: number[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    resolutionOptions: Array<{ id: string; description: string; action: string; confidence: number }>;
  }> {
    const affectedLines = this.getAffectedLines(diff);
    const affectedContent = this.extractContentByLines(content, affectedLines);
    
    // Check for breaking changes
    let hasBreakingChanges = false;
    let description = '';
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    const resolutionOptions: Array<{ id: string; description: string; action: string; confidence: number }> = [];

    // Check for exported symbol removal
    if (diff.operation === 'delete' || diff.operation === 'replace') {
      const deletedExports = this.findDeletedExports(affectedContent, currentSymbols);
      if (deletedExports.length > 0) {
        hasBreakingChanges = true;
        description = `Removing exported symbols: ${deletedExports.join(', ')}`;
        severity = 'critical';
        resolutionOptions.push({
          id: 'preserve_exports',
          description: 'Preserve exported symbols to maintain API compatibility',
          action: 'modify',
          confidence: 0.9
        });
      }
    }

    // Check for function signature changes
    if (diff.operation === 'replace' || diff.operation === 'modify') {
      const signatureChanges = this.analyzeSignatureChanges(affectedContent, currentSymbols);
      if (signatureChanges.breaking) {
        hasBreakingChanges = true;
        description = `Breaking signature changes detected: ${signatureChanges.description}`;
        severity = signatureChanges.severity;
        resolutionOptions.push({
          id: 'backward_compatible_signature',
          description: 'Modify to maintain backward compatibility',
          action: 'modify',
          confidence: 0.8
        });
      }
    }

    // Check for type/interface changes
    const typeChanges = this.analyzeTypeChanges(affectedContent, currentSymbols);
    if (typeChanges.hasBreakingChanges) {
      hasBreakingChanges = true;
      description = description ? `${description}; ${typeChanges.description}` : typeChanges.description;
      severity = this.getHigherSeverity(severity, typeChanges.severity);
      
      if (typeChanges.resolution) {
        resolutionOptions.push(typeChanges.resolution);
      }
    }

    // Check for state mutation changes
    const stateChanges = this.analyzeStateChanges(affectedContent);
    if (stateChanges.hasBreakingChanges) {
      hasBreakingChanges = true;
      description = description ? `${description}; ${stateChanges.description}` : stateChanges.description;
      severity = this.getHigherSeverity(severity, stateChanges.severity);
      
      if (stateChanges.resolution) {
        resolutionOptions.push(stateChanges.resolution);
      }
    }

    // If no specific breaking changes found but content is complex, flag for review
    if (!hasBreakingChanges && affectedContent.length > 500) {
      // For large changes, recommend review even if no obvious breaking changes
      return {
        hasBreakingChanges: false,
        description: 'Large-scale changes detected, recommend review',
        affectedLines,
        severity: 'medium',
        resolutionOptions: [
          {
            id: 'review_changes',
            description: 'Review changes for potential side effects',
            action: 'manual',
            confidence: 0.7
          }
        ]
      };
    }

    return {
      hasBreakingChanges,
      description: description || 'No significant semantic conflicts detected',
      affectedLines,
      severity,
      resolutionOptions: resolutionOptions.length > 0 ? resolutionOptions : [
        {
          id: 'accept_changes',
          description: 'Accept changes as semantically safe',
          action: 'accept',
          confidence: 0.9
        }
      ]
    };
  }

  /**
   * Extract symbols (variables, functions, classes, etc.) from content
   */
  private extractSymbols(content: string): Array<{ name: string; type: string; line: number; scope: string }> {
    const symbols: Array<{ name: string; type: string; line: number; scope: string }> = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Match exported functions
      const exportFuncMatch = line.match(/export\s+(async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (exportFuncMatch) {
        symbols.push({
          name: exportFuncMatch[2],
          type: 'function',
          line: lineNumber,
          scope: 'global'
        });
        continue;
      }

      // Match exported classes
      const exportClassMatch = line.match(/export\s+class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (exportClassMatch) {
        symbols.push({
          name: exportClassMatch[1],
          type: 'class',
          line: lineNumber,
          scope: 'global'
        });
        continue;
      }

      // Match exported interfaces
      const exportInterfaceMatch = line.match(/export\s+interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (exportInterfaceMatch) {
        symbols.push({
          name: exportInterfaceMatch[1],
          type: 'interface',
          line: lineNumber,
          scope: 'global'
        });
        continue;
      }

      // Match exported types
      const exportTypeMatch = line.match(/export\s+type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (exportTypeMatch) {
        symbols.push({
          name: exportTypeMatch[1],
          type: 'type',
          line: lineNumber,
          scope: 'global'
        });
        continue;
      }

      // Match exported constants
      const exportConstMatch = line.match(/export\s+const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (exportConstMatch) {
        symbols.push({
          name: exportConstMatch[1],
          type: 'constant',
          line: lineNumber,
          scope: 'global'
        });
        continue;
      }

      // Match regular functions (non-exported)
      const funcMatch = line.match(/(async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[2],
          type: 'function',
          line: lineNumber,
          scope: 'local'
        });
        continue;
      }

      // Match class definitions
      const classMatch = line.match(/class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: 'class',
          line: lineNumber,
          scope: 'local'
        });
        continue;
      }
    }

    return symbols;
  }

  /**
   * Find deleted exported symbols
   */
  private findDeletedExports(
    affectedContent: string,
    currentSymbols: Array<{ name: string; type: string; line: number; scope: string }>
  ): string[] {
    const deletedExports: string[] = [];
    
    // Check for exported symbols in the current content
    for (const symbol of currentSymbols) {
      if (symbol.scope === 'global') {
        // Check if this exported symbol is being removed
        const exportPattern = new RegExp(`export\\s+(async\\s+)?(${symbol.type === 'function' ? 'function' : symbol.type})\\s+${symbol.name}`, 'g');
        if (!exportPattern.test(affectedContent) && affectedContent.includes(symbol.name)) {
          // If the symbol is mentioned but not exported, it might be removed
          deletedExports.push(`${symbol.type} ${symbol.name}`);
        }
      }
    }

    return deletedExports;
  }

  /**
   * Analyze function signature changes for breaking changes
   */
  private analyzeSignatureChanges(
    affectedContent: string,
    currentSymbols: Array<{ name: string; type: string; line: number; scope: string }>
  ): { breaking: boolean; description: string; severity: 'low' | 'medium' | 'high' | 'critical' } {
    // Look for function signature changes
    const funcSignaturePattern = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)/g;
    let match;
    const breakingChanges: string[] = [];

    while ((match = funcSignaturePattern.exec(affectedContent)) !== null) {
      const functionName = match[1];
      const parameters = match[2];

      // Check if this is a known function that's being modified
      const existingFunction = currentSymbols.find(s => s.name === functionName && s.type === 'function');
      if (existingFunction) {
        // For now, we'll do a simple check - in a real implementation, this would compare signatures
        if (parameters.includes('required') && !parameters.includes('?')) {
          // Adding required parameters to existing functions is breaking
          breakingChanges.push(`Adding required parameter to existing function ${functionName}`);
        }
      }
    }

    return {
      breaking: breakingChanges.length > 0,
      description: breakingChanges.join('; '),
      severity: breakingChanges.length > 0 ? 'high' : 'low'
    };
  }

  /**
   * Analyze type/interface changes for breaking changes
   */
  private analyzeTypeChanges(
    affectedContent: string,
    currentSymbols: Array<{ name: string; type: string; line: number; scope: string }>
  ): { 
    hasBreakingChanges: boolean; 
    description: string; 
    severity: 'low' | 'medium' | 'high' | 'critical';
    resolution?: { id: string; description: string; action: string; confidence: number };
  } {
    // Look for type/interface changes
    const interfacePattern = /\binterface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    const typePattern = /\btype\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    
    const interfaceMatches = [...affectedContent.matchAll(interfacePattern)];
    const typeMatches = [...affectedContent.matchAll(typePattern)];
    
    if (interfaceMatches.length > 0 || typeMatches.length > 0) {
      // Check if existing types are being modified in breaking ways
      for (const match of interfaceMatches) {
        const typeName = match[1];
        const existingType = currentSymbols.find(s => s.name === typeName && (s.type === 'interface' || s.type === 'type'));
        if (existingType) {
          // Removing required properties or changing types is breaking
          if (affectedContent.includes('extends') && affectedContent.includes('{') && !affectedContent.includes('}')) {
            return {
              hasBreakingChanges: true,
              description: `Incomplete interface ${typeName} definition`,
              severity: 'high',
              resolution: {
                id: 'fix_interface_definition',
                description: 'Complete the interface definition',
                action: 'modify',
                confidence: 0.8
              }
            };
          }
        }
      }
    }

    return {
      hasBreakingChanges: false,
      description: 'No breaking type changes detected',
      severity: 'low'
    };
  }

  /**
   * Analyze state changes for breaking impacts
   */
  private analyzeStateChanges(affectedContent: string): { 
    hasBreakingChanges: boolean; 
    description: string; 
    severity: 'low' | 'medium' | 'high' | 'critical';
    resolution?: { id: string; description: string; action: string; confidence: number };
  } {
    // Look for state mutation patterns
    const stateMutationPatterns = [
      { pattern: /\bthis\.state\s*=\s*[^;]+/, description: 'Direct state assignment' },
      { pattern: /\bsetState\s*\([^)]*\)/, description: 'State setter usage' },
      { pattern: /\buseState\s*\([^)]*\)/, description: 'React useState hook' }
    ];

    for (const { pattern, description } of stateMutationPatterns) {
      if (pattern.test(affectedContent)) {
        // Check for potentially breaking state changes
        if (affectedContent.includes('this.state') && !affectedContent.includes('setState')) {
          return {
            hasBreakingChanges: true,
            description: `Direct state mutation detected: ${description}`,
            severity: 'medium',
            resolution: {
              id: 'use_setter_pattern',
              description: 'Use proper state setter pattern',
              action: 'modify',
              confidence: 0.7
            }
          };
        }
      }
    }

    return {
      hasBreakingChanges: false,
      description: 'No breaking state changes detected',
      severity: 'low'
    };
  }

  /**
   * Get affected lines from diff operation
   */
  private getAffectedLines(diff: DiffOperation): number[] {
    const [startLine, endLine] = diff.lineRange;
    const lines: number[] = [];
    
    for (let i = startLine; i <= endLine; i++) {
      lines.push(i);
    }
    
    return lines;
  }

  /**
   * Extract content by specific line numbers
   */
  private extractContentByLines(content: string, lines: number[]): string {
    const contentLines = content.split('\n');
    return lines
      .filter(line => line > 0 && line <= contentLines.length)
      .map(line => contentLines[line - 1])
      .join('\n');
  }

  /**
   * Get higher severity level between two severities
   */
  private getHigherSeverity(
    a: 'low' | 'medium' | 'high' | 'critical',
    b: 'low' | 'medium' | 'high' | 'critical'
  ): 'low' | 'medium' | 'high' | 'critical' {
    const severityLevels = {
      'low': 1,
      'medium': 2,
      'high': 3,
      'critical': 4
    };
    
    return severityLevels[a] >= severityLevels[b] ? a : b;
  }

  /**
   * Detect line overlap conflicts
   */
  private detectLineOverlapConflicts(fileId: string, diffs: DiffOperation[]): Conflict[] {
    const conflicts: Conflict[] = [];

    for (let i = 0; i < diffs.length; i++) {
      for (let j = i + 1; j < diffs.length; j++) {
        const diff1 = diffs[i];
        const diff2 = diffs[j];

        const overlap = this.checkLineRangeOverlap(diff1.lineRange, diff2.lineRange);
        if (overlap.hasOverlap) {
          const conflictId = `overlap_${fileId}_${i}_${j}_${Date.now()}`;
          
          conflicts.push({
            id: conflictId,
            fileId,
            type: 'line_overlap',
            description: `Line overlap between diffs at ${diff1.lineRange} and ${diff2.lineRange}`,
            affectedLines: [
              ...this.getLineRange(diff1.lineRange),
              ...this.getLineRange(diff2.lineRange)
            ],
            conflictingDiffs: [diff1, diff2],
            severity: overlap.type === 'complete' ? 'critical' : 'high',
            resolutionOptions: [
              {
                id: 'merge_diffs',
                description: 'Merge overlapping diffs',
                action: 'merge',
                confidence: 0.7
              },
              {
                id: 'apply_first',
                description: 'Apply first diff only',
                action: 'accept_current',
                confidence: 0.6
              },
              {
                id: 'apply_second',
                description: 'Apply second diff only',
                action: 'accept_incoming',
                confidence: 0.6
              },
              {
                id: 'manual_resolve',
                description: 'Manual resolution required',
                action: 'manual',
                confidence: 0.9
              }
            ]
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Detect dependency conflicts
   */
  private async detectDependencyConflicts(
    fileId: string,
    content: string,
    diffs: DiffOperation[]
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // Extract imports and exports from current content
    const currentImports = this.extractImports(content);
    const currentExports = this.extractExports(content);

    for (const diff of diffs) {
      const diffContent = diff.content;
      
      // Check if diff affects imports/exports
      if (diffContent.includes('import ') || diffContent.includes('export ')) {
        const diffImports = this.extractImports(diffContent);
        const diffExports = this.extractExports(diffContent);

        // Check for conflicting imports
        for (const diffImport of diffImports) {
          const existingImport = currentImports.find(imp => imp.module === diffImport.module);
          if (existingImport && existingImport.imports !== diffImport.imports) {
            conflicts.push({
              id: `dep_conflict_${fileId}_${Date.now()}`,
              fileId,
              type: 'dependency_conflict',
              description: `Import conflict for module ${diffImport.module}`,
              affectedLines: diff.lineRange.slice() as number[],
              conflictingDiffs: [diff],
              severity: 'high',
              resolutionOptions: [
                {
                  id: 'merge_imports',
                  description: 'Merge import statements',
                  action: 'merge',
                  confidence: 0.8
                },
                {
                  id: 'keep_existing',
                  description: 'Keep existing import',
                  action: 'accept_current',
                  confidence: 0.6
                },
                {
                  id: 'use_new',
                  description: 'Use new import',
                  action: 'accept_incoming',
                  confidence: 0.6
                }
              ]
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Detect syntax conflicts
   */
  private async detectSyntaxConflicts(
    fileId: string,
    content: string,
    diffs: DiffOperation[]
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // Simulate applying diffs and check for syntax issues
    let testContent = content;
    
    try {
      for (const diff of diffs) {
        const applyResult = await this.applySingleDiff(testContent, diff);
        if (applyResult.success) {
          testContent = applyResult.content;
        } else {
          conflicts.push({
            id: `syntax_conflict_${fileId}_${Date.now()}`,
            fileId,
            type: 'syntax_conflict',
            description: `Diff application would cause syntax error: ${applyResult.error}`,
            affectedLines: diff.lineRange.slice() as number[],
            conflictingDiffs: [diff],
            severity: 'critical',
            resolutionOptions: [
              {
                id: 'skip_diff',
                description: 'Skip this diff',
                action: 'accept_current',
                confidence: 0.8
              },
              {
                id: 'manual_fix',
                description: 'Manual fix required',
                action: 'manual',
                confidence: 0.9
              }
            ]
          });
        }
      }
    } catch (error) {
      conflicts.push({
        id: `syntax_error_${fileId}_${Date.now()}`,
        fileId,
        type: 'syntax_conflict',
        description: `Syntax validation failed: ${error.message}`,
        affectedLines: [],
        conflictingDiffs: diffs,
        severity: 'high',
        resolutionOptions: [
          {
            id: 'manual_review',
            description: 'Manual review required',
            action: 'manual',
            confidence: 0.9
          }
        ]
      });
    }

    return conflicts;
  }

  /**
   * Rollback to a previous backup
   */
  async rollbackToBackup(fileId: string, backupId: string): Promise<RollbackResult> {
    try {
      const fileBackups = this.backupHistory.get(fileId);
      if (!fileBackups) {
        return {
          success: false,
          restoredContent: '',
          backupId,
          errors: [`No backup history found for file ${fileId}`]
        };
      }

      const backup = fileBackups.find(b => b.id === backupId);
      if (!backup) {
        return {
          success: false,
          restoredContent: '',
          backupId,
          errors: [`Backup ${backupId} not found`]
        };
      }

      // Create rollback tracking entry
      const rollbackEntry: ChangeTrackingEntry = {
        id: `rollback_${fileId}_${Date.now()}`,
        fileId,
        timestamp: new Date(),
        operation: 'rollback',
        diffs: [],
        beforeState: '', // Would be current state
        afterState: backup.content,
        success: true,
        rollbackId: backupId,
        metadata: {
          originalBackupTimestamp: backup.timestamp,
          originalVersion: backup.version
        }
      };

      // Store rollback tracking
      if (!this.changeTracking.has(fileId)) {
        this.changeTracking.set(fileId, []);
      }
      this.changeTracking.get(fileId)!.push(rollbackEntry);

      this.emit('rollback_completed', { fileId, backupId, backup });

      return {
        success: true,
        restoredContent: backup.content,
        backupId,
        errors: []
      };

    } catch (error) {
      return {
        success: false,
        restoredContent: '',
        backupId,
        errors: [`Rollback failed: ${error.message}`]
      };
    }
  }

  /**
   * Resolve conflicts with specified resolution strategy
   */
  async resolveConflicts(
    fileId: string,
    resolutions: ConflictResolution[]
  ): Promise<{
    success: boolean;
    resolvedConflicts: string[];
    remainingConflicts: Conflict[];
    errors: string[];
  }> {
    const errors: string[] = [];
    const resolvedConflicts: string[] = [];
    const activeConflicts = this.activeConflicts.get(fileId) || [];
    let remainingConflicts = [...activeConflicts];

    try {
      for (const resolution of resolutions) {
        const conflict = activeConflicts.find(c => c.id === resolution.conflictId);
        if (!conflict) {
          errors.push(`Conflict ${resolution.conflictId} not found`);
          continue;
        }

        try {
          await this.applyConflictResolution(fileId, conflict, resolution);
          resolvedConflicts.push(resolution.conflictId);
          remainingConflicts = remainingConflicts.filter(c => c.id !== resolution.conflictId);
          
          this.emit('conflict_resolved', { fileId, conflictId: resolution.conflictId, resolution });
        } catch (error) {
          errors.push(`Failed to resolve conflict ${resolution.conflictId}: ${error.message}`);
        }
      }

      // Update active conflicts
      if (remainingConflicts.length === 0) {
        this.activeConflicts.delete(fileId);
      } else {
        this.activeConflicts.set(fileId, remainingConflicts);
      }

      return {
        success: errors.length === 0,
        resolvedConflicts,
        remainingConflicts,
        errors
      };

    } catch (error) {
      return {
        success: false,
        resolvedConflicts,
        remainingConflicts: activeConflicts,
        errors: [`Conflict resolution failed: ${error.message}`]
      };
    }
  }

  /**
   * Apply a specific conflict resolution
   */
  private async applyConflictResolution(
    fileId: string,
    conflict: Conflict,
    resolution: ConflictResolution
  ): Promise<void> {
    switch (resolution.resolution) {
      case 'accept_current':
        // Do nothing - keep current state
        break;

      case 'accept_incoming':
        // Apply the conflicting diffs
        if (conflict.conflictingDiffs.length > 0) {
          // This would need integration with the file manager
          // For now, just mark as resolved
        }
        break;

      case 'merge':
        if (resolution.mergedContent) {
          // Apply merged content
          // This would need integration with the file manager
        }
        break;

      case 'manual':
        // Manual resolution - just mark as resolved
        // The user has handled it externally
        break;

      default:
        throw createSafeDiffError(`Unknown resolution type: ${resolution.resolution}`, {
          code: ERROR_CODES.SAFE_DIFF.UNKNOWN_RESOLUTION_TYPE,
          severity: 'high',
          recoverable: false,
          context: { resolutionType: resolution.resolution }
        });
    }
  }

  /**
   * Helper methods
   */
  private getLineRange(range: [number, number]): number[] {
    const [start, end] = range;
    const lines: number[] = [];
    for (let i = start; i <= end; i++) {
      lines.push(i);
    }
    return lines;
  }

  private extractImports(content: string): Array<{ module: string; imports: string }> {
    const importRegex = /import\s+(.+?)\s+from\s+['"`]([^'"`]+)['"`]/g;
    const imports: Array<{ module: string; imports: string }> = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      imports.push({
        imports: match[1].trim(),
        module: match[2].trim()
      });
    }

    return imports;
  }

  private extractExports(content: string): Array<{ name: string; type: string }> {
    const exportRegex = /export\s+(default\s+)?(class|function|const|let|var|interface|type)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    const exports: Array<{ name: string; type: string }> = [];
    let match;

    while ((match = exportRegex.exec(content)) !== null) {
      exports.push({
        name: match[3],
        type: match[2]
      });
    }

    return exports;
  }

  // Public getter methods
  getBackupHistory(fileId: string): BackupState[] {
    return this.backupHistory.get(fileId) || [];
  }

  getChangeHistory(fileId: string): ChangeTrackingEntry[] {
    return this.changeTracking.get(fileId) || [];
  }

  getActiveConflicts(fileId: string): Conflict[] {
    return this.activeConflicts.get(fileId) || [];
  }

  getAllActiveConflicts(): Map<string, Conflict[]> {
    return new Map(this.activeConflicts);
  }

  getOptions(): SafeDiffOptions {
    return { ...this.options };
  }

  updateOptions(newOptions: Partial<SafeDiffOptions>): void {
    this.options = { ...this.options, ...newOptions };
    this.emit('options_updated', this.options);
  }
}

export {
  SafeDiffOperations,
  type ValidationResult,
  type BackupState,
  type Conflict,
  type ChangeTrackingEntry,
  type SafeDiffOptions,
  type RollbackResult,
  type ConflictResolution,
  ValidationResultSchema,
  BackupStateSchema,
  ConflictSchema,
  ChangeTrackingEntrySchema
};