/**
 * Mistral Prompt Builder
 *
 * Constructs optimized prompts for Mistral AI code execution and conversations.
 * Supports multiple prompt templates and context injection.
 */

import type { CodeExecutionRequest, CodeLanguage } from '../mistral-types';

export interface PromptTemplate {
  name: string;
  template: string;
  variables: string[];
}

export interface PromptContext {
  code?: string;
  language?: string;
  cwd?: string;
  env?: Record<string, string>;
  instructions?: string;
  examples?: string[];
  constraints?: string[];
}

export class PromptBuilder {
  private templates: Map<string, PromptTemplate> = new Map<string, PromptTemplate>();

  constructor() {
    this.initializeDefaultTemplates();
  }

  /**
   * Initialize default prompt templates
   */
  private initializeDefaultTemplates(): void {
    // Code execution template
    this.registerTemplate({
      name: 'code-execution',
      template: `Execute the following {language} code:

\`\`\`{language}
{code}
\`\`\`

Working directory: {cwd}
{env}
Return ONLY the code output, no explanations.`,
      variables: ['language', 'code', 'cwd', 'env'],
    });

    // Command execution template
    this.registerTemplate({
      name: 'command-execution',
      template: `Execute the following shell command:

\`\`\`bash
{command}
\`\`\`

Working directory: {cwd}
Return ONLY the command output, no explanations.`,
      variables: ['command', 'cwd'],
    });

    // Code validation template
    this.registerTemplate({
      name: 'code-validation',
      template: `Validate the following {language} code for safety and correctness:

\`\`\`{language}
{code}
\`\`\`

Check for:
{constraints}

Return a JSON object with:
- valid: boolean
- errors: string[]
- warnings: string[]`,
      variables: ['language', 'code', 'constraints'],
    });

    // Error correction template
    this.registerTemplate({
      name: 'error-correction',
      template: `Your previous code execution failed:

Error: {error}

Original code:
\`\`\`{language}
{code}
\`\`\`

Please fix the code and try again. Return ONLY the corrected code.`,
      variables: ['error', 'code', 'language'],
    });

    // Context injection template
    this.registerTemplate({
      name: 'context-injection',
      template: `You are a code execution assistant with the following context:

Context:
{context}

User request: {request}

Use the context to inform your response.`,
      variables: ['context', 'request'],
    });
  }

  /**
   * Register a custom prompt template
   */
  registerTemplate(template: PromptTemplate): void {
    this.templates.set(template.name, template);
  }

  /**
   * Build a prompt from a template
   */
  buildPrompt(templateName: string, variables: Record<string, string>): string {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template "${templateName}" not found`);
    }

    let prompt = template.template;
    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), value);
    }

    return prompt;
  }

  /**
   * Build code execution prompt
   */
  buildCodeExecutionPrompt(request: CodeExecutionRequest): string {
    const envStr = request.env
      ? `Environment variables: ${JSON.stringify(request.env)}`
      : '';

    return this.buildPrompt('code-execution', {
      language: request.language,
      code: request.code,
      cwd: request.cwd || '/workspace',
      env: envStr,
    });
  }

  /**
   * Build command execution prompt
   */
  buildCommandPrompt(command: string, cwd?: string): string {
    return this.buildPrompt('command-execution', {
      command,
      cwd: cwd || '/workspace',
    });
  }

  /**
   * Build code validation prompt
   */
  buildValidationPrompt(code: string, language: string, constraints?: string[]): string {
    const defaultConstraints = [
      '- Dangerous system calls',
      '- Network access',
      '- File system access outside workspace',
      '- Infinite loops',
      '- Memory exhaustion',
    ];

    return this.buildPrompt('code-validation', {
      language,
      code,
      constraints: (constraints || defaultConstraints).join('\n'),
    });
  }

  /**
   * Build error correction prompt
   */
  buildCorrectionPrompt(code: string, language: string, error: string): string {
    return this.buildPrompt('error-correction', {
      code,
      language,
      error,
    });
  }

  /**
   * Build context injection prompt
   */
  buildContextPrompt(context: string, request: string): string {
    return this.buildPrompt('context-injection', {
      context,
      request,
    });
  }

  /**
   * Build prompt with examples (few-shot learning)
   */
  buildPromptWithExamples(
    basePrompt: string,
    examples: Array<{ input: string; output: string }>
  ): string {
    const examplesStr = examples
      .map(
        (ex, i) => `
Example ${i + 1}:
Input: ${ex.input}
Output: ${ex.output}
`
      )
      .join('\n');

    return `${examplesStr}\nNow solve this:\n${basePrompt}`;
  }

  /**
   * Build prompt with constraints
   */
  buildPromptWithConstraints(
    basePrompt: string,
    constraints: string[]
  ): string {
    const constraintsStr = constraints
      .map((c, i) => `${i + 1}. ${c}`)
      .join('\n');

    return `${basePrompt}\n\nConstraints:\n${constraintsStr}`;
  }

  /**
   * Optimize prompt for token efficiency
   */
  optimizeForTokens(prompt: string, maxTokens?: number): string {
    if (!maxTokens) return prompt;

    // Rough estimate: 1 token ≈ 4 characters
    const estimatedTokens = prompt.length / 4;

    if (estimatedTokens <= maxTokens) {
      return prompt;
    }

    // Remove whitespace and comments
    let optimized = prompt
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .replace(/\/\/.*$/gm, '') // Remove single-line comments
      .replace(/\n\s*\n/g, '\n'); // Remove empty lines

    // If still too long, truncate
    if (optimized.length / 4 > maxTokens) {
      const targetLength = maxTokens * 4;
      optimized = optimized.substring(0, targetLength - 100) + '\n\n[truncated]';
    }

    return optimized;
  }

  /**
   * Build system prompt for code execution agent
   */
  buildSystemPrompt(options?: {
    role?: string;
    tone?: string;
    constraints?: string[];
  }): string {
    const role = options?.role || 'code execution assistant';
    const tone = options?.tone || 'professional and concise';

    const defaultConstraints = [
      'Always use the code_interpreter tool for code execution',
      'Return results in JSON format when possible',
      'Include error messages if execution fails',
      'Do not execute dangerous operations',
    ];

    const constraints = options?.constraints || defaultConstraints;

    return `You are a ${role}. Your tone is ${tone}.

Guidelines:
${constraints.map((c) => `- ${c}`).join('\n')}

Always prioritize safety and correctness.`;
  }
}

export const promptBuilder = new PromptBuilder();
