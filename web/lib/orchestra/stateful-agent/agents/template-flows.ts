/**
 * StatefulAgent Template Flows
 *
 * Pre-defined templates for common workflows:
 * - File creation
 * - Refactoring
 * - Bug fixing
 * - Feature implementation
 * - Code review
 * - Testing
 *
 * Each template provides:
 * - Structured workflow
 * - Pre-defined checkpoints
 * - Quality gates
 * - Success criteria
 */

import type { Task, TaskGraph } from './stateful-agent';

// ============================================================================
// Template Definitions
// ============================================================================

export type TemplateType =
  | 'file-creation'
  | 'refactoring'
  | 'bug-fix'
  | 'feature-implementation'
  | 'code-review'
  | 'testing'
  | 'documentation'
  | 'deployment';

export interface TemplateFlow {
  id: TemplateType;
  name: string;
  description: string;
  phases: TemplatePhase[];
  qualityGates: QualityGate[];
  successCriteria: string[];
}

export interface TemplatePhase {
  id: string;
  name: string;
  description: string;
  tasks: TaskTemplate[];
  checkpoints: Checkpoint[];
}

export interface TaskTemplate {
  id: string;
  description: string;
  dependencies?: string[];
  estimatedDuration?: number; // seconds
  required?: boolean;
}

export interface Checkpoint {
  id: string;
  name: string;
  verificationMethod: 'automated' | 'manual' | 'llm';
  criteria: string[];
}

export interface QualityGate {
  id: string;
  name: string;
  threshold: number;
  metric: string;
  action: 'block' | 'warn' | 'continue';
}

// ============================================================================
// Template: File Creation
// ============================================================================

export const FILE_CREATION_TEMPLATE: TemplateFlow = {
  id: 'file-creation',
  name: 'File Creation Workflow',
  description: 'Create new files with proper structure and quality',
  phases: [
    {
      id: 'analysis',
      name: 'Analysis',
      description: 'Understand requirements and context',
      tasks: [
        {
          id: 'read-context',
          description: 'Read existing files to understand context',
          estimatedDuration: 30,
          required: true,
        },
        {
          id: 'identify-patterns',
          description: 'Identify coding patterns and conventions',
          dependencies: ['read-context'],
          estimatedDuration: 20,
          required: true,
        },
      ],
      checkpoints: [
        {
          id: 'context-understood',
          name: 'Context Understood',
          verificationMethod: 'llm',
          criteria: [
            'File structure understood',
            'Coding conventions identified',
            'Dependencies identified',
          ],
        },
      ],
    },
    {
      id: 'creation',
      name: 'Creation',
      description: 'Create the new file',
      tasks: [
        {
          id: 'create-file',
          description: 'Create file with proper structure',
          dependencies: ['identify-patterns'],
          estimatedDuration: 60,
          required: true,
        },
        {
          id: 'add-types',
          description: 'Add TypeScript types/interfaces',
          dependencies: ['create-file'],
          estimatedDuration: 30,
          required: false,
        },
      ],
      checkpoints: [
        {
          id: 'file-created',
          name: 'File Created',
          verificationMethod: 'automated',
          criteria: [
            'File exists',
            'File is not empty',
            'File has valid syntax',
          ],
        },
      ],
    },
    {
      id: 'verification',
      name: 'Verification',
      description: 'Verify file quality',
      tasks: [
        {
          id: 'syntax-check',
          description: 'Check syntax validity',
          dependencies: ['creation'],
          estimatedDuration: 10,
          required: true,
        },
        {
          id: 'lint-check',
          description: 'Run linter',
          dependencies: ['syntax-check'],
          estimatedDuration: 15,
          required: true,
        },
      ],
      checkpoints: [
        {
          id: 'quality-passed',
          name: 'Quality Gate Passed',
          verificationMethod: 'automated',
          criteria: [
            'No syntax errors',
            'No linting errors',
            'Follows project conventions',
          ],
        },
      ],
    },
  ],
  qualityGates: [
    {
      id: 'syntax-valid',
      name: 'Syntax Validity',
      threshold: 1.0,
      metric: 'syntaxErrorRate',
      action: 'block',
    },
    {
      id: 'lint-clean',
      name: 'Lint Clean',
      threshold: 0.9,
      metric: 'lintPassRate',
      action: 'warn',
    },
  ],
  successCriteria: [
    'File created successfully',
    'No syntax errors',
    'Follows project conventions',
    'Properly typed (if TypeScript)',
  ],
};

// ============================================================================
// Template: Refactoring
// ============================================================================

