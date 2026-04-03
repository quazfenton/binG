/**
 * Safe Diff Operations Integration Example
 * 
 * Demonstrates how to integrate safe diff operations with the enhanced code orchestrator
 * and file management system for secure, validated code changes.
 */

import { AdvancedFileManager, DiffOperation, FileState } from '../file-management/advanced-file-manager';
import { SafeDiffOperations, ConflictResolution } from '../file-management/safe-diff-operations';
import { EnhancedCodeOrchestrator } from '../enhanced-code-orchestrator';

/**
 * Example: Safe Code Modification Workflow
 */
async function safeDiffIntegrationExample() {
  console.log('🔧 Safe Diff Operations Integration Example');
  console.log('==========================================\n');

  // Initialize file manager with safe diff operations enabled
  const fileManager = new AdvancedFileManager({
    autoSaveInterval: 30000,
    maxHistoryEntries: 100,
    enableRealTimeSync: true,
    safeDiffOptions: {
      enablePreValidation: true,
      enableSyntaxValidation: true,
      enableConflictDetection: true,
      enableAutoBackup: true,
      enableRollback: true,
      maxBackupHistory: 10,
      validationTimeout: 5000,
      conflictResolutionStrategy: 'hybrid'
    }
  });

  // Set up event listeners for safe diff operations
  setupSafeDiffEventListeners(fileManager);

  // Example 1: Safe application of valid diffs
  console.log('📝 Example 1: Safe Application of Valid Diffs');
  console.log('----------------------------------------------');
  
  const testFile = await createTestFile(fileManager);
  const validDiffs = createValidDiffs();
  
  const result1 = await fileManager.applyDiffs(testFile.id, validDiffs, {
    requireApproval: false,
    useSafeDiffOperations: true,
    validateSyntax: true
  });

  console.log('✅ Valid diffs applied successfully:', result1.success);
  console.log('📊 Validation result:', result1.validationResult);
  console.log('💾 Backup created:', result1.backupId);
  console.log('');

  // Example 2: Handling conflicting diffs
  console.log('⚠️  Example 2: Handling Conflicting Diffs');
  console.log('------------------------------------------');
  
  const conflictingDiffs = createConflictingDiffs();
  
  const result2 = await fileManager.applyDiffs(testFile.id, conflictingDiffs, {
    requireApproval: false,
    useSafeDiffOperations: true
  });

  console.log('❌ Conflicting diffs blocked:', !result2.success);
  console.log('🔍 Conflicts detected:', result2.conflicts?.length || 0);
  
  if (result2.conflicts && result2.conflicts.length > 0) {
    console.log('🛠️  Available resolution options:');
    result2.conflicts.forEach((conflict, index) => {
      console.log(`   ${index + 1}. ${conflict.description}`);
      conflict.resolutionOptions.forEach((option, optIndex) => {
        console.log(`      ${optIndex + 1}. ${option.description} (confidence: ${option.confidence})`);
      });
    });

    // Resolve conflicts
    const resolutions: ConflictResolution[] = result2.conflicts.map(conflict => ({
      conflictId: conflict.id,
      resolution: 'manual' // In real scenario, this would be user-selected
    }));

    const resolutionResult = await fileManager.resolveConflicts(testFile.id, resolutions);
    console.log('✅ Conflicts resolved:', resolutionResult.success);
  }
  console.log('');

  // Example 3: Syntax validation and rollback
  console.log('🔍 Example 3: Syntax Validation and Rollback');
  console.log('---------------------------------------------');
  
  const syntaxBreakingDiffs = createSyntaxBreakingDiffs();
  
  const result3 = await fileManager.applyDiffs(testFile.id, syntaxBreakingDiffs, {
    requireApproval: false,
    useSafeDiffOperations: true,
    validateSyntax: true
  });

  console.log('❌ Syntax-breaking diffs blocked:', !result3.success);
  console.log('🔄 Automatic rollback performed:', result3.backupId ? 'Yes' : 'No');
  console.log('📋 Validation errors:', result3.validationResult?.errors || []);
  console.log('');

  // Example 4: Manual rollback to previous state
  console.log('⏪ Example 4: Manual Rollback to Previous State');
  console.log('-----------------------------------------------');
  
  const backupHistory = fileManager.getBackupHistory(testFile.id);
  console.log('📚 Available backups:', backupHistory.length);
  
  if (backupHistory.length > 0) {
    const latestBackup = backupHistory[backupHistory.length - 1];
    const rollbackResult = await fileManager.rollbackToBackup(testFile.id, latestBackup.id);
    
    console.log('✅ Manual rollback successful:', rollbackResult.success);
    console.log('📄 Content restored to backup from:', latestBackup.timestamp);
  }
  console.log('');

  // Example 5: Integration with Enhanced Code Orchestrator
  console.log('🤖 Example 5: Integration with Enhanced Code Orchestrator');
  console.log('----------------------------------------------------------');
  
  const orchestrator = new EnhancedCodeOrchestrator({
    enableFileManagement: true,
    enableStreaming: true,
    mode: 'hybrid'
  });

  // Simulate orchestrator generating diffs with safe application
  const orchestratorDiffs = await simulateOrchestratorDiffs();
  
  const result5 = await fileManager.applyDiffs(testFile.id, orchestratorDiffs, {
    requireApproval: false,
    useSafeDiffOperations: true,
    validateSyntax: true
  });

  console.log('🎯 Orchestrator diffs applied safely:', result5.success);
  console.log('📈 Final validation confidence:', result5.validationResult?.confidence || 0);
  console.log('');

  // Example 6: Change tracking and history
  console.log('📊 Example 6: Change Tracking and History');
  console.log('-----------------------------------------');
  
  const changeHistory = fileManager.getSafeDiffChangeHistory(testFile.id);
  console.log('📝 Total changes tracked:', changeHistory.length);
  
  changeHistory.forEach((change, index) => {
    console.log(`   ${index + 1}. ${change.operation} at ${change.timestamp.toISOString()}`);
    console.log(`      Success: ${change.success}, Diffs: ${change.diffs.length}`);
    if (change.rollbackId) {
      console.log(`      Rollback ID: ${change.rollbackId}`);
    }
  });
  console.log('');

  // Example 7: Options management
  console.log('⚙️  Example 7: Options Management');
  console.log('----------------------------------');
  
  const currentOptions = fileManager.getSafeDiffOptions();
  console.log('🔧 Current safe diff options:', {
    preValidation: currentOptions.enablePreValidation,
    syntaxValidation: currentOptions.enableSyntaxValidation,
    conflictDetection: currentOptions.enableConflictDetection,
    autoBackup: currentOptions.enableAutoBackup,
    maxBackupHistory: currentOptions.maxBackupHistory
  });

  // Update options for different scenarios
  fileManager.updateSafeDiffOptions({
    conflictResolutionStrategy: 'auto',
    maxBackupHistory: 20,
    validationTimeout: 10000
  });

  console.log('✅ Options updated for enhanced safety');
  console.log('');

  console.log('🎉 Safe Diff Operations Integration Example Complete!');
  console.log('=====================================================');
}

