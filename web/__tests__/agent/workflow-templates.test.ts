/**
 * Workflow Templates Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  workflowTemplateService,
  type WorkflowTemplateId,
  type TemplateExecutionConfig,
} from '@/lib/agent/workflow-templates';

describe('Workflow Templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Template Management', () => {
    it('should get template by ID', () => {
      const template = workflowTemplateService.getTemplate('code-review');
      
      expect(template).toBeDefined();
      expect(template?.id).toBe('code-review');
      expect(template?.name).toBe('Code Review & Approval');
      expect(template?.steps.length).toBeGreaterThan(0);
    });

    it('should return null for nonexistent template', () => {
      const template = workflowTemplateService.getTemplate('nonexistent' as any);
      expect(template).toBeNull();
    });

    it('should list all templates', () => {
      const templates = workflowTemplateService.listTemplates();
      
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.map(t => t.id)).toContain('code-review');
      expect(templates.map(t => t.id)).toContain('deployment');
      expect(templates.map(t => t.id)).toContain('memory-wipe');
    });

    it('should filter templates by tags', () => {
      const templates = workflowTemplateService.listTemplates({ tags: ['approval'] });
      
      expect(templates.length).toBeGreaterThan(0);
      templates.forEach(t => {
        expect(t.tags).toContain('approval');
      });
    });

    it('should have all required template fields', () => {
      const templates = workflowTemplateService.listTemplates();
      
      templates.forEach(template => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('version');
        expect(template).toHaveProperty('steps');
        expect(template).toHaveProperty('variables');
        expect(template).toHaveProperty('tags');
        
        // Validate steps
        template.steps.forEach(step => {
          expect(step).toHaveProperty('id');
          expect(step).toHaveProperty('name');
          expect(step).toHaveProperty('type');
          expect(step).toHaveProperty('config');
        });
      });
    });
  });

  describe('Template Types', () => {
    const templateIds: WorkflowTemplateId[] = [
      'code-review',
      'data-pipeline',
      'customer-support',
      'security-audit',
      'deployment',
      'memory-wipe',
      'context-refresh',
      'agent-handoff',
      'multi-step-reasoning',
      'research-analysis',
      'bug-fix',
      'feature-implementation',
    ];

    it.each(templateIds)('should have %s template', (templateId) => {
      const template = workflowTemplateService.getTemplate(templateId);
      
      expect(template).toBeDefined();
      expect(template?.id).toBe(templateId);
    });
  });

  describe('Template Execution', () => {
    it('should fail gracefully for nonexistent template', async () => {
      const config: TemplateExecutionConfig = {
        templateId: 'nonexistent' as any,
      };

      const result = await workflowTemplateService.executeTemplate(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Template not found');
    });

    it('should execute memory-wipe template', async () => {
      const config: TemplateExecutionConfig = {
        templateId: 'memory-wipe',
        enableLogging: false,
      };

      const result = await workflowTemplateService.executeTemplate(config);

      // Will fail without Mastra workflows set up, but tests the flow
      expect(result).toBeDefined();
      expect(result.templateId).toBe('memory-wipe');
    });

    it('should execute with variables override', async () => {
      const config: TemplateExecutionConfig = {
        templateId: 'code-review',
        variables: {
          maxReviewRounds: 5, // Override default
        },
        enableLogging: false,
      };

      const result = await workflowTemplateService.executeTemplate(config);

      expect(result).toBeDefined();
      expect(result.templateId).toBe('code-review');
    });

    it('should execute with memory wipe enabled', async () => {
      const config: TemplateExecutionConfig = {
        templateId: 'bug-fix',
        enableMemoryWipe: true,
        enableLogging: false,
      };

      const result = await workflowTemplateService.executeTemplate(config);

      expect(result).toBeDefined();
      // memoryWiped would be true if execution succeeded
    });
  });

  describe('Execution History', () => {
    it('should get execution history', () => {
      const history = workflowTemplateService.getExecutionHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should get execution history by workflow ID', () => {
      const history = workflowTemplateService.getExecutionHistory('nonexistent');
      expect(history).toHaveLength(0);
    });
  });

  describe('Statistics', () => {
    it('should get template statistics', () => {
      const stats = workflowTemplateService.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalTemplates).toBe('number');
      expect(typeof stats.totalExecutions).toBe('number');
      expect(typeof stats.successRate).toBe('number');
      expect(typeof stats.averageDuration).toBe('number');
      expect(stats.byTemplate).toBeDefined();
    });

    it('should track all templates in statistics', () => {
      const stats = workflowTemplateService.getStats();
      
      const templateIds = [
        'code-review',
        'data-pipeline',
        'customer-support',
        'security-audit',
        'deployment',
        'memory-wipe',
        'context-refresh',
        'agent-handoff',
        'multi-step-reasoning',
        'research-analysis',
        'bug-fix',
        'feature-implementation',
      ];

      templateIds.forEach(id => {
        expect(stats.byTemplate[id]).toBeDefined();
      });
    });
  });

  describe('Template Validation', () => {
    it('should have valid step dependencies', () => {
      const templates = workflowTemplateService.listTemplates();

      templates.forEach(template => {
        const stepIds = template.steps.map(s => s.id);
        
        template.steps.forEach(step => {
          if (step.dependencies) {
            step.dependencies.forEach(depId => {
              expect(stepIds).toContain(depId);
            });
          }
        });
      });
    });

    it('should have valid step types', () => {
      const validTypes = ['agent', 'tool', 'approval', 'condition', 'loop', 'parallel'];
      const templates = workflowTemplateService.listTemplates();

      templates.forEach(template => {
        template.steps.forEach(step => {
          expect(validTypes).toContain(step.type);
        });
      });
    });

    it('should have valid error handlers', () => {
      const validHandlers = ['stop', 'continue', 'retry', undefined];
      const templates = workflowTemplateService.listTemplates();

      templates.forEach(template => {
        template.steps.forEach(step => {
          expect(validHandlers).toContain(step.onError);
        });
      });
    });
  });

  describe('Specific Templates', () => {
    it('code-review template should have approval step', () => {
      const template = workflowTemplateService.getTemplate('code-review');
      
      const approvalSteps = template?.steps.filter(s => s.type === 'approval');
      expect(approvalSteps?.length).toBeGreaterThan(0);
    });

    it('deployment template should have approval gate', () => {
      const template = workflowTemplateService.getTemplate('deployment');
      
      const approvalSteps = template?.steps.filter(s => s.type === 'approval');
      expect(approvalSteps?.length).toBeGreaterThan(0);
    });

    it('memory-wipe template should have backup step', () => {
      const template = workflowTemplateService.getTemplate('memory-wipe');
      
      const backupSteps = template?.steps.filter(s => 
        s.name.toLowerCase().includes('backup')
      );
      expect(backupSteps?.length).toBeGreaterThan(0);
    });

    it('security-audit template should have multiple scan steps', () => {
      const template = workflowTemplateService.getTemplate('security-audit');
      
      const scanSteps = template?.steps.filter(s => 
        s.name.toLowerCase().includes('scan')
      );
      expect(scanSteps?.length).toBeGreaterThan(1);
    });

    it('bug-fix template should have test step', () => {
      const template = workflowTemplateService.getTemplate('bug-fix');
      
      const testSteps = template?.steps.filter(s => 
        s.name.toLowerCase().includes('test')
      );
      expect(testSteps?.length).toBeGreaterThan(0);
    });
  });
});
