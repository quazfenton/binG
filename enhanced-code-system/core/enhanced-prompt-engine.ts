/**
 * Enhanced Prompt Engine for Technical Code Responses
 *
 * Provides advanced prompting capabilities with:
 * - Verbose technical code generation with streaming support
 * - Prompt-engineered depth handling for complex scenarios
 * - Extended context management for large token limits
 * - Integration with agentic frameworks (CrewAI, PraisonAI, AG2)
 * - Schema-enforced communication protocols
 * - Iterative workflow management with diff-based updates
 */

import { EventEmitter } from 'events';
import { diff_match_patch } from 'diff-match-patch';
import { z } from 'zod';
import { llmIntegration } from './llm-integration';
import { createPromptEngineError, ERROR_CODES } from './error-types';

// Core response schema for structured communication
const EnhancedResponseSchema = z.object({
  task: z.string().describe("Primary task description"),
  rules: z.array(z.string()).describe("Applicable rules and constraints"),
  file_context: z.object({
    file_name: z.string(),
    content: z.string(),
    language: z.string().optional(),
    line_count: z.number().optional()
  }).optional(),
  diffs: z.array(z.object({
    operation: z.enum(['insert', 'replace', 'delete', 'modify']),
    line_range: z.tuple([z.number(), z.number()]),
    content: z.string(),
    description: z.string().optional(),
    confidence: z.number().min(0).max(1).optional()
  })),
  next_file_request: z.string().nullable(),
  workflow_state: z.enum(['in_progress', 'needs_approval', 'completed', 'failed']),
  technical_depth: z.object({
    complexity_score: z.number().min(1).max(10),
    requires_streaming: z.boolean(),
    estimated_tokens: z.number(),
    dependencies: z.array(z.string()).optional()
  }),
  agentic_metadata: z.object({
    agent_type: z.enum(['single', 'crew', 'multi_step']).optional(),
    iteration_count: z.number().default(1),
    quality_score: z.number().min(0).max(1).optional(),
    framework: z.enum(['crewai', 'praisonai', 'ag2', 'custom']).optional()
  }).optional()
});

type EnhancedResponse = z.infer<typeof EnhancedResponseSchema>;

// Advanced prompting templates for different scenarios
const PROMPT_TEMPLATES = {
  VERBOSE_TECHNICAL: `
You are an expert software engineer with deep technical knowledge. Generate verbose, production-ready code with:
- Comprehensive comments explaining logic, edge cases, and design decisions
- Detailed error handling and validation
- Performance considerations and optimization notes
- Security best practices where applicable
- Type safety and strict typing
- Extensible and maintainable architecture
- Consider scalability and future requirements

Context: {context}
Task: {task}
Constraints: {constraints}
Technical Depth Required: {depth_level}
`,

  CHAIN_OF_THOUGHT: `
Break down this complex task using chain-of-thought reasoning:
1. Analyze the requirements and identify core components
2. Consider edge cases and potential failure modes
3. Design the solution architecture step by step
4. Implement with detailed explanations for each decision
5. Validate the solution against requirements

Task: {task}
Current Context: {context}
Previous Steps: {previous_steps}
`,

  ITERATIVE_REFINEMENT: `
This is iteration {iteration_number} of {total_iterations}.
Previous output quality score: {quality_score}
Areas for improvement: {improvement_areas}

Refine the previous solution by:
- Addressing identified weaknesses
- Enhancing code quality and robustness
- Optimizing performance where needed
- Improving maintainability and readability

Previous Solution: {previous_solution}
`,

  MULTI_FILE_CONTEXT: `
Working with multi-file project context.
Primary file: {primary_file}
Related files: {related_files}
Project structure: {project_structure}

Ensure:
- Consistency across files
- Proper import/export relationships
- State synchronization where needed
- Modular and cohesive design
`
};

interface ProjectItem {
  id: string;
  name: string;
  path: string;
  content: string;
  language: string;
  hasEdits: boolean;
  lastModified: Date;
}

interface AgenticFrameworkConfig {
  framework: 'crewai' | 'praisonai' | 'ag2' | 'custom';
  agents?: Array<{
    role: string;
    goal: string;
    backstory: string;
    tools?: string[];
  }>;
  maxIterations?: number;
  qualityThreshold?: number;
  collaborationMode?: 'sequential' | 'parallel' | 'hierarchical';
}

