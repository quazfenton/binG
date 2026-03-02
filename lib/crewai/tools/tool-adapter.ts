/**
 * CrewAI Tool Adapter
 *
 * Adapts existing sandbox tools for CrewAI agents.
 * Reuses all existing tool implementations.
 * Includes delegation tools for inter-agent collaboration.
 */

import { createToolExecutor, type ToolExecutor, type ToolExecutorConfig } from '@/lib/stateful-agent/tools/tool-executor';
import { RoleAgent } from '../agents/role-agent';

export interface CrewAIToolDefinition {
  name: string;
  description: string;
  execute: (params: Record<string, any>) => Promise<unknown>;
  schema?: Record<string, any>;
}

export interface CrewAIToolAdapter {
  executor: ToolExecutor;
  tools: Record<string, CrewAIToolDefinition>;
  runTool: (toolName: string, params: Record<string, any>) => Promise<unknown>;
  delegationTools?: Record<string, CrewAIToolDefinition>;
}

export interface DelegationContext {
  agents: Map<string, RoleAgent>;
  taskDescription: string;
  inputs?: Record<string, any>;
}

let globalDelegationContext: DelegationContext | null = null;

export function setDelegationContext(context: DelegationContext): void {
  globalDelegationContext = context;
}

export function clearDelegationContext(): void {
  globalDelegationContext = null;
}

function createDelegationTools(contextGetter: () => DelegationContext | null): Record<string, CrewAIToolDefinition> {
  return {
    delegate_work: {
      name: 'delegate_work',
      description: 'Delegate a specific task to another agent with the appropriate expertise. Use this when another agent would be better suited to handle the current request.',
      schema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The specific task to delegate to the coworker',
          },
          context: {
            type: 'string',
            description: 'Additional context for the delegated task',
          },
          coworker: {
            type: 'string',
            description: 'The role or name of the agent to delegate to (e.g., "Researcher", "Coder", "Critic")',
          },
        },
        required: ['task', 'coworker'],
      },
      execute: async (params: Record<string, any>) => {
        const context = contextGetter();
        if (!context) {
          throw new Error('Delegation context not set. Call setDelegationContext() first.');
        }

        const { task, context: delegationContext, coworker } = params;
        const targetAgent = context.agents.get(coworker.toLowerCase());
        
        if (!targetAgent) {
          const availableAgents = Array.from(context.agents.keys()).join(', ');
          throw new Error(`Agent "${coworker}" not found. Available agents: ${availableAgents}`);
        }

        const fullTask = `${task}\n\nContext: ${delegationContext || context.taskDescription}`;
        const result = await targetAgent.kickoff(fullTask);

        return {
          delegated_to: coworker,
          task: task,
          result: result.raw,
          success: result.success,
        };
      },
    },
    ask_question: {
      name: 'ask_question',
      description: 'Ask a specific question to another agent to gather information or get their expertise on a matter.',
      schema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the coworker',
          },
          context: {
            type: 'string',
            description: 'Additional context for the question',
          },
          coworker: {
            type: 'string',
            description: 'The role or name of the agent to ask',
          },
        },
        required: ['question', 'coworker'],
      },
      execute: async (params: Record<string, any>) => {
        const context = contextGetter();
        if (!context) {
          throw new Error('Delegation context not set. Call setDelegationContext() first.');
        }

        const { question, context: questionContext, coworker } = params;
        const targetAgent = context.agents.get(coworker.toLowerCase());
        
        if (!targetAgent) {
          const availableAgents = Array.from(context.agents.keys()).join(', ');
          throw new Error(`Agent "${coworker}" not found. Available agents: ${availableAgents}`);
        }

        const fullQuestion = `${question}\n\nContext: ${questionContext || context.taskDescription}`;
        const result = await targetAgent.kickoff(fullQuestion);

        return {
          asked_to: coworker,
          question: question,
          answer: result.raw,
        };
      },
    },
  };
}

/**
 * Adapt existing ToolExecutor-backed tools for CrewAI-style agents.
 * This keeps a single execution pathway and shared logging/metrics.
 */
export function createCrewAITools(config: ToolExecutorConfig = {}): CrewAIToolAdapter {
  const executor = createToolExecutor(config);

  const toolDefs: Record<string, CrewAIToolDefinition> = {
    readFile: {
      name: 'readFile',
      description: 'Read file contents from sandbox or VFS.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read' },
        },
        required: ['path'],
      },
      execute: async (params) => executor.execute('readFile', params),
    },
    listFiles: {
      name: 'listFiles',
      description: 'List files from sandbox or VFS.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' },
        },
      },
      execute: async (params) => executor.execute('listFiles', params),
    },
    createFile: {
      name: 'createFile',
      description: 'Create a new file in sandbox or VFS.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path where to create the file' },
          content: { type: 'string', description: 'Content to write to the file' },
        },
        required: ['path', 'content'],
      },
      execute: async (params) => executor.execute('createFile', params),
    },
    applyDiff: {
      name: 'applyDiff',
      description: 'Apply surgical diff to file content.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          diff: { type: 'string', description: 'Unified diff to apply' },
        },
        required: ['path', 'diff'],
      },
      execute: async (params) => executor.execute('applyDiff', params),
    },
    execShell: {
      name: 'execShell',
      description: 'Execute a shell command in sandbox.',
      schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' },
        },
        required: ['command'],
      },
      execute: async (params) => executor.execute('execShell', params),
    },
    syntaxCheck: {
      name: 'syntaxCheck',
      description: 'Run syntax checks for changed files.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to check' },
          language: { type: 'string', description: 'Programming language' },
        },
        required: ['path'],
      },
      execute: async (params) => executor.execute('syntaxCheck', params),
    },
  };

  const delegationTools = createDelegationTools(() => globalDelegationContext);

  return {
    executor,
    tools: toolDefs,
    delegationTools,
    runTool: async (toolName, params) => {
      const target = toolDefs[toolName] || delegationTools[toolName];
      if (!target) {
        throw new Error(`Unknown CrewAI tool: ${toolName}`);
      }
      return target.execute(params);
    },
  };
}

/**
 * Create agent from YAML with optional tool name hints.
 */
export async function createAgentWithTools(
  sessionId: string,
  agentName: string,
  yamlPath: string,
  _toolNames: string[] = ['readFile', 'listFiles', 'createFile', 'applyDiff', 'execShell', 'syntaxCheck'],
): Promise<RoleAgent> {
  const agent = await RoleAgent.loadFromYAML(yamlPath, agentName, sessionId);
  return agent;
}
