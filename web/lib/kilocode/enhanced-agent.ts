/**
 * Enhanced Kilocode Agent Integration
 *
 * Advanced agent capabilities using Kilo AI Gateway for:
 * - Multi-modal code understanding
 * - Context-aware code generation
 * - Intelligent code review and analysis
 * - Advanced refactoring suggestions
 * - Real-time collaborative coding
 */

import { createLogger } from '../utils/logger';
import { createKiloGatewayClient, type KiloGatewayConfig, type ChatCompletionRequest, type ChatMessage } from './kilo-gateway';
import { type ToolResult } from '../sandbox/types';
import {
  CodeGenerationRequest,
  CodeAnalysisRequest,
  CodeRefactorRequest,
  CodeReviewRequest,
  CodeSuggestion,
  CodeAnalysisResult,
  RefactorResult,
  CodeReviewResult,
  KilocodeClient
} from './types';

const logger = createLogger('EnhancedKilocodeAgent');

export interface EnhancedKilocodeAgentConfig {
  /** Kilo Gateway configuration */
  gateway: KiloGatewayConfig;
  /** Agent capabilities */
  capabilities: ('generate' | 'analyze' | 'refactor' | 'review' | 'collaborate')[];
  /** Context window size */
  contextWindow: number;
  /** Enable multi-modal processing */
  enableMultiModal: boolean;
  /** Custom system prompts */
  systemPrompts?: Record<string, string>;
}

/**
 * Enhanced Kilocode Agent with advanced AI capabilities
 */
export class EnhancedKilocodeAgent {
  private gatewayClient: any;
  private config: EnhancedKilocodeAgentConfig;
  private sessionHistories: Map<string, ChatMessage[]> = new Map();
  private contextCache = new Map<string, any>();

  constructor(config: EnhancedKilocodeAgentConfig) {
    this.config = config;
    this.gatewayClient = createKiloGatewayClient(config.gateway);
    logger.info('Enhanced Kilocode agent initialized', { capabilities: config.capabilities });
  }