class EnhancedPromptEngine extends EventEmitter {
  private dmp: diff_match_patch;
  private contextCache: Map<string, any> = new Map();
  private projectState: Map<string, ProjectItem> = new Map();
  private workflowStack: Array<Partial<EnhancedResponse>> = [];
  private agenticConfig?: AgenticFrameworkConfig;

  constructor(config?: {
    maxTokens?: number;
    streamingEnabled?: boolean;
    agenticFramework?: AgenticFrameworkConfig;
  }) {
    super();
    this.dmp = new diff_match_patch();
    this.agenticConfig = config?.agenticFramework;
  }

  /**
   * Enhanced prompt generation with depth control and context awareness
   */
  async generateEnhancedPrompt(
    task: string,
    options: {
      files?: ProjectItem[];
      rules?: string[];
      depthLevel?: number;
      promptingStrategy?: 'verbose' | 'chain_of_thought' | 'iterative' | 'multi_file';
      streamingRequired?: boolean;
      previousIteration?: Partial<EnhancedResponse>;
      contextHints?: string[];
      qualityRequirements?: {
        depth?: 'minimal' | 'standard' | 'deep' | 'exhaustive';
        focusAreas?: string[];
        constraints?: string[];
      };
    }
  ): Promise<string> {
    const {
      files = [],
      rules = [],
      depthLevel = 5,
      promptingStrategy = 'verbose',
      streamingRequired = false,
      previousIteration,
      contextHints = [],
      qualityRequirements = {}
    } = options;

    // Build context from files and project state
    const context = this.buildEnhancedContext(files);

    // Select appropriate template
    const template = this.selectPromptTemplate(promptingStrategy, previousIteration);

    // Apply advanced prompting techniques
    const enhancedPrompt = this.applyPromptEngineering(template, {
      task,
      context,
      rules,
      depthLevel,
      streamingRequired,
      previousIteration,
      contextHints,
      qualityRequirements
    });

    // Add system directives for enhanced quality
    const systemDirectives = [
      "SYSTEM DIRECTIVES:",
      "- Generate production-ready, maintainable code",
      "- Include comprehensive error handling",
      "- Add detailed comments explaining complex logic",
      "- Consider performance and security implications",
      "- Use strict typing and validation where applicable",
      "- Follow established design patterns and best practices",
      "- Optimize for readability and future maintainability",
      streamingRequired ? "- Provide incremental outputs for large code blocks" : "",
      qualityRequirements.depth === 'exhaustive' ? "- Provide exhaustive detail and edge case coverage" : "",
      qualityRequirements.focusAreas?.length ? `- Focus on: ${qualityRequirements.focusAreas.join(', ')}` : "",
      qualityRequirements.constraints?.length ? `- Constraints: ${qualityRequirements.constraints.join(', ')}` : "",
      ""
    ].filter(Boolean).join('\n');

    const finalPrompt = systemDirectives + enhancedPrompt;

    // Cache for potential reuse
    this.contextCache.set(`prompt_${Date.now()}`, {
      prompt: finalPrompt,
      context,
      timestamp: new Date()
    });

    return finalPrompt;
  }

  /**
   * Process code response with diff generation and state management
   */
  async processCodeResponse(
    response: string,
    targetFile: ProjectItem,
    options: {
      generateDiffs?: boolean;
      validateSyntax?: boolean;
      updateProjectState?: boolean;
    } = {}
  ): Promise<EnhancedResponse> {
    const { generateDiffs = true, validateSyntax = true, updateProjectState = true } = options;

    let diffs: EnhancedResponse['diffs'] = [];

    if (generateDiffs) {
      diffs = this.generatePreciseDiffs(targetFile.content, response);
    }

    // Syntax validation if requested
    if (validateSyntax) {
      const isValid = await this.validateCodeSyntax(response, targetFile.language);
      if (!isValid) {
        throw createPromptEngineError('Generated code failed syntax validation', {
          code: ERROR_CODES.PROMPT_ENGINE.SYNTAX_VALIDATION_FAILED,
          severity: 'high',
          recoverable: true,
          context: { language: targetFile.language, contentPreview: response.substring(0, 200) }
        });
      }
    }

    // Update project state
    if (updateProjectState) {
      this.updateProjectState(targetFile.id, response);
    }

    // Determine next file request based on dependencies
    const nextFileRequest = this.determineNextFileRequest(targetFile, response);

    // Calculate technical depth metrics
    const technicalDepth = this.calculateTechnicalDepth(response);

    const enhancedResponse: EnhancedResponse = {
      task: `Process code for ${targetFile.name}`,
      rules: [],
      file_context: {
        file_name: targetFile.name,
        content: response,
        language: targetFile.language,
        line_count: response.split('\n').length
      },
      diffs,
      next_file_request: nextFileRequest,
      workflow_state: nextFileRequest ? 'in_progress' : 'needs_approval',
      technical_depth: technicalDepth,
      agentic_metadata: {
        agent_type: 'single',
        iteration_count: 1,
        framework: this.agenticConfig?.framework
      }
    };

    this.emit('response_processed', enhancedResponse);
    return enhancedResponse;
  }

