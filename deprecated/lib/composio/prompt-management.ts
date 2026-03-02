/**
 * Composio Prompt Management
 * 
 * Manages prompts for Composio tool execution.
 * Enables prompt templates, versioning, and optimization.
 * 
 * Features:
 * - Prompt templates
 * - Version control
 * - A/B testing
 * - Performance tracking
 */

import { EventEmitter } from 'events';

/**
 * Prompt template
 */
export interface PromptTemplate {
  /**
   * Template ID
   */
  id: string;
  
  /**
   * Template name
   */
  name: string;
  
  /**
   * Template content
   */
  content: string;
  
  /**
   * Template variables
   */
  variables: string[];
  
  /**
   * Template version
   */
  version: number;
  
  /**
   * Whether template is active
   */
  active: boolean;
  
  /**
   * Created timestamp
   */
  createdAt: number;
  
  /**
   * Updated timestamp
   */
  updatedAt: number;
  
  /**
   * Usage count
   */
  usageCount: number;
  
  /**
   * Average success rate
   */
  avgSuccessRate?: number;
}

/**
 * Prompt execution result
 */
export interface PromptExecutionResult {
  /**
   * Template ID
   */
  templateId: string;
  
  /**
   * Execution timestamp
   */
  timestamp: number;
  
  /**
   * Success status
   */
  success: boolean;
  
  /**
   * Execution duration in ms
   */
  duration: number;
  
  /**
   * Tool used
   */
  tool?: string;
  
  /**
   * Error message if failed
   */
  error?: string;
}

/**
 * Composio Prompt Manager
 * 
 * Manages prompt templates and execution.
 */
export class ComposioPromptManager extends EventEmitter {
  private templates: Map<string, PromptTemplate> = new Map();
  private executionHistory: PromptExecutionResult[] = [];
  private readonly MAX_HISTORY = 10000;

  constructor() {
    super();
  }

  /**
   * Create prompt template
   * 
   * @param name - Template name
   * @param content - Template content
   * @param variables - Template variables
   * @returns Prompt template
   */
  createTemplate(
    name: string,
    content: string,
    variables?: string[]
  ): PromptTemplate {
    const templateId = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Extract variables from content if not provided
    const extractedVars = variables || this.extractVariables(content);
    
    const template: PromptTemplate = {
      id: templateId,
      name,
      content,
      variables: extractedVars,
      version: 1,
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    };

    this.templates.set(templateId, template);
    this.emit('template-created', template);

    return template;
  }

  /**
   * Get template by ID
   * 
   * @param templateId - Template ID
   * @returns Prompt template or null
   */
  getTemplate(templateId: string): PromptTemplate | null {
    return this.templates.get(templateId) || null;
  }

  /**
   * Update template
   * 
   * @param templateId - Template ID
   * @param updates - Template updates
   * @returns Updated template or null
   */
  updateTemplate(
    templateId: string,
    updates: Partial<PromptTemplate>
  ): PromptTemplate | null {
    const template = this.templates.get(templateId);
    
    if (!template) {
      return null;
    }

    const updated = {
      ...template,
      ...updates,
      version: template.version + 1,
      updatedAt: Date.now(),
    };

    this.templates.set(templateId, updated);
    this.emit('template-updated', updated);

    return updated;
  }

  /**
   * Delete template
   * 
   * @param templateId - Template ID
   */
  deleteTemplate(templateId: string): void {
    const existed = this.templates.delete(templateId);
    
    if (existed) {
      this.emit('template-deleted', templateId);
    }
  }

