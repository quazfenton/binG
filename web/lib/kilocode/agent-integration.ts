/**
 * Kilocode Agent Integration
 *
 * Integrates Kilocode AI capabilities with binG's agent orchestration system.
 * Provides tools for agents to generate, complete, analyze, and refactor code
 * through the Kilocode server API.
 */

import { createLogger } from '../utils/logger';
import { createKilocodeClient, defaultKilocodeConfig } from './client';
import { ToolResult } from '../sandbox/types';
import {
  CodeGenerationRequest,
  CodeCompletionRequest,
  CodeAnalysisRequest,
  CodeRefactorRequest,
  CodeReviewRequest,
  KilocodeClient,
  KilocodeAgentIntegration
} from './types';

const logger = createLogger('KilocodeAgent');

export class KilocodeAgent {
  private client: KilocodeClient;
  private integration: KilocodeAgentIntegration;

  constructor(
    agentId: string,
    config = defaultKilocodeConfig,
    capabilities: KilocodeAgentIntegration['capabilities'] = ['generate', 'complete', 'analyze', 'refactor', 'review']
  ) {
    this.client = createKilocodeClient(config);
    this.integration = {
      agentId,
      capabilities,
      status: 'active'
    };

    logger.info('Kilocode agent initialized', { agentId, capabilities: capabilities.length });
  }

