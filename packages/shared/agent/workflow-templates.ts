/**
 * Workflow Templates Service
 * 
 * Pre-built workflow templates for common agent tasks with:
 * - Default flows for common scenarios
 * - Reviewer/approver workflows
 * - Memory management and context wiping
 * - Third-party integration templates
 * - Auto-spawning and deployment flows
 * 
 * Templates:
 * - code-review: Review and approve code changes
 * - data-pipeline: ETL with validation steps
 * - customer-support: Multi-turn conversation with escalation
 * - security-audit: Security scanning with reporting
 * - deployment: CI/CD pipeline with approvals
 * - memory-wipe: Context cleanup and state reset
 */

import { createLogger } from '@/lib/utils/logger';
import { mastraWorkflowIntegration } from './mastra-workflow-integration';
import type { MastraWorkflowResult } from './mastra-workflow-integration';

const logger = createLogger('Workflow:Templates');

// ============================================================================
// Types
// ============================================================================

export type WorkflowTemplateId =
  | 'code-review'
  | 'data-pipeline'
  | 'customer-support'
  | 'security-audit'
  | 'deployment'
  | 'memory-wipe'
  | 'context-refresh'
  | 'agent-handoff'
  | 'multi-step-reasoning'
  | 'research-analysis'
  | 'bug-fix'
  | 'feature-implementation';

export interface WorkflowTemplate {
  id: WorkflowTemplateId;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
  variables: Record<string, any>;
  timeout?: number;
  retryCount?: number;
  tags: string[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'agent' | 'tool' | 'approval' | 'condition' | 'loop' | 'parallel';
  config: Record<string, any>;
  dependencies?: string[];
  onError?: 'stop' | 'continue' | 'retry';
}

export interface TemplateExecutionConfig {
  templateId: WorkflowTemplateId;
  variables?: Record<string, any>;
  reviewerId?: string; // For approval workflows
  enableMemoryWipe?: boolean; // Auto-wipe after completion
  enableLogging?: boolean;
  timeout?: number;
}

export interface TemplateExecutionResult {
  success: boolean;
  workflowId: string;
  templateId: WorkflowTemplateId;
  steps?: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    result?: any;
    error?: string;
    duration?: number;
  }>;
  result?: any;
  error?: string;
  duration: number;
  memoryWiped?: boolean;
}

// ============================================================================
// Workflow Templates
// ============================================================================