/**
 * Set up event listeners for safe diff operations
 */
function setupSafeDiffEventListeners(fileManager: AdvancedFileManager) {
  fileManager.on('safe_diff_backup_created', (data) => {
    console.log(`💾 Backup created: ${data.backupId} for file ${data.fileId}`);
  });

  fileManager.on('safe_diff_conflicts_detected', (data) => {
    console.log(`⚠️  Conflicts detected in file ${data.fileId}: ${data.conflicts.length} conflicts`);
  });

  fileManager.on('safe_diff_rollback_completed', (data) => {
    console.log(`🔄 Rollback completed for file ${data.fileId} to backup ${data.backupId}`);
  });

  fileManager.on('safe_diff_syntax_validation_failed_rollback', (data) => {
    console.log(`❌ Syntax validation failed, rolled back file ${data.fileId}`);
  });

  fileManager.on('safe_diff_emergency_rollback', (data) => {
    console.log(`🚨 Emergency rollback performed for file ${data.fileId}: ${data.error}`);
  });

  fileManager.on('conflicts_resolved', (data) => {
    console.log(`✅ Resolved ${data.resolvedConflicts.length} conflicts in file ${data.fileId}`);
  });
}

/**
 * Create a test file for demonstration
 */
async function createTestFile(fileManager: AdvancedFileManager): Promise<FileState> {
  const testFile = {
    id: 'safe-diff-test-file',
    name: 'TestComponent.tsx',
    path: '/src/components/TestComponent.tsx',
    content: `import React from 'react';

interface TestComponentProps {
  title: string;
  count: number;
}

export const TestComponent: React.FC<TestComponentProps> = ({ title, count }) => {
  return (
    <div className="test-component">
      <h2>{title}</h2>
      <p>Current count: {count}</p>
    </div>
  );
};

export default TestComponent;`,
    language: 'typescript',
    hasEdits: false,
    lastModified: new Date(),
    version: 1,
    originalContent: '',
    pendingDiffs: [],
    isLocked: false
  };

  await fileManager.registerFile(testFile);
  return fileManager.getFileState(testFile.id)!;
}