export const REFACTORING_TEMPLATE: TemplateFlow = {
  id: 'refactoring',
  name: 'Refactoring Workflow',
  description: 'Safely refactor code with verification',
  phases: [
    {
      id: 'analysis',
      name: 'Analysis',
      description: 'Understand current code and identify improvements',
      tasks: [
        {
          id: 'read-code',
          description: 'Read existing code to refactor',
          estimatedDuration: 60,
          required: true,
        },
        {
          id: 'identify-issues',
          description: 'Identify code smells and improvement opportunities',
          dependencies: ['read-code'],
          estimatedDuration: 30,
          required: true,
        },
        {
          id: 'plan-refactor',
          description: 'Plan refactoring approach',
          dependencies: ['identify-issues'],
          estimatedDuration: 30,
          required: true,
        },
      ],
      checkpoints: [
        {
          id: 'refactor-plan',
          name: 'Refactoring Plan',
          verificationMethod: 'llm',
          criteria: [
            'Issues clearly identified',
            'Improvement strategy defined',
            'Risk assessment completed',
          ],
        },
      ],
    },
    {
      id: 'execution',
      name: 'Execution',
      description: 'Perform refactoring',
      tasks: [
        {
          id: 'backup-original',
          description: 'Create backup of original code',
          dependencies: ['plan-refactor'],
          estimatedDuration: 10,
          required: true,
        },
        {
          id: 'apply-refactor',
          description: 'Apply refactoring changes',
          dependencies: ['backup-original'],
          estimatedDuration: 120,
          required: true,
        },
      ],
      checkpoints: [
        {
          id: 'refactor-applied',
          name: 'Refactoring Applied',
          verificationMethod: 'automated',
          criteria: [
            'Changes applied',
            'No syntax errors introduced',
          ],
        },
      ],
    },
    {
      id: 'verification',
      name: 'Verification',
      description: 'Verify refactoring preserved behavior',
      tasks: [
        {
          id: 'syntax-check',
          description: 'Verify syntax',
          dependencies: ['execution'],
          estimatedDuration: 10,
          required: true,
        },
        {
          id: 'test-existing',
          description: 'Run existing tests',
          dependencies: ['syntax-check'],
          estimatedDuration: 60,
          required: false,
        },
      ],
      checkpoints: [
        {
          id: 'behavior-preserved',
          name: 'Behavior Preserved',
          verificationMethod: 'automated',
          criteria: [
            'All tests pass',
            'No regressions detected',
            'Code quality improved',
          ],
        },
      ],
    },
  ],
  qualityGates: [
    {
      id: 'tests-pass',
      name: 'Tests Pass',
      threshold: 1.0,
      metric: 'testPassRate',
      action: 'block',
    },
    {
      id: 'quality-improved',
      name: 'Quality Improved',
      threshold: 0.1,
      metric: 'qualityImprovement',
      action: 'warn',
    },
  ],
  successCriteria: [
    'Code refactored successfully',
    'All tests pass',
    'No regressions',
    'Code quality improved',
  ],
};

// ============================================================================
// Template: Bug Fix
// ============================================================================

export const BUG_FIX_TEMPLATE: TemplateFlow = {
  id: 'bug-fix',
  name: 'Bug Fix Workflow',
  description: 'Systematically diagnose and fix bugs',
  phases: [
    {
      id: 'diagnosis',
      name: 'Diagnosis',
      description: 'Understand and reproduce the bug',
      tasks: [
        {
          id: 'reproduce-bug',
          description: 'Reproduce the bug',
          estimatedDuration: 60,
          required: true,
        },
        {
          id: 'identify-root-cause',
          description: 'Identify root cause',
          dependencies: ['reproduce-bug'],
          estimatedDuration: 60,
          required: true,
        },
      ],
      checkpoints: [
        {
          id: 'bug-understood',
          name: 'Bug Understood',
          verificationMethod: 'llm',
          criteria: [
            'Bug reproduced',
            'Root cause identified',
            'Impact assessed',
          ],
        },
      ],
    },
    {
      id: 'fix',
      name: 'Fix',
      description: 'Implement the fix',
      tasks: [
        {
          id: 'implement-fix',
          description: 'Implement bug fix',
          dependencies: ['identify-root-cause'],
          estimatedDuration: 90,
          required: true,
        },
        {
          id: 'add-test',
          description: 'Add test case for bug',
          dependencies: ['implement-fix'],
          estimatedDuration: 30,
          required: false,
        },
      ],
      checkpoints: [
        {
          id: 'fix-applied',
          name: 'Fix Applied',
          verificationMethod: 'automated',
          criteria: [
            'Fix implemented',
            'No syntax errors',
          ],
        },
      ],
    },
    {
      id: 'verification',
      name: 'Verification',
      description: 'Verify bug is fixed',
      tasks: [
        {
          id: 'test-fix',
          description: 'Test that bug is fixed',
          dependencies: ['fix'],
          estimatedDuration: 30,
          required: true,
        },
        {
          id: 'regression-test',
          description: 'Check for regressions',
          dependencies: ['test-fix'],
          estimatedDuration: 60,
          required: true,
        },
      ],
      checkpoints: [
        {
          id: 'bug-fixed',
          name: 'Bug Fixed',
          verificationMethod: 'automated',
          criteria: [
            'Bug no longer reproducible',
            'No regressions',
            'Test case added',
          ],
        },
      ],
    },
  ],
  qualityGates: [
    {
      id: 'bug-reproducible',
      name: 'Bug Reproducible',
      threshold: 1.0,
      metric: 'reproductionRate',
      action: 'block',
    },
    {
      id: 'fix-verified',
      name: 'Fix Verified',
      threshold: 1.0,
      metric: 'fixVerificationRate',
      action: 'block',
    },
  ],
  successCriteria: [
    'Bug fixed',
    'No regressions',
    'Test case added',
    'Root cause documented',
  ],
};