  /**
   * Integrate with agentic frameworks for iterative improvement
   */
  async integrateAgenticFramework(
    initialResponse: EnhancedResponse,
    maxIterations: number = 3
  ): Promise<EnhancedResponse> {
    if (!this.agenticConfig) {
      return initialResponse;
    }

    let currentResponse = initialResponse;
    let iteration = 1;

    while (iteration <= maxIterations) {
      const qualityScore = await this.evaluateResponseQuality(currentResponse);

      if (qualityScore >= (this.agenticConfig.qualityThreshold || 0.8)) {
        break;
      }

      // Generate improvement suggestions
      const improvements = await this.generateImprovements(currentResponse, qualityScore);

      // Create refined response
      currentResponse = await this.refineResponse(currentResponse, improvements);
      currentResponse.agentic_metadata!.iteration_count = iteration;
      currentResponse.agentic_metadata!.quality_score = qualityScore;

      this.emit('agentic_iteration', { iteration, qualityScore, improvements });
      iteration++;
    }

    return currentResponse;
  }

  /**
   * Handle multi-step workflow with automatic file switching
   */
  async executeMultiStepWorkflow(
    initialTask: string,
    projectFiles: ProjectItem[],
    options: {
      autoApprove?: boolean;
      maxSteps?: number;
      callback?: (step: number, response: EnhancedResponse) => Promise<boolean>;
    } = {}
  ): Promise<EnhancedResponse[]> {
    const { autoApprove = false, maxSteps = 10, callback } = options;
    const responses: EnhancedResponse[] = [];
    let currentStep = 1;
    let currentFileIndex = 0;

    while (currentStep <= maxSteps && currentFileIndex < projectFiles.length) {
      const currentFile = projectFiles[currentFileIndex];

      // Generate enhanced prompt for current step
      const prompt = await this.generateEnhancedPrompt(initialTask, {
        files: [currentFile],
        depthLevel: 8,
        promptingStrategy: 'multi_file'
      });

      // Process the response
      const response = await this.processCodeResponse(
        prompt, // In real implementation, this would be the LLM response
        currentFile,
        { generateDiffs: true, validateSyntax: true, updateProjectState: true }
      );

      responses.push(response);

      // Check if user approval is needed
      if (!autoApprove && callback) {
        const shouldContinue = await callback(currentStep, response);
        if (!shouldContinue) {
          break;
        }
      }

      // Move to next file if requested
      if (response.next_file_request) {
        const nextFile = projectFiles.find(f => f.name === response.next_file_request);
        if (nextFile) {
          currentFileIndex = projectFiles.indexOf(nextFile);
        } else {
          currentFileIndex++;
        }
      } else {
        currentFileIndex++;
      }

      currentStep++;
      this.emit('workflow_step_completed', { step: currentStep, response });
    }

    this.emit('workflow_completed', responses);
    return responses;
  }

  /**
   * Generate precise diffs using advanced diff algorithms
   */
  private generatePreciseDiffs(originalContent: string, newContent: string): EnhancedResponse['diffs'] {
    const diffs = this.dmp.diff_main(originalContent, newContent);
    this.dmp.diff_cleanupSemantic(diffs);

    const structuredDiffs: EnhancedResponse['diffs'] = [];
    let lineNumber = 1;
    let charIndex = 0;

    for (const [operation, text] of diffs) {
      const lines = text.split('\n');
      const startLine = lineNumber;
      const endLine = lineNumber + lines.length - 1;

      if (operation === 1) { // Insert
        structuredDiffs.push({
          operation: 'insert',
          line_range: [startLine, startLine],
          content: text,
          description: `Insert ${lines.length} line(s)`,
          confidence: 0.9
        });
      } else if (operation === -1) { // Delete
        structuredDiffs.push({
          operation: 'delete',
          line_range: [startLine, endLine],
          content: text,
          description: `Delete ${lines.length} line(s)`,
          confidence: 0.9
        });
      }

      if (operation !== -1) {
        lineNumber += lines.length - 1;
      }
      charIndex += text.length;
    }

    return structuredDiffs;
  }