/**
 * Create valid diff operations
 */
function createValidDiffs(): DiffOperation[] {
  return [
    {
      operation: 'insert',
      lineRange: [2, 2],
      content: "import { useState } from 'react';",
      description: 'Add useState import',
      confidence: 0.95
    },
    {
      operation: 'replace',
      lineRange: [7, 11],
      content: `export const TestComponent: React.FC<TestComponentProps> = ({ title, count }) => {
  const [isVisible, setIsVisible] = useState(true);
  
  if (!isVisible) return null;
  
  return (
    <div className="test-component">
      <h2>{title}</h2>
      <p>Current count: {count}</p>
      <button onClick={() => setIsVisible(false)}>Hide</button>
    </div>
  );
};`,
      description: 'Add state management and hide functionality',
      confidence: 0.9
    }
  ];
}

/**
 * Create conflicting diff operations
 */
function createConflictingDiffs(): DiffOperation[] {
  return [
    {
      operation: 'replace',
      lineRange: [7, 9],
      content: `export const TestComponent: React.FC<TestComponentProps> = ({ title, count }) => {
  const handleClick = () => console.log('Clicked');
  
  return (`,
      description: 'Add click handler',
      confidence: 0.8
    },
    {
      operation: 'replace',
      lineRange: [8, 10],
      content: `  const [loading, setLoading] = useState(false);
  
  return (`,
      description: 'Add loading state',
      confidence: 0.8
    }
  ];
}

/**
 * Create syntax-breaking diff operations
 */
function createSyntaxBreakingDiffs(): DiffOperation[] {
  return [
    {
      operation: 'replace',
      lineRange: [7, 7],
      content: 'export const TestComponent: React.FC<TestComponentProps> = ({ title, count }) => {',
      description: 'Introduce syntax error (missing closing brace)',
      confidence: 0.7
    },
    {
      operation: 'replace',
      lineRange: [10, 10],
      content: '      <p>Current count: {count</p>', // Missing closing brace
      description: 'Break JSX syntax',
      confidence: 0.6
    }
  ];
}

/**
 * Simulate orchestrator generating diffs
 */
async function simulateOrchestratorDiffs(): Promise<DiffOperation[]> {
  // Simulate the enhanced code orchestrator generating safe, validated diffs
  return [
    {
      operation: 'insert',
      lineRange: [1, 1],
      content: "import { memo } from 'react';",
      description: 'Add memo import for performance optimization',
      confidence: 0.95
    },
    {
      operation: 'replace',
      lineRange: [13, 13],
      content: 'export default memo(TestComponent);',
      description: 'Wrap component with memo for performance',
      confidence: 0.9
    }
  ];
}

/**
 * Example: Error Recovery Scenario
 */
async function errorRecoveryExample(fileManager: AdvancedFileManager) {
  console.log('🚨 Error Recovery Scenario');
  console.log('---------------------------');

  const testFile = await createTestFile(fileManager);
  
  // Simulate a scenario where multiple operations fail
  const problematicDiffs: DiffOperation[] = [
    {
      operation: 'replace',
      lineRange: [100, 105], // Invalid range
      content: 'invalid content',
      description: 'Invalid range diff',
      confidence: 0.3
    },
    {
      operation: 'insert',
      lineRange: [5, 5],
      content: 'const broken = () => { // Missing closing brace',
      description: 'Syntax breaking diff',
      confidence: 0.4
    }
  ];

  const result = await fileManager.applyDiffs(testFile.id, problematicDiffs, {
    requireApproval: false,
    useSafeDiffOperations: true
  });

  console.log('❌ Problematic diffs handled safely:', !result.success);
  console.log('🛡️  File integrity maintained:', result.updatedContent === testFile.content);
  console.log('📋 Error details:', result.errors);
  
  // Check that backup was created even for failed operations
  const backupHistory = fileManager.getBackupHistory(testFile.id);
  console.log('💾 Backup created for failed operation:', backupHistory.length > 0);
}

// Run the example
if (require.main === module) {
  safeDiffIntegrationExample()
    .then(() => console.log('Example completed successfully'))
    .catch(error => console.error('Example failed:', error));
}

export {
  safeDiffIntegrationExample,
  errorRecoveryExample,
  setupSafeDiffEventListeners,
  createTestFile,
  createValidDiffs,
  createConflictingDiffs,
  createSyntaxBreakingDiffs
};