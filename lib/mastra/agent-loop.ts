/**
 * Agent Loop for Multi-Step Filesystem Operations
 * 
 * Implements an iterative agent that can read, edit, and save files
 * with context awareness and tool-based LLM interaction.
 * 
 * @see lib/mastra/tools/filesystem-tools.ts
 */

import { createFilesystemTools, type FilesystemTool } from './tools/filesystem-tools';

export interface AgentContext {
  userId: string;
  workspacePath: string;
  conversationHistory: AgentMessage[];
  currentFile?: string;
  lastAction?: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AgentResult {
  success: boolean;
  results: AgentIterationResult[];
  iterations: number;
  message?: string;
  error?: string;
}

export interface AgentIterationResult {
  iteration: number;
  tool?: string;
  arguments?: Record<string, any>;
  result: any;
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, any>;
  }>;
  done?: boolean;
  message?: string;
}

/**
 * Agent Loop for executing multi-step filesystem tasks
 */
export class AgentLoop {
  private context: AgentContext;
  private maxIterations: number;
  private tools: FilesystemTool[];

  constructor(userId: string, workspacePath: string, maxIterations: number = 10) {
    this.context = {
      userId,
      workspacePath,
      conversationHistory: [],
    };
    this.maxIterations = maxIterations;
    this.tools = createFilesystemTools(userId);
  }

  /**
   * Execute a task using iterative agent loop
   */
  async executeTask(task: string): Promise<AgentResult> {
    const results: AgentIterationResult[] = [];
    let iterations = 0;

    // Add user task (system prompt is added in callLLM)
    this.context.conversationHistory.push({
      role: 'user',
      content: task,
    });

    while (iterations < this.maxIterations) {
      iterations++;

      try {
        // Call LLM with current context and available tools
        const llmResponse = await this.callLLM(task, results);

        if (llmResponse.done) {
          // LLM indicates task is complete
          return {
            success: true,
            results,
            iterations,
            message: llmResponse.message || 'Task completed successfully',
          };
        }

        // Execute tool calls
        if (llmResponse.toolCalls) {
          for (const toolCall of llmResponse.toolCalls) {
            const tool = this.tools.find(t => t.name === toolCall.name);
            if (tool) {
              const result = await tool.execute(toolCall.arguments);
              results.push({
                iteration: iterations,
                tool: toolCall.name,
                arguments: toolCall.arguments,
                result,
              });

              // Update context based on result
              this.updateContext(toolCall, result);

              // Add tool response to conversation
              this.context.conversationHistory.push({
                role: 'tool',
                content: JSON.stringify(result),
                toolCallId: toolCall.id,
                toolName: toolCall.name,
              });
            } else {
              results.push({
                iteration: iterations,
                tool: toolCall.name,
                arguments: toolCall.arguments,
                result: {
                  success: false,
                  error: `Unknown tool: ${toolCall.name}`,
                },
              });
            }
          }
        } else if (llmResponse.content) {
          // LLM returned text response
          this.context.conversationHistory.push({
            role: 'assistant',
            content: llmResponse.content,
          });
        }
      } catch (error: any) {
        return {
          success: false,
          results,
          iterations,
          error: error.message || 'Agent loop error',
        };
      }
    }

    return {
      success: false,
      results,
      iterations,
      error: 'Max iterations reached',
    };
  }

  /**
   * Call LLM with current context
   */
  private async callLLM(task: string, previousResults: AgentIterationResult[]): Promise<LLMResponse> {
    // Build prompt with context
    const systemPrompt = this.buildSystemPrompt();

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.context.conversationHistory,
    ];

    // For now, return a mock response
    // In production, this would call your LLM provider (Mistral, OpenAI, etc.)
    // Example implementation:
    /*
    const response = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        tools: this.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        toolChoice: 'auto',
      }),
    });

    return response.json();
    */

    // Mock response for demonstration
    return {
      content: 'Task processing...',
      done: false,
    };
  }

  /**
   * Update context based on tool execution
   */
  private updateContext(toolCall: { name: string; arguments: Record<string, any> }, result: any): void {
    // Track current file for context
    if (toolCall.name === 'read_file' || toolCall.name === 'write_file') {
      this.context.currentFile = toolCall.arguments.path;
    }

    // Track last action
    this.context.lastAction = `${toolCall.name}(${JSON.stringify(toolCall.arguments)})`;
  }

  /**
   * Build system prompt for agent
   */
  private buildSystemPrompt(): string {
    return `You are an AI assistant working in a code workspace.
You have access to filesystem tools to read, write, and edit files.

Current workspace: ${this.context.workspacePath}

Available Tools:
${this.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

TOOL CALLING FORMAT:
When you need to create or modify files, use this exact format:

WRITE path/to/file.ext <<<
file content here
>>>

To read a file:
READ path/to/file.ext

Examples:
WRITE package.json <<<
{
  "name": "my-app",
  "version": "1.0.0"
}
>>>

WRITE src/index.js <<<
console.log('Hello World');
>>>

READ package.json

Best Practices:
1. Always check if a file exists before editing (use READ or list_directory)
2. Use relative paths from workspace root (e.g., "toDoApp/src/app.js")
3. After creating files, suggest running commands
4. Use the WRITE/READ format above to directly manipulate files

Response Format:
- Use WRITE/READ format to create/read files
- When task is complete, respond with { "done": true, "message": "..." }
- Provide clear explanations of what you're doing

Example:
User: "Create a todo app"
Assistant: 
WRITE package.json <<<
{
  "name": "todo-app",
  "version": "1.0.0"
}
>>>
WRITE src/index.js <<<
// Todo app code
>>>
Assistant: { "done": true, "message": "Created a todo app with package.json and src/index.js" }`;
  }

  /**
   * Get current context
   */
  getContext(): AgentContext {
    return { ...this.context };
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.context.conversationHistory = [];
  }
}

/**
 * Create a new agent loop instance
 */
export function createAgentLoop(userId: string, workspacePath: string, maxIterations?: number): AgentLoop {
  return new AgentLoop(userId, workspacePath, maxIterations);
}