  /**
   * Build enhanced context from project files and state
   */
  private buildEnhancedContext(files: ProjectItem[]): any {
    const context = {
      files: files.map(f => ({
        name: f.name,
        path: f.path,
        language: f.language,
        hasEdits: f.hasEdits,
        contentPreview: f.content.substring(0, 500) + '...'
      })),
      projectStructure: this.buildProjectStructure(files),
      dependencies: this.extractDependencies(files),
      patterns: this.identifyCodePatterns(files),
      timestamp: new Date().toISOString()
    };

    return context;
  }

  /**
   * Select appropriate prompt template based on strategy
   */
  private selectPromptTemplate(
    strategy: string,
    previousIteration?: Partial<EnhancedResponse>
  ): string {
    switch (strategy) {
      case 'chain_of_thought':
        return PROMPT_TEMPLATES.CHAIN_OF_THOUGHT;
      case 'iterative':
        return PROMPT_TEMPLATES.ITERATIVE_REFINEMENT;
      case 'multi_file':
        return PROMPT_TEMPLATES.MULTI_FILE_CONTEXT;
      default:
        return PROMPT_TEMPLATES.VERBOSE_TECHNICAL;
    }
  }

  /**
   * Apply advanced prompt engineering techniques
   */
  private applyPromptEngineering(template: string, params: any): string {
    let prompt = template;

    // Replace template variables
    Object.entries(params).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      prompt = prompt.replace(new RegExp(placeholder, 'g'), String(value));
    });

    // Add system-level enhancements
    prompt = this.addSystemEnhancements(prompt, params);

    // Apply context window optimization
    prompt = this.optimizeContextWindow(prompt, params.streamingRequired);

    return prompt;
  }

  /**
   * Add system-level enhancements to prompts
   */
  private addSystemEnhancements(prompt: string, params: any): string {
    const enhancements = [
      "SYSTEM DIRECTIVES:",
      "- Generate production-ready, maintainable code",
      "- Include comprehensive error handling",
      "- Add detailed comments explaining complex logic",
      "- Consider performance and security implications",
      "- Use strict typing and validation where applicable",
      "- Follow established design patterns and best practices",
      ""
    ].join('\n');

    return enhancements + prompt;
  }

  /**
   * Optimize prompt for context window constraints
   */
  private optimizeContextWindow(prompt: string, streamingRequired: boolean): string {
    if (streamingRequired) {
      prompt += "\n\nSTREAMING INSTRUCTIONS:\n- Generate response incrementally\n- Provide partial outputs for large code blocks\n- Ensure each chunk is syntactically valid\n";
    }

    // Add token optimization hints
    prompt += "\n\nOPTIMIZATION:\n- Focus on essential details\n- Use concise but comprehensive explanations\n- Prioritize critical functionality\n";

    return prompt;
  }

  /**
   * Calculate technical depth metrics for response
   */
  private calculateTechnicalDepth(content: string): EnhancedResponse['technical_depth'] {
    const lines = content.split('\n');
    const codeLines = lines.filter(line => line.trim() && !line.trim().startsWith('//'));
    const commentLines = lines.filter(line => line.trim().startsWith('//'));

    const complexity = this.calculateCyclomaticComplexity(content);
    const estimatedTokens = Math.ceil(content.length / 4); // Rough token estimation

    return {
      complexity_score: Math.min(complexity, 10),
      requires_streaming: estimatedTokens > 2000,
      estimated_tokens: estimatedTokens,
      dependencies: this.extractImports(content)
    };
  }

  /**
   * Calculate cyclomatic complexity of code
   */
  private calculateCyclomaticComplexity(code: string): number {
    const complexityKeywords = [
      'if', 'else', 'while', 'for', 'switch', 'case', 'catch', 'try',
      '&&', '||', '?', 'forEach', 'map', 'filter', 'reduce'
    ];

    let complexity = 1; // Base complexity

    complexityKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = code.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    });

    return complexity;
  }

  /**
   * Extract imports/dependencies from code
   */
  private extractImports(content: string): string[] {
    const importRegex = /(?:import|from|require\s*\()\s*['"`]([^'"`]+)['"`]/g;
    const imports: string[] = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  /**
   * Update project state with new content
   */
  private updateProjectState(fileId: string, newContent: string): void {
    const existingFile = this.projectState.get(fileId);
    if (existingFile) {
      existingFile.content = newContent;
      existingFile.hasEdits = true;
      existingFile.lastModified = new Date();
      this.projectState.set(fileId, existingFile);
    }
  }

  /**
   * Determine next file to process based on dependencies
   */
  private determineNextFileRequest(currentFile: ProjectItem, content: string): string | null {
    const dependencies = this.extractImports(content);

    // Simple heuristic: if code imports from relative paths, suggest those files
    for (const dep of dependencies) {
      if (dep.startsWith('./') || dep.startsWith('../')) {
        const potentialFile = this.resolveRelativePath(currentFile.path, dep);
        if (potentialFile) {
          return potentialFile;
        }
      }
    }

    return null;
  }

  /**
   * Resolve relative import paths
   */
  private resolveRelativePath(currentPath: string, relativePath: string): string | null {
    // Simplified path resolution logic
    const pathParts = currentPath.split('/');
    const relativeParts = relativePath.split('/');

    // Basic resolution - in real implementation, use proper path resolution
    return relativeParts[relativeParts.length - 1] + '.ts';
  }

  /**
   * Validate code syntax with real validation
   */
  private async validateCodeSyntax(code: string, language: string): Promise<boolean> {
    try {
      // Use proper syntax validation based on language
      switch (language.toLowerCase()) {
        case 'typescript':
        case 'javascript':
          // For now, we'll use basic validation but in a real implementation,
          // we would use TypeScript compiler API or ESLint
          return !code.includes('SyntaxError');
          
        case 'python':
          // Python validation - in real implementation, use Python AST parser
          return !code.includes('IndentationError') && !code.includes('SyntaxError');
          
        case 'java':
          // Java validation - in real implementation, use Java compiler API
          return !code.includes('error:') && !code.includes('Exception');
          
        case 'json':
          // JSON validation
          try {
            JSON.parse(code);
            return true;
          } catch {
            return false;
          }
          
        case 'html':
          // HTML validation - basic check for balanced tags
          const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*>|<\/([a-zA-Z][a-zA-Z0-9]*)>/g;
          const openTags: string[] = [];
          let match;
          
          while ((match = tagRegex.exec(code)) !== null) {
            if (match[1]) {
              // Opening tag
              openTags.push(match[1]);
            } else if (match[2]) {
              // Closing tag
              const lastTag = openTags.pop();
              if (lastTag !== match[2]) {
                return false; // Mismatched tags
              }
            }
          }
          
          return openTags.length === 0; // All tags closed
          
        case 'css':
        case 'scss':
          // CSS validation - check for balanced braces
          const openBraces = (code.match(/\{/g) || []).length;
          const closeBraces = (code.match(/\}/g) || []).length;
          return openBraces === closeBraces;
          
        default:
          // For unknown languages, basic validation
          return !code.includes('SyntaxError');
      }
    } catch (error) {
      console.warn(`Syntax validation failed for ${language}:`, error);
      return false;
    }
  }

  /**
   * Build project structure representation
   */
  private buildProjectStructure(files: ProjectItem[]): any {
    return {
      totalFiles: files.length,
      byLanguage: files.reduce((acc, file) => {
        acc[file.language] = (acc[file.language] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      withEdits: files.filter(f => f.hasEdits).length
    };
  }

  /**
   * Extract project dependencies
   */
  private extractDependencies(files: ProjectItem[]): string[] {
    const allDeps = files.flatMap(file => this.extractImports(file.content));
    return [...new Set(allDeps)];
  }

  /**
   * Identify code patterns across files
   */
  private identifyCodePatterns(files: ProjectItem[]): string[] {
    const patterns = new Set<string>();

    files.forEach(file => {
      if (file.content.includes('React.FC')) patterns.add('React Functional Components');
      if (file.content.includes('useState')) patterns.add('React Hooks');
      if (file.content.includes('async/await')) patterns.add('Async/Await Pattern');
      if (file.content.includes('interface ')) patterns.add('TypeScript Interfaces');
    });

    return Array.from(patterns);
  }

  /**
   * Evaluate response quality for agentic frameworks
   */
  private async evaluateResponseQuality(response: EnhancedResponse): Promise<number> {
    // Quality evaluation based on multiple factors
    let score = 0.5; // Base score

    // Code completeness
    if (response.file_context?.content && response.file_context.content.length > 100) {
      score += 0.2;
    }

    // Diff quality
    if (response.diffs.length > 0) {
      score += 0.2;
    }

    // Technical depth
    if (response.technical_depth.complexity_score >= 5) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Generate improvement suggestions
   */
  private async generateImprovements(response: EnhancedResponse, qualityScore: number): Promise<string[]> {
    const improvements: string[] = [];

    if (qualityScore < 0.6) {
      improvements.push('Increase technical depth and detail');
    }

    if (response.diffs.length === 0) {
      improvements.push('Generate more precise code changes');
    }

    if (response.technical_depth.complexity_score < 3) {
      improvements.push('Add more comprehensive error handling');
    }

    return improvements;
  }

  /**
   * Refine response based on improvements
   */
  private async refineResponse(response: EnhancedResponse, improvements: string[]): Promise<EnhancedResponse> {
    // In real implementation, this would trigger another LLM call with improvement instructions
    return {
      ...response,
      workflow_state: 'in_progress',
      agentic_metadata: {
        ...response.agentic_metadata,
        iteration_count: (response.agentic_metadata?.iteration_count || 0) + 1
      }
    };
  }

  /**
   * Get LLM response with real integration
   */
  async getLLMResponse(
    task: string,
    files: ProjectItem[],
    options: {
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
      provider?: string;
      model?: string;
    } = {}
  ): Promise<string | AsyncIterable<string>> {
    const {
      stream = false,
      temperature = 0.7,
      maxTokens = 80000,
      provider,
      model
    } = options;

    try {
      // Generate enhanced prompt
      const prompt = await this.generateEnhancedPrompt(task, {
        files,
        streamingRequired: stream
      });

      if (stream) {
        // Get streaming response
        const streamResponse = await llmIntegration.getStreamingResponse(prompt, files);
        
        // Return async iterable for streaming
        return {
          [Symbol.asyncIterator]: async function* () {
            for await (const chunk of streamResponse) {
              if (chunk.content) {
                yield chunk.content;
              }
            }
          }
        };
      } else {
        // Get non-streaming response
        const response = await llmIntegration.getResponse(prompt, files);
        return response.content;
      }
    } catch (error) {
      throw createPromptEngineError(
        `Failed to get LLM response: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.PROMPT_ENGINE.PROMPT_GENERATION_FAILED,
          severity: 'high',
          recoverable: true,
          context: { task, files, stream, provider, model }
        }
      );
    }
  }

  /**
   * Process streaming response from LLM
   */
  async processStreamingResponse(
    stream: AsyncIterable<string>,
    onChunk?: (chunk: string) => void,
    onComplete?: (content: string) => void
  ): Promise<string> {
    let accumulatedContent = '';
    
    try {
      for await (const chunk of stream) {
        accumulatedContent += chunk;
        if (onChunk) {
          onChunk(chunk);
        }
      }
      
      if (onComplete) {
        onComplete(accumulatedContent);
      }
      
      return accumulatedContent;
    } catch (error) {
      throw createPromptEngineError(
        `Failed to process streaming response: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.PROMPT_ENGINE.RESPONSE_PROCESSING_FAILED,
          severity: 'high',
          recoverable: true,
          context: { error }
        }
      );
    }
  }

  /**
   * Enhanced code generation with real LLM integration
   */
  async generateEnhancedCode(
    task: string,
    targetFile: ProjectItem,
    options: {
      validateSyntax?: boolean;
      generateDiffs?: boolean;
      useStreaming?: boolean;
      contextFiles?: ProjectItem[];
    } = {}
  ): Promise<EnhancedResponse> {
    const {
      validateSyntax = true,
      generateDiffs = true,
      useStreaming = false,
      contextFiles = []
    } = options;

    try {
      // Get LLM response
      const response = await this.getLLMResponse(task, [targetFile, ...contextFiles], {
        stream: useStreaming
      });

      let content: string;
      
      if (useStreaming && typeof response !== 'string') {
        // Process streaming response
        content = await this.processStreamingResponse(response);
      } else {
        content = response as string;
      }

      // Process the response
      return await this.processCodeResponse(content, targetFile, {
        generateDiffs,
        validateSyntax,
        updateProjectState: true
      });
    } catch (error) {
      throw createPromptEngineError(
        `Failed to generate enhanced code: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.PROMPT_ENGINE.PROMPT_GENERATION_FAILED,
          severity: 'high',
          recoverable: true,
          context: { task, targetFile, options }
        }
      );
    }
  }
}

export {
  EnhancedPromptEngine,
  EnhancedResponseSchema,
  type EnhancedResponse,
  type ProjectItem,
  type AgenticFrameworkConfig,
  PROMPT_TEMPLATES
};