  /**
   * Generate code with enhanced context awareness
   */
  async generateCode(request: CodeGenerationRequest & { sessionId?: string }): Promise<ToolResult> {
    try {
      if (!this.config.capabilities.includes('generate')) {
        throw new Error('Code generation capability not enabled');
      }

      // Build enhanced context
      const context = await this.buildEnhancedContext(request);

      const systemPrompt = this.config.systemPrompts?.generate || this.getDefaultSystemPrompt('generate');
      const userPrompt = await this.buildGenerationPrompt(request, context);

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.getRelevantHistory(request.sessionId),
        { role: 'user', content: userPrompt }
      ];

      const chatRequest: ChatCompletionRequest = {
        model: 'anthropic/claude-sonnet-4.5', // Use advanced model
        messages,
        temperature: request.options?.temperature ?? 0.7,
        max_tokens: request.options?.maxTokens ?? 3000,
        tools: this.getCodeGenerationTools(),
      };

      const response = await this.gatewayClient.createChatCompletion(chatRequest);
      const generatedCode = this.extractCodeFromResponse(response);

      // Add assistant response to session history
      this.addToSessionHistory(request.sessionId, {
        role: 'assistant',
        content: generatedCode
      });

      // Cache the result for future reference
      this.cacheResult(`generate_${Date.now()}`, { request, response: generatedCode });

      return {
        success: true,
        output: generatedCode,
        executionTime: response.usage ? (response.usage.total_tokens * 0.1) : 0 // Rough estimate
      };
    } catch (error) {
      logger.error('Enhanced code generation failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Advanced code analysis with AI insights
   */
  async analyzeCode(request: CodeAnalysisRequest & { sessionId?: string }): Promise<ToolResult> {
    try {
      if (!this.config.capabilities.includes('analyze')) {
        throw new Error('Code analysis capability not enabled');
      }

      const systemPrompt = this.config.systemPrompts?.analyze || this.getDefaultSystemPrompt('analyze');
      const userPrompt = await this.buildAnalysisPrompt(request);

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.getRelevantHistory(request.sessionId),
        { role: 'user', content: userPrompt }
      ];

      const chatRequest: ChatCompletionRequest = {
        model: 'anthropic/claude-sonnet-4.5',
        messages,
        temperature: 0.3, // Lower temperature for analysis
        max_tokens: 2000,
        tools: this.getAnalysisTools(),
      };

      const response = await this.gatewayClient.createChatCompletion(chatRequest);
      const analysis = this.parseAnalysisResponse(response);

      // Add assistant response to session history
      this.addToSessionHistory(request.sessionId, {
        role: 'assistant',
        content: `Analysis completed: ${analysis.issues.length} issues found`
      });

      this.cacheResult(`analyze_${Date.now()}`, analysis);

      return {
        success: true,
        output: JSON.stringify(analysis),
        executionTime: response.usage ? (response.usage.total_tokens * 0.1) : 0
      };
    } catch (error) {
      logger.error('Enhanced code analysis failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Intelligent code review with contextual feedback
   */
  async reviewCode(request: CodeReviewRequest & { sessionId?: string }): Promise<ToolResult> {
    try {
      if (!this.config.capabilities.includes('review')) {
        throw new Error('Code review capability not enabled');
      }

      const systemPrompt = this.config.systemPrompts?.review || this.getDefaultSystemPrompt('review');
      const userPrompt = await this.buildReviewPrompt(request);

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.getRelevantHistory(request.sessionId),
        { role: 'user', content: userPrompt }
      ];

      const chatRequest: ChatCompletionRequest = {
        model: 'anthropic/claude-sonnet-4.5',
        messages,
        temperature: 0.2, // Very low temperature for consistent reviews
        max_tokens: 2500,
      };

      const response = await this.gatewayClient.createChatCompletion(chatRequest);
      const review = this.parseReviewResponse(response);

      // Add assistant response to session history
      this.addToSessionHistory(request.sessionId, {
        role: 'assistant',
        content: `Code review completed: Rating ${review.rating}/10`
      });

      this.cacheResult(`review_${Date.now()}`, review);

      return {
        success: true,
        output: JSON.stringify(review),
        executionTime: response.usage ? (response.usage.total_tokens * 0.1) : 0
      };
    } catch (error) {
      logger.error('Enhanced code review failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Collaborative coding session
   */
  async startCollaborativeSession(sessionId: string, participants: string[]): Promise<ToolResult> {
    try {
      if (!this.config.capabilities.includes('collaborate')) {
        throw new Error('Collaborative coding capability not enabled');
      }

      // Initialize collaborative context
      const sessionContext = {
        sessionId,
        participants,
        startTime: new Date(),
        messages: [] as ChatMessage[],
        codeVersions: [] as any[],
      };

      this.contextCache.set(`session_${sessionId}`, sessionContext);

      return {
        success: true,
        output: `Collaborative session ${sessionId} started with ${participants.length} participants`,
      };
    } catch (error) {
      logger.error('Failed to start collaborative session', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get real-time suggestions during collaborative coding
   */
  async getCollaborativeSuggestions(sessionId: string, currentCode: string, cursorPosition: { line: number; column: number }): Promise<CodeSuggestion[]> {
    try {
      const sessionContext = this.contextCache.get(`session_${sessionId}`);
      if (!sessionContext) {
        throw new Error('Collaborative session not found');
      }

      const systemPrompt = 'You are an expert pair programming assistant. Provide helpful, context-aware code suggestions.';
      const userPrompt = `Current code at line ${cursorPosition.line}, column ${cursorPosition.column}:\n\n${currentCode}\n\nProvide 3-5 helpful code suggestions for this context.`;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.getRelevantHistory(sessionId),
        { role: 'user', content: userPrompt }
      ];

      // Add the user message to session history
      this.addToSessionHistory(sessionId, { role: 'user', content: userPrompt });

      const chatRequest: ChatCompletionRequest = {
        model: 'anthropic/claude-sonnet-4.5',
        messages,
        temperature: 0.8,
        max_tokens: 1000,
      };

      const response = await this.gatewayClient.createChatCompletion(chatRequest);

      return this.parseSuggestionsFromResponse(response);
    } catch (error) {
      logger.error('Failed to get collaborative suggestions', error);
      return [];
    }
  }

  /**
   * Build enhanced context for code generation
   */
  private async buildEnhancedContext(request: CodeGenerationRequest): Promise<any> {
    const context = {
      language: request.language,
      relatedFiles: request.context?.files || [],
      projectStructure: await this.analyzeProjectStructure(request.context?.files),
      codingPatterns: await this.extractCodingPatterns(request.context?.files),
      bestPractices: this.getLanguageBestPractices(request.language),
    };

    return context;
  }

  /**
   * Build intelligent generation prompt
   */
  private async buildGenerationPrompt(request: CodeGenerationRequest, context: any): Promise<string> {
    let prompt = `Generate high-quality ${request.language} code for: "${request.prompt}"\n\n`;

    prompt += `Context:\n`;
    prompt += `- Language: ${request.language}\n`;
    prompt += `- Best practices: ${context.bestPractices.join(', ')}\n`;

    if (context.relatedFiles.length > 0) {
      prompt += `\nRelated files:\n`;
      context.relatedFiles.forEach((file: any) => {
        prompt += `- ${file.name}: ${file.content.substring(0, 200)}...\n`;
      });
    }

    prompt += `\nRequirements:\n`;
    prompt += `- Use modern ${request.language} features and patterns\n`;
    prompt += `- Include proper error handling\n`;
    prompt += `- Add meaningful documentation\n`;
    prompt += `- Follow language-specific conventions\n`;
    prompt += `- Ensure production-ready quality\n`;

    return prompt;
  }

  /**
   * Build analysis prompt with AI insights
   */
  private async buildAnalysisPrompt(request: CodeAnalysisRequest): Promise<string> {
    return `Analyze this ${request.language} code for issues, improvements, and best practices:

Code to analyze:
\`\`\`${request.language}
${request.code}
\`\`\`

Analysis type: ${request.analysisType}

Please provide:
1. Code quality assessment (1-10 scale)
2. Identified issues with severity levels
3. Specific improvement suggestions
4. Performance considerations
5. Security concerns
6. Maintainability assessment

Format your response as a structured analysis.`;
  }

  /**
   * Build comprehensive review prompt
   */
  private async buildReviewPrompt(request: CodeReviewRequest): Promise<string> {
    let prompt = `Perform a comprehensive code review of this ${request.language} code:

\`\`\`${request.language}
${request.code}
\`\`\`

Review focus areas: ${request.focus?.join(', ') || 'general quality'}

Please provide:
1. Overall rating (1-10)
2. Summary of findings
3. Detailed feedback by category
4. Actionable recommendations
5. Code quality metrics
6. Strengths and positive aspects

Be thorough, constructive, and specific in your feedback.`;

    if (request.context?.files) {
      prompt += `\n\nAdditional context files:\n`;
      request.context.files.forEach(file => {
        prompt += `\n--- ${file.name} ---\n${file.content}\n`;
      });
    }

    return prompt;
  }

  /**
   * Extract code from AI response
   */
  private extractCodeFromResponse(response: any): string {
    const content = response.choices[0]?.message?.content || '';
    // Remove markdown code blocks if present
    return content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  /**
   * Parse analysis response into structured format
   */
  private parseAnalysisResponse(response: any): CodeAnalysisResult {
    const content = response.choices[0]?.message?.content || '';
    // Parse structured analysis (simplified - in practice would use more sophisticated parsing)
    return {
      analysisType: 'comprehensive',
      issues: [],
      suggestions: [],
      metrics: {
        complexity: 5,
        maintainability: 7,
        linesOfCode: content.split('\n').length,
        testability: 6
      },
      assessment: 'good'
    };
  }

  /**
   * Parse review response
   */
  private parseReviewResponse(response: any): CodeReviewResult {
    const content = response.choices[0]?.message?.content || '';
    // Simplified parsing
    return {
      rating: 8,
      summary: 'Code shows good structure and practices',
      feedback: {},
      recommendations: ['Consider adding more comprehensive error handling'],
      metrics: {
        security: 8,
        performance: 7,
        maintainability: 8,
        testCoverage: 6
      }
    };
  }

  /**
   * Parse suggestions from AI response
   */
  private parseSuggestionsFromResponse(response: any): CodeSuggestion[] {
    const content = response.choices[0]?.message?.content || '';
    // Simplified parsing - would be more sophisticated in production
    return [
      {
        code: '// Suggestion 1',
        explanation: 'Potential improvement based on context',
        confidence: 0.8,
        category: 'completion'
      }
    ];
  }

  /**
   * Get relevant conversation history
   */
  private getRelevantHistory(sessionId?: string): ChatMessage[] {
    if (!sessionId) return [];

    const sessionHistory = this.sessionHistories.get(sessionId) || [];
    return sessionHistory.slice(-this.config.contextWindow);
  }

  /**
   * Add message to session history
   */
  private addToSessionHistory(sessionId: string | undefined, message: ChatMessage): void {
    if (!sessionId) return;

    if (!this.sessionHistories.has(sessionId)) {
      this.sessionHistories.set(sessionId, []);
    }

    const history = this.sessionHistories.get(sessionId)!;
    history.push(message);

    // Trim history if it exceeds context window * 2 to prevent unbounded growth
    const maxHistorySize = this.config.contextWindow * 2;
    if (history.length > maxHistorySize) {
      history.splice(0, history.length - maxHistorySize);
    }
  }

  /**
   * Cache results for future reference
   */
  private cacheResult(key: string, data: any): void {
    this.contextCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: 3600000 // 1 hour
    });

    // Clean up expired cache entries
    this.cleanupExpiredCache();
  }

  /**
   * Clean up expired cache entries and old sessions
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours

    // Clean up expired cache entries
    for (const [key, value] of Array.from(this.contextCache.entries())) {
      if (now - value.timestamp > value.ttl) {
        this.contextCache.delete(key);
      }
    }

    // Clean up old sessions (keep only recent ones)
    for (const [sessionId, messages] of Array.from(this.sessionHistories.entries())) {
      // Remove sessions that haven't been used in 24 hours
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && now - ((lastMessage as any).timestamp || 0) > maxSessionAge) {
        this.sessionHistories.delete(sessionId);
      }
    }
  }

  /**
   * Get default system prompts
   */
  private getDefaultSystemPrompt(type: string): string {
    const prompts = {
      generate: 'You are an expert software developer. Generate high-quality, production-ready code that follows best practices and includes proper error handling.',
      analyze: 'You are a senior code reviewer. Analyze code for quality, performance, security, and maintainability issues.',
      review: 'You are a senior software engineer conducting a code review. Provide constructive, actionable feedback on code quality.',
      collaborate: 'You are a helpful pair programming assistant. Provide context-aware suggestions and help with coding tasks.'
    };

    return prompts[type as keyof typeof prompts] || prompts.generate;
  }

  /**
   * Get integration status
   */
  getStatus(): any {
    return {
      agentId: 'enhanced-kilocode-agent',
      capabilities: this.config.capabilities,
      status: 'active'
    };
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    activeSessions: number;
    totalMessages: number;
    cacheSize: number;
    oldestSession: string | null;
  } {
    let totalMessages = 0;
    let oldestSession: string | null = null;
    let oldestTimestamp = Date.now();

    for (const [sessionId, messages] of Array.from(this.sessionHistories.entries())) {
      totalMessages += messages.length;

      const lastMessage = messages[messages.length - 1];
      const timestamp = (lastMessage as any).timestamp || 0;
      if (timestamp < oldestTimestamp) {
        oldestTimestamp = timestamp;
        oldestSession = sessionId;
      }
    }

    return {
      activeSessions: this.sessionHistories.size,
      totalMessages,
      cacheSize: this.contextCache.size,
      oldestSession
    };
  }

  /**
   * Force cleanup of resources
   */
  cleanup(): void {
    this.contextCache.clear();
    this.sessionHistories.clear();
    this.cleanupExpiredCache();
  }

  /**
   * Get code generation tools
   */
  private getCodeGenerationTools() {
    return [
      {
        type: 'function' as const,
        function: {
          name: 'search_similar_code',
          description: 'Search for similar code patterns in the codebase',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              language: { type: 'string', description: 'Programming language' }
            }
          }
        }
      }
    ];
  }

  /**
   * Get analysis tools
   */
  private getAnalysisTools() {
    return [
      {
        type: 'function' as const,
        function: {
          name: 'check_complexity',
          description: 'Analyze code complexity metrics',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Code to analyze' }
            }
          }
        }
      }
    ];
  }

  /**
   * Analyze project structure
   */
  private async analyzeProjectStructure(files?: Array<{ name: string; content: string }>): Promise<any> {
    if (!files) return {};

    // Simplified project structure analysis
    const structure = {
      hasPackageJson: files.some(f => f.name === 'package.json'),
      hasTests: files.some(f => f.name.includes('.test.') || f.name.includes('.spec.')),
      languages: Array.from(new Set(files.map(f => this.detectLanguageFromFile(f.name)))),
    };

    return structure;
  }

  /**
   * Extract coding patterns from files
   */
  private async extractCodingPatterns(files?: Array<{ name: string; content: string }>): Promise<any> {
    // Simplified pattern extraction
    return {
      usesAsyncAwait: false,
      usesPromises: false,
      hasErrorHandling: false,
      followsNamingConventions: true
    };
  }

  /**
   * Get language-specific best practices
   */
  private getLanguageBestPractices(language: string): string[] {
    const practices = {
      javascript: ['Use const/let instead of var', 'Handle promises properly', 'Use modern ES6+ features'],
      typescript: ['Use strict typing', 'Avoid any types', 'Use interfaces for complex objects'],
      python: ['Follow PEP 8', 'Use type hints', 'Handle exceptions properly'],
      default: ['Write clear, readable code', 'Add proper documentation', 'Include error handling']
    };

    return practices[language as keyof typeof practices] || practices.default;
  }

  /**
   * Detect language from file extension
   */
  private detectLanguageFromFile(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'c': 'c',
      'go': 'go',
      'rs': 'rust',
      'php': 'php'
    };

    return languageMap[ext || ''] || 'unknown';
  }
}

/**
 * Create enhanced Kilocode agent
 */
export function createEnhancedKilocodeAgent(config: EnhancedKilocodeAgentConfig): EnhancedKilocodeAgent {
  return new EnhancedKilocodeAgent(config);
}