const TEMPLATES: Record<WorkflowTemplateId, WorkflowTemplate> = {
  // Code Review Workflow
  'code-review': {
    id: 'code-review',
    name: 'Code Review & Approval',
    description: 'Multi-step code review with automated checks and human approval',
    version: '1.0.0',
    timeout: 600000, // 10 minutes
    retryCount: 2,
    tags: ['code', 'review', 'approval'],
    variables: {
      maxReviewRounds: 3,
      autoApproveMinorChanges: true,
    },
    steps: [
      {
        id: 'analyze-changes',
        name: 'Analyze Code Changes',
        type: 'agent',
        config: {
          agent: 'reviewer',
          task: 'Analyze the code changes for quality, security, and best practices',
        },
      },
      {
        id: 'run-tests',
        name: 'Run Automated Tests',
        type: 'tool',
        config: {
          tool: 'execute_tests',
        },
        dependencies: ['analyze-changes'],
      },
      {
        id: 'security-scan',
        name: 'Security Vulnerability Scan',
        type: 'tool',
        config: {
          tool: 'security_scan',
        },
        dependencies: ['analyze-changes'],
      },
      {
        id: 'human-review',
        name: 'Human Reviewer Approval',
        type: 'approval',
        config: {
          required: true,
          minApprovers: 1,
        },
        dependencies: ['run-tests', 'security-scan'],
        onError: 'continue',
      },
      {
        id: 'merge',
        name: 'Merge Changes',
        type: 'tool',
        config: {
          tool: 'git_merge',
        },
        dependencies: ['human-review'],
      },
    ],
  },

  // Data Pipeline Workflow
  'data-pipeline': {
    id: 'data-pipeline',
    name: 'Data Pipeline with Validation',
    description: 'ETL pipeline with data validation and error handling',
    version: '1.0.0',
    timeout: 1800000, // 30 minutes
    retryCount: 3,
    tags: ['data', 'etl', 'pipeline'],
    variables: {
      batchSize: 1000,
      validationStrictness: 'high',
    },
    steps: [
      {
        id: 'extract',
        name: 'Extract Data',
        type: 'agent',
        config: {
          agent: 'extractor',
          task: 'Extract data from source systems',
        },
      },
      {
        id: 'validate',
        name: 'Validate Data',
        type: 'tool',
        config: {
          tool: 'data_validation',
        },
        dependencies: ['extract'],
      },
      {
        id: 'transform',
        name: 'Transform Data',
        type: 'agent',
        config: {
          agent: 'transformer',
          task: 'Transform and clean data',
        },
        dependencies: ['validate'],
      },
      {
        id: 'load',
        name: 'Load to Destination',
        type: 'tool',
        config: {
          tool: 'data_load',
        },
        dependencies: ['transform'],
      },
    ],
  },

  // Customer Support Workflow
  'customer-support': {
    id: 'customer-support',
    name: 'Customer Support Conversation',
    description: 'Multi-turn support with escalation path',
    version: '1.0.0',
    timeout: 3600000, // 1 hour
    retryCount: 0,
    tags: ['support', 'conversation', 'escalation'],
    variables: {
      maxTurns: 20,
      escalationKeywords: ['manager', 'complaint', 'refund'],
    },
    steps: [
      {
        id: 'initial-response',
        name: 'Initial Customer Response',
        type: 'agent',
        config: {
          agent: 'support-agent',
          task: 'Respond to customer inquiry',
        },
      },
      {
        id: 'sentiment-check',
        name: 'Check Customer Sentiment',
        type: 'tool',
        config: {
          tool: 'sentiment_analysis',
        },
        dependencies: ['initial-response'],
      },
      {
        id: 'escalation-check',
        name: 'Check for Escalation Need',
        type: 'condition',
        config: {
          condition: 'sentiment < 0.3 OR escalation_keywords_detected',
        },
        dependencies: ['sentiment-check'],
      },
      {
        id: 'escalate',
        name: 'Escalate to Human',
        type: 'agent',
        config: {
          agent: 'human-agent',
          task: 'Handle escalated support request',
        },
        dependencies: ['escalation-check'],
      },
    ],
  },

  // Security Audit Workflow
  'security-audit': {
    id: 'security-audit',
    name: 'Security Audit & Reporting',
    description: 'Comprehensive security scanning with detailed reporting',
    version: '1.0.0',
    timeout: 1800000, // 30 minutes
    retryCount: 1,
    tags: ['security', 'audit', 'compliance'],
    variables: {
      scanDepth: 'comprehensive',
      includeDependencies: true,
    },
    steps: [
      {
        id: 'dependency-scan',
        name: 'Scan Dependencies',
        type: 'tool',
        config: {
          tool: 'dependency_audit',
        },
      },
      {
        id: 'code-scan',
        name: 'Scan Source Code',
        type: 'tool',
        config: {
          tool: 'code_security_scan',
        },
      },
      {
        id: 'config-scan',
        name: 'Scan Configuration',
        type: 'tool',
        config: {
          tool: 'config_security_scan',
        },
      },
      {
        id: 'generate-report',
        name: 'Generate Security Report',
        type: 'agent',
        config: {
          agent: 'reporter',
          task: 'Generate comprehensive security report',
        },
        dependencies: ['dependency-scan', 'code-scan', 'config-scan'],
      },
    ],
  },

  // Deployment Workflow
  'deployment': {
    id: 'deployment',
    name: 'CI/CD Deployment Pipeline',
    description: 'Automated deployment with approval gates',
    version: '1.0.0',
    timeout: 1800000, // 30 minutes
    retryCount: 2,
    tags: ['deployment', 'ci/cd', 'approval'],
    variables: {
      environment: 'production',
      requireApproval: true,
      rollbackOnFailure: true,
    },
    steps: [
      {
        id: 'build',
        name: 'Build Application',
        type: 'tool',
        config: {
          tool: 'build_command',
        },
      },
      {
        id: 'test',
        name: 'Run Tests',
        type: 'tool',
        config: {
          tool: 'test_command',
        },
        dependencies: ['build'],
      },
      {
        id: 'staging-deploy',
        name: 'Deploy to Staging',
        type: 'tool',
        config: {
          tool: 'deploy_command',
          args: { environment: 'staging' },
        },
        dependencies: ['test'],
      },
      {
        id: 'approval',
        name: 'Production Approval',
        type: 'approval',
        config: {
          required: true,
          minApprovers: 1,
        },
        dependencies: ['staging-deploy'],
      },
      {
        id: 'production-deploy',
        name: 'Deploy to Production',
        type: 'tool',
        config: {
          tool: 'deploy_command',
          args: { environment: 'production' },
        },
        dependencies: ['approval'],
      },
    ],
  },

  // Memory Wipe Workflow
  'memory-wipe': {
    id: 'memory-wipe',
    name: 'Context Memory Wipe',
    description: 'Clean up conversation context and reset state',
    version: '1.0.0',
    timeout: 30000, // 30 seconds
    retryCount: 0,
    tags: ['memory', 'cleanup', 'reset'],
    variables: {
      wipeLevel: 'full', // 'partial' | 'full'
      preserveVariables: false,
    },
    steps: [
      {
        id: 'backup-state',
        name: 'Backup Current State',
        type: 'tool',
        config: {
          tool: 'state_backup',
        },
      },
      {
        id: 'clear-context',
        name: 'Clear Conversation Context',
        type: 'tool',
        config: {
          tool: 'clear_context',
        },
        dependencies: ['backup-state'],
      },
      {
        id: 'reset-variables',
        name: 'Reset Variables',
        type: 'tool',
        config: {
          tool: 'reset_variables',
        },
        dependencies: ['clear-context'],
      },
      {
        id: 'confirm',
        name: 'Confirm Wipe Complete',
        type: 'agent',
        config: {
          agent: 'system',
          task: 'Confirm memory wipe completed successfully',
        },
        dependencies: ['reset-variables'],
      },
    ],
  },

  // Context Refresh Workflow
  'context-refresh': {
    id: 'context-refresh',
    name: 'Context Refresh',
    description: 'Refresh context while preserving important state',
    version: '1.0.0',
    timeout: 60000, // 1 minute
    retryCount: 1,
    tags: ['context', 'refresh', 'optimization'],
    variables: {
      compressHistory: true,
      maxHistoryItems: 10,
    },
    steps: [
      {
        id: 'identify-key-info',
        name: 'Identify Key Information',
        type: 'agent',
        config: {
          agent: 'analyzer',
          task: 'Identify and preserve key conversation information',
        },
      },
      {
        id: 'compress-history',
        name: 'Compress Conversation History',
        type: 'tool',
        config: {
          tool: 'compress_history',
        },
        dependencies: ['identify-key-info'],
      },
      {
        id: 'update-context',
        name: 'Update Context',
        type: 'tool',
        config: {
          tool: 'update_context',
        },
        dependencies: ['compress-history'],
      },
    ],
  },

  // Agent Handoff Workflow
  'agent-handoff': {
    id: 'agent-handoff',
    name: 'Agent Handoff',
    description: 'Transfer conversation between specialized agents',
    version: '1.0.0',
    timeout: 30000,
    retryCount: 1,
    tags: ['handoff', 'multi-agent'],
    variables: {},
    steps: [
      {
        id: 'summarize-context',
        name: 'Summarize Current Context',
        type: 'agent',
        config: {
          agent: 'source-agent',
          task: 'Summarize conversation context for handoff',
        },
      },
      {
        id: 'transfer',
        name: 'Transfer to Target Agent',
        type: 'tool',
        config: {
          tool: 'agent_handoff',
        },
        dependencies: ['summarize-context'],
      },
      {
        id: 'acknowledge',
        name: 'Target Agent Acknowledgment',
        type: 'agent',
        config: {
          agent: 'target-agent',
          task: 'Acknowledge handoff and continue conversation',
        },
        dependencies: ['transfer'],
      },
    ],
  },

  // Multi-Step Reasoning Workflow
  'multi-step-reasoning': {
    id: 'multi-step-reasoning',
    name: 'Multi-Step Reasoning',
    description: 'Complex problem solving with iterative reasoning',
    version: '1.0.0',
    timeout: 600000,
    retryCount: 2,
    tags: ['reasoning', 'problem-solving'],
    variables: {
      maxIterations: 5,
    },
    steps: [
      {
        id: 'define-problem',
        name: 'Define Problem',
        type: 'agent',
        config: {
          agent: 'analyst',
          task: 'Clearly define the problem to solve',
        },
      },
      {
        id: 'gather-info',
        name: 'Gather Information',
        type: 'agent',
        config: {
          agent: 'researcher',
          task: 'Gather relevant information',
        },
        dependencies: ['define-problem'],
      },
      {
        id: 'analyze',
        name: 'Analyze Information',
        type: 'agent',
        config: {
          agent: 'analyst',
          task: 'Analyze gathered information',
        },
        dependencies: ['gather-info'],
      },
      {
        id: 'propose-solution',
        name: 'Propose Solution',
        type: 'agent',
        config: {
          agent: 'solver',
          task: 'Propose solution based on analysis',
        },
        dependencies: ['analyze'],
      },
      {
        id: 'validate',
        name: 'Validate Solution',
        type: 'agent',
        config: {
          agent: 'reviewer',
          task: 'Validate proposed solution',
        },
        dependencies: ['propose-solution'],
      },
    ],
  },

  // Research & Analysis Workflow
  'research-analysis': {
    id: 'research-analysis',
    name: 'Research & Analysis',
    description: 'Comprehensive research with synthesis',
    version: '1.0.0',
    timeout: 900000,
    retryCount: 1,
    tags: ['research', 'analysis'],
    variables: {},
    steps: [
      {
        id: 'define-scope',
        name: 'Define Research Scope',
        type: 'agent',
        config: {
          agent: 'planner',
          task: 'Define research scope and objectives',
        },
      },
      {
        id: 'gather-sources',
        name: 'Gather Sources',
        type: 'agent',
        config: {
          agent: 'researcher',
          task: 'Gather relevant sources and data',
        },
        dependencies: ['define-scope'],
      },
      {
        id: 'synthesize',
        name: 'Synthesize Findings',
        type: 'agent',
        config: {
          agent: 'analyst',
          task: 'Synthesize research findings',
        },
        dependencies: ['gather-sources'],
      },
      {
        id: 'report',
        name: 'Generate Report',
        type: 'agent',
        config: {
          agent: 'reporter',
          task: 'Generate comprehensive research report',
        },
        dependencies: ['synthesize'],
      },
    ],
  },

  // Bug Fix Workflow
  'bug-fix': {
    id: 'bug-fix',
    name: 'Bug Fix Workflow',
    description: 'Systematic bug identification and resolution',
    version: '1.0.0',
    timeout: 600000,
    retryCount: 2,
    tags: ['bug', 'fix', 'debugging'],
    variables: {},
    steps: [
      {
        id: 'reproduce',
        name: 'Reproduce Bug',
        type: 'agent',
        config: {
          agent: 'tester',
          task: 'Reproduce the reported bug',
        },
      },
      {
        id: 'diagnose',
        name: 'Diagnose Root Cause',
        type: 'agent',
        config: {
          agent: 'debugger',
          task: 'Identify root cause of bug',
        },
        dependencies: ['reproduce'],
      },
      {
        id: 'fix',
        name: 'Implement Fix',
        type: 'agent',
        config: {
          agent: 'developer',
          task: 'Implement bug fix',
        },
        dependencies: ['diagnose'],
      },
      {
        id: 'test',
        name: 'Test Fix',
        type: 'tool',
        config: {
          tool: 'run_tests',
        },
        dependencies: ['fix'],
      },
      {
        id: 'verify',
        name: 'Verify Resolution',
        type: 'agent',
        config: {
          agent: 'reviewer',
          task: 'Verify bug is resolved',
        },
        dependencies: ['test'],
      },
    ],
  },

  // Feature Implementation Workflow
  'feature-implementation': {
    id: 'feature-implementation',
    name: 'Feature Implementation',
    description: 'End-to-end feature development workflow',
    version: '1.0.0',
    timeout: 1800000,
    retryCount: 2,
    tags: ['feature', 'development'],
    variables: {},
    steps: [
      {
        id: 'requirements',
        name: 'Analyze Requirements',
        type: 'agent',
        config: {
          agent: 'analyst',
          task: 'Analyze feature requirements',
        },
      },
      {
        id: 'design',
        name: 'Design Solution',
        type: 'agent',
        config: {
          agent: 'architect',
          task: 'Design technical solution',
        },
        dependencies: ['requirements'],
      },
      {
        id: 'implement',
        name: 'Implement Feature',
        type: 'agent',
        config: {
          agent: 'developer',
          task: 'Implement the feature',
        },
        dependencies: ['design'],
      },
      {
        id: 'test',
        name: 'Test Feature',
        type: 'tool',
        config: {
          tool: 'run_tests',
        },
        dependencies: ['implement'],
      },
      {
        id: 'document',
        name: 'Document Feature',
        type: 'agent',
        config: {
          agent: 'technical-writer',
          task: 'Write documentation',
        },
        dependencies: ['test'],
      },
    ],
  },
};