// ============================================================================
// Template Registry
// ============================================================================

export const TEMPLATE_REGISTRY: Record<TemplateType, TemplateFlow> = {
  'file-creation': FILE_CREATION_TEMPLATE,
  'refactoring': REFACTORING_TEMPLATE,
  'bug-fix': BUG_FIX_TEMPLATE,
  'feature-implementation': {
    id: 'feature-implementation',
    name: 'Feature Implementation Workflow',
    description: 'Implement new features systematically',
    phases: [],
    qualityGates: [],
    successCriteria: [],
  },
  'code-review': {
    id: 'code-review',
    name: 'Code Review Workflow',
    description: 'Review code for quality and correctness',
    phases: [],
    qualityGates: [],
    successCriteria: [],
  },
  'testing': {
    id: 'testing',
    name: 'Testing Workflow',
    description: 'Create comprehensive test coverage',
    phases: [],
    qualityGates: [],
    successCriteria: [],
  },
  'documentation': {
    id: 'documentation',
    name: 'Documentation Workflow',
    description: 'Create clear documentation',
    phases: [],
    qualityGates: [],
    successCriteria: [],
  },
  'deployment': {
    id: 'deployment',
    name: 'Deployment Workflow',
    description: 'Deploy code safely',
    phases: [],
    qualityGates: [],
    successCriteria: [],
  },
};

/**
 * Get template by type
 */
export function getTemplate(type: TemplateType): TemplateFlow {
  return TEMPLATE_REGISTRY[type];
}

/**
 * Convert template to task graph
 */
export function templateToTaskGraph(template: TemplateFlow): TaskGraph {
  const tasks: Task[] = [];
  
  for (const phase of template.phases) {
    for (const taskTemplate of phase.tasks) {
      tasks.push({
        id: taskTemplate.id,
        description: taskTemplate.description,
        dependencies: taskTemplate.dependencies || [],
        status: 'pending',
      });
    }
  }
  
  return {
    id: `template-${template.id}`,
    tasks,
    status: 'pending',
  };
}

/**
 * Detect template from user message
 */
export function detectTemplate(userMessage: string): TemplateType | null {
  const message = userMessage.toLowerCase();
  
  // File creation patterns
  if (/create (new )?(file|component|page|module)/.test(message)) {
    return 'file-creation';
  }
  
  // Refactoring patterns
  if (/refactor|restructure|reorganize|clean up|improve (code|structure)/.test(message)) {
    return 'refactoring';
  }
  
  // Bug fix patterns
  if (/fix (bug|issue|error|problem)|debug|troubleshoot/.test(message)) {
    return 'bug-fix';
  }
  
  // Feature implementation patterns
  if (/implement (feature|functionality)|add (feature|support)/.test(message)) {
    return 'feature-implementation';
  }
  
  // Code review patterns
  if (/review (code|pr|pull request)|check (code|quality)/.test(message)) {
    return 'code-review';
  }
  
  // Testing patterns
  if (/test|write tests|add tests|coverage/.test(message)) {
    return 'testing';
  }
  
  // Documentation patterns
  if (/document|write docs|add documentation|readme/.test(message)) {
    return 'documentation';
  }
  
  // Deployment patterns
  if (/deploy|release|publish|ship/.test(message)) {
    return 'deployment';
  }
  
  return null;
}