  /**
   * Render template with variables
   * 
   * @param templateId - Template ID
   * @param values - Variable values
   * @returns Rendered prompt or null
   */
  renderTemplate(templateId: string, values: Record<string, string>): string | null {
    const template = this.templates.get(templateId);
    
    if (!template) {
      return null;
    }

    let rendered = template.content;
    
    for (const [key, value] of Object.entries(values)) {
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    // Update usage count
    template.usageCount++;
    this.emit('template-rendered', { template, values });

    return rendered;
  }

  /**
   * Record execution result
   * 
   * @param result - Execution result
   */
  recordExecution(result: PromptExecutionResult): void {
    this.executionHistory.push(result);
    
    // Enforce max history
    if (this.executionHistory.length > this.MAX_HISTORY) {
      this.executionHistory.shift();
    }

    // Update template stats
    const template = this.templates.get(result.templateId);
    if (template) {
      const templateResults = this.executionHistory.filter(r => r.templateId === result.templateId);
      const successCount = templateResults.filter(r => r.success).length;
      template.avgSuccessRate = templateResults.length > 0
        ? (successCount / templateResults.length) * 100
        : undefined;
    }

    this.emit('execution-recorded', result);
  }

  /**
   * Get execution history
   * 
   * @param templateId - Optional template ID
   * @param limit - Max results
   * @returns Array of execution results
   */
  getExecutionHistory(templateId?: string, limit: number = 100): PromptExecutionResult[] {
    let history = [...this.executionHistory];
    
    if (templateId) {
      history = history.filter(r => r.templateId === templateId);
    }
    
    return history.slice(-limit);
  }

  /**
   * Get template performance stats
   * 
   * @param templateId - Template ID
   * @returns Performance stats
   */
  getTemplateStats(templateId: string): {
    totalExecutions: number;
    successRate: number;
    averageDuration: number;
    recentSuccessRate: number;
  } {
    const history = this.executionHistory.filter(r => r.templateId === templateId);
    
    const totalExecutions = history.length;
    const successCount = history.filter(r => r.success).length;
    const successRate = totalExecutions > 0 ? (successCount / totalExecutions) * 100 : 0;
    
    const totalDuration = history.reduce((sum, r) => sum + r.duration, 0);
    const averageDuration = totalExecutions > 0 ? totalDuration / totalExecutions : 0;
    
    // Recent success rate (last 100 executions)
    const recentHistory = history.slice(-100);
    const recentSuccessCount = recentHistory.filter(r => r.success).length;
    const recentSuccessRate = recentHistory.length > 0
      ? (recentSuccessCount / recentHistory.length) * 100
      : 0;

    return {
      totalExecutions,
      successRate,
      averageDuration,
      recentSuccessRate,
    };
  }

  /**
   * Get all templates
   * 
   * @param activeOnly - Whether to return only active templates
   * @returns Array of templates
   */
  getAllTemplates(activeOnly: boolean = false): PromptTemplate[] {
    const templates = Array.from(this.templates.values());
    
    if (activeOnly) {
      return templates.filter(t => t.active);
    }
    
    return templates;
  }

  /**
   * Compare templates (A/B testing)
   * 
   * @param templateIds - Template IDs to compare
   * @returns Comparison results
   */
  compareTemplates(templateIds: string[]): Array<{
    templateId: string;
    templateName: string;
    executions: number;
    successRate: number;
    averageDuration: number;
  }> {
    return templateIds.map(id => {
      const template = this.templates.get(id);
      const stats = this.getTemplateStats(id);
      
      return {
        templateId: id,
        templateName: template?.name || 'Unknown',
        executions: stats.totalExecutions,
        successRate: stats.successRate,
        averageDuration: stats.averageDuration,
      };
    });
  }

  /**
   * Extract variables from template content
   */
  private extractVariables(content: string): string[] {
    const matches = content.match(/\{\{(\w+)\}\}/g);
    
    if (!matches) {
      return [];
    }
    
    return [...new Set(matches.map(m => m.slice(2, -2)))];
  }

  /**
   * Clear execution history
   * 
   * @param templateId - Optional template ID
   */
  clearHistory(templateId?: string): void {
    if (templateId) {
      this.executionHistory = this.executionHistory.filter(r => r.templateId !== templateId);
    } else {
      this.executionHistory = [];
    }
  }
}

// Singleton instance
export const composioPromptManager = new ComposioPromptManager();

/**
 * Create prompt manager
 * 
 * @returns Prompt manager
 */
export function createPromptManager(): ComposioPromptManager {
  return new ComposioPromptManager();
}

/**
 * Pre-configured prompt templates
 */
export const PromptTemplates = {
  /**
   * Tool execution prompt
   */
  toolExecution: (toolName: string) => composioPromptManager.createTemplate(
    'tool-execution',
    `Execute the {{toolName}} tool with the following parameters:
{{parameters}}

Provide a clear explanation of what the tool does and interpret the results.`
  ),

  /**
   * Error handling prompt
   */
  errorHandling: () => composioPromptManager.createTemplate(
    'error-handling',
    `An error occurred during tool execution:
{{error}}

Analyze the error and suggest:
1. What went wrong
2. How to fix it
3. Alternative approaches`
  ),

  /**
   * Result interpretation prompt
   */
  resultInterpretation: () => composioPromptManager.createTemplate(
    'result-interpretation',
    `Tool execution completed with the following result:
{{result}}

Provide:
1. Summary of what was accomplished
2. Key insights from the result
3. Recommended next steps`
  ),

  /**
   * Multi-step workflow prompt
   */
  multiStepWorkflow: () => composioPromptManager.createTemplate(
    'multi-step-workflow',
    `Execute the following workflow steps:
{{steps}}

For each step:
1. Execute the tool
2. Verify the result
3. Proceed to next step or handle errors

Current step: {{currentStep}}
Previous results: {{previousResults}}`
  ),
};