  /**
   * Generate code using Kilocode AI
   */
  async generateCode(request: CodeGenerationRequest): Promise<ToolResult> {
    try {
      if (!this.integration.capabilities.includes('generate')) {
        throw new Error('Code generation capability not enabled for this agent');
      }

      logger.info('Generating code', {
        agentId: this.integration.agentId,
        language: request.language,
        promptLength: request.prompt.length
      });

      const response = await this.client.generate(request);

      if (!response.success) {
        throw new Error(response.error || 'Code generation failed');
      }

      this.updateStats('requests');

      return {
        success: true,
        output: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        executionTime: response.metadata?.processingTime
      };
    } catch (error) {
      logger.error('Code generation failed', error);
      this.updateStats('errors');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Complete code at cursor position
   */
  async completeCode(request: CodeCompletionRequest): Promise<ToolResult> {
    try {
      if (!this.integration.capabilities.includes('complete')) {
        throw new Error('Code completion capability not enabled for this agent');
      }

      const response = await this.client.complete(request);

      if (!response.success) {
        throw new Error(response.error || 'Code completion failed');
      }

      this.updateStats('requests');

      return {
        success: true,
        output: JSON.stringify(response.data),
        executionTime: response.metadata?.processingTime
      };
    } catch (error) {
      logger.error('Code completion failed', error);
      this.updateStats('errors');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Analyze code for issues and improvements
   */
  async analyzeCode(request: CodeAnalysisRequest): Promise<ToolResult> {
    try {
      if (!this.integration.capabilities.includes('analyze')) {
        throw new Error('Code analysis capability not enabled for this agent');
      }

      const response = await this.client.analyze(request);

      if (!response.success) {
        throw new Error(response.error || 'Code analysis failed');
      }

      this.updateStats('requests');

      return {
        success: true,
        output: JSON.stringify(response.data),
        executionTime: response.metadata?.processingTime
      };
    } catch (error) {
      logger.error('Code analysis failed', error);
      this.updateStats('errors');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Refactor code
   */
  async refactorCode(request: CodeRefactorRequest): Promise<ToolResult> {
    try {
      if (!this.integration.capabilities.includes('refactor')) {
        throw new Error('Code refactoring capability not enabled for this agent');
      }

      const response = await this.client.refactor(request);

      if (!response.success) {
        throw new Error(response.error || 'Code refactoring failed');
      }

      this.updateStats('requests');

      return {
        success: true,
        output: JSON.stringify(response.data),
        executionTime: response.metadata?.processingTime
      };
    } catch (error) {
      logger.error('Code refactoring failed', error);
      this.updateStats('errors');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Review code quality
   */
  async reviewCode(request: CodeReviewRequest): Promise<ToolResult> {
    try {
      if (!this.integration.capabilities.includes('review')) {
        throw new Error('Code review capability not enabled for this agent');
      }

      const response = await this.client.review(request);

      if (!response.success) {
        throw new Error(response.error || 'Code review failed');
      }

      this.updateStats('requests');

      return {
        success: true,
        output: JSON.stringify(response.data),
        executionTime: response.metadata?.processingTime
      };
    } catch (error) {
      logger.error('Code review failed', error);
      this.updateStats('errors');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Stream code generation
   */
  async *streamCodeGeneration(request: CodeGenerationRequest): AsyncIterable<string> {
    try {
      for await (const chunk of this.client.generateStream(request)) {
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        if (chunk.chunk) {
          yield chunk.chunk;
        }
        if (chunk.done) {
          break;
        }
      }
    } catch (error) {
      logger.error('Streaming code generation failed', error);
      throw error;
    }
  }

  /**
   * Get available capabilities
   */
  getCapabilities(): KilocodeAgentIntegration['capabilities'] {
    return this.integration.capabilities;
  }

  /**
   * Check if agent has specific capability
   */
  hasCapability(capability: string): boolean {
    return this.integration.capabilities.includes(capability as any);
  }

  /**
   * Get integration status
   */
  getStatus(): KilocodeAgentIntegration {
    return { ...this.integration };
  }

  /**
   * Update agent statistics
   */
  private updateStats(type: 'requests' | 'errors' | 'tokens', count = 1): void {
    if (!this.integration.stats) {
      this.integration.stats = { requests: 0, tokens: 0, errors: 0 };
    }

    this.integration.stats[type] += count;
    this.integration.lastUsed = Date.now();
  }

  /**
   * Test connection to Kilocode server
   */
  async testConnection(): Promise<boolean> {
    try {
      await (this.client as any).healthCheck();
      this.integration.status = 'active';
      return true;
    } catch (error) {
      logger.error('Kilocode server connection test failed', error);
      this.integration.status = 'error';
      return false;
    }
  }
}

/**
 * Create Kilocode agent with default configuration
 */
export function createKilocodeAgent(
  agentId: string,
  config = defaultKilocodeConfig,
  capabilities?: KilocodeAgentIntegration['capabilities']
): KilocodeAgent {
  return new KilocodeAgent(agentId, config, capabilities);
}

/**
 * Kilocode MCP Tools for agent integration
 */
export const kilocodeMCPTools = {
  'kilocode.generate': {
    name: 'kilocode.generate',
    description: 'Generate code from natural language description',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Natural language description of desired code' },
        language: { type: 'string', description: 'Target programming language' },
        context: {
          type: 'object',
          description: 'Additional context for code generation',
          properties: {
            files: {
              type: 'array',
              items: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } } }
            }
          }
        }
      },
      required: ['prompt', 'language']
    }
  },

  'kilocode.complete': {
    name: 'kilocode.complete',
    description: 'Complete code at cursor position',
    parameters: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Code before cursor' },
        suffix: { type: 'string', description: 'Code after cursor' },
        language: { type: 'string', description: 'Programming language' }
      },
      required: ['prefix', 'language']
    }
  },

  'kilocode.analyze': {
    name: 'kilocode.analyze',
    description: 'Analyze code for issues and improvements',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to analyze' },
        language: { type: 'string', description: 'Programming language' },
        analysisType: {
          type: 'string',
          enum: ['lint', 'format', 'refactor', 'optimize', 'explain'],
          description: 'Type of analysis to perform'
        }
      },
      required: ['code', 'language', 'analysisType']
    }
  },

  'kilocode.refactor': {
    name: 'kilocode.refactor',
    description: 'Refactor code for better quality',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to refactor' },
        language: { type: 'string', description: 'Programming language' },
        refactorType: {
          type: 'string',
          enum: ['extract-method', 'rename-variable', 'simplify-condition', 'add-error-handling', 'optimize-performance'],
          description: 'Type of refactoring to perform'
        }
      },
      required: ['code', 'language', 'refactorType']
    }
  },

  'kilocode.review': {
    name: 'kilocode.review',
    description: 'Review code for quality and best practices',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to review' },
        language: { type: 'string', description: 'Programming language' },
        focus: {
          type: 'array',
          items: { type: 'string', enum: ['security', 'performance', 'maintainability', 'best-practices'] },
          description: 'Areas to focus the review on'
        }
      },
      required: ['code', 'language']
    }
  }
};

/**
 * Execute Kilocode tool calls for agents
 */
export async function executeKilocodeTool(
  agent: KilocodeAgent,
  toolName: string,
  parameters: any
): Promise<ToolResult> {
  switch (toolName) {
    case 'kilocode.generate':
      return agent.generateCode(parameters as CodeGenerationRequest);

    case 'kilocode.complete':
      return agent.completeCode(parameters as CodeCompletionRequest);

    case 'kilocode.analyze':
      return agent.analyzeCode(parameters as CodeAnalysisRequest);

    case 'kilocode.refactor':
      return agent.refactorCode(parameters as CodeRefactorRequest);

    case 'kilocode.review':
      return agent.reviewCode(parameters as CodeReviewRequest);

    default:
      return {
        success: false,
        error: `Unknown Kilocode tool: ${toolName}`
      };
  }
}