// ============================================================================
// Template Service
// ============================================================================

export class WorkflowTemplateService {
  private executionHistory: Map<string, TemplateExecutionResult> = new Map();
  private activeExecutions: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Get template by ID
   */
  getTemplate(templateId: WorkflowTemplateId): WorkflowTemplate | null {
    return TEMPLATES[templateId] || null;
  }

  /**
   * List all templates
   */
  listTemplates(filters?: { tags?: string[] }): WorkflowTemplate[] {
    let templates = Object.values(TEMPLATES);

    if (filters?.tags) {
      templates = templates.filter(t =>
        filters.tags!.some(tag => t.tags.includes(tag))
      );
    }

    return templates;
  }

  /**
   * Execute template workflow
   */
  async executeTemplate(config: TemplateExecutionConfig): Promise<TemplateExecutionResult> {
    const startTime = Date.now();
    const template = this.getTemplate(config.templateId);

    if (!template) {
      return {
        success: false,
        workflowId: '',
        templateId: config.templateId,
        error: `Template not found: ${config.templateId}`,
        duration: Date.now() - startTime,
      };
    }

    logger.info('Executing workflow template', {
      templateId: config.templateId,
      templateName: template.name,
    });

    try {
      // Execute via Mastra workflow integration
      const workflowResult = await mastraWorkflowIntegration.executeWorkflow(
        config.templateId,
        {
          template,
          variables: { ...template.variables, ...config.variables },
          reviewerId: config.reviewerId,
        }
      );

      const result: TemplateExecutionResult = {
        success: workflowResult.success,
        workflowId: workflowResult.workflowId,
        templateId: config.templateId,
        steps: workflowResult.steps,
        result: workflowResult.result,
        error: workflowResult.error,
        duration: workflowResult.duration,
      };

      // Handle memory wipe if enabled
      if (config.enableMemoryWipe && result.success) {
        await this.executeMemoryWipe(config.templateId);
        result.memoryWiped = true;
      }

      // Store execution history
      this.executionHistory.set(result.workflowId, result);

      logger.info('Workflow template execution complete', {
        workflowId: result.workflowId,
        success: result.success,
        duration: result.duration,
      });

      return result;
    } catch (error: any) {
      logger.error('Workflow template execution failed', {
        templateId: config.templateId,
        error: error.message,
      });

      return {
        success: false,
        workflowId: '',
        templateId: config.templateId,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute memory wipe after workflow completion
   */
  private async executeMemoryWipe(workflowId: string): Promise<void> {
    try {
      logger.info('Executing memory wipe after workflow completion', { workflowId });

      // Execute memory wipe template
      await this.executeTemplate({
        templateId: 'memory-wipe',
        enableLogging: false,
      });
    } catch (error: any) {
      logger.warn('Memory wipe failed', { workflowId, error: error.message });
      // Don't fail the main workflow if memory wipe fails
    }
  }

  /**
   * Get execution history
   */
  getExecutionHistory(workflowId?: string): TemplateExecutionResult[] {
    if (workflowId) {
      const result = this.executionHistory.get(workflowId);
      return result ? [result] : [];
    }

    return Array.from(this.executionHistory.values());
  }

  /**
   * Get template statistics
   */
  getStats(): {
    totalTemplates: number;
    totalExecutions: number;
    successRate: number;
    averageDuration: number;
    byTemplate: Record<WorkflowTemplateId, { executions: number; successRate: number }>;
  } {
    const executions = Array.from(this.executionHistory.values());
    const successful = executions.filter(e => e.success).length;

    const byTemplate: any = {};
    for (const templateId of Object.keys(TEMPLATES)) {
      const templateExecutions = executions.filter(e => e.templateId === templateId);
      const templateSuccessful = templateExecutions.filter(e => e.success).length;
      byTemplate[templateId] = {
        executions: templateExecutions.length,
        successRate: templateExecutions.length > 0
          ? (templateSuccessful / templateExecutions.length) * 100
          : 0,
      };
    }

    return {
      totalTemplates: Object.keys(TEMPLATES).length,
      totalExecutions: executions.length,
      successRate: executions.length > 0 ? (successful / executions.length) * 100 : 0,
      averageDuration: executions.length > 0
        ? executions.reduce((sum, e) => sum + e.duration, 0) / executions.length
        : 0,
      byTemplate,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const workflowTemplateService = new WorkflowTemplateService();
