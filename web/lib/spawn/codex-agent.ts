/**
 * Codex Agent Service (OpenAI Codex CLI)
 *
 * Containerized OpenAI Codex implementation for coding tasks.
 * Provides:
 * - Code generation and completion
 * - Code review and refactoring
 * - Test generation
 * - Documentation writing
 *
 * @see https://github.com/openai/codex
 */

import { OpenAIAgentBase, type OpenAIAgentDescriptor, type OpenAIAgentConfig, type OpenAIAgentMessage, type OpenAIAgentTool } from './openai-agent-base';
import { findCodexBinarySync } from '@/lib/agent-bins/find-codex-binary';

// ============================================================================
// Types
// ============================================================================

export interface CodexConfig extends OpenAIAgentConfig {
  /** Model to use (default: codex-1) */
  model?: string;
}

export interface CodexMessage extends OpenAIAgentMessage {
  role: 'system' | 'user' | 'assistant';
}

export interface CodexTool extends OpenAIAgentTool {}

// Built-in Codex tools
export const CODEX_TOOLS: Record<string, CodexTool> = {
  'read_file': {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
  },
  'write_file': {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  'edit_file': {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Apply edits to a file using unified diff format',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          diff: { type: 'string', description: 'Unified diff to apply' },
        },
        required: ['path', 'diff'],
      },
    },
  },
  'run_command': {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['command'],
      },
    },
  },
  'search_code': {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search codebase for patterns',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex supported)' },
          path: { type: 'string', description: 'Directory to search in' },
        },
        required: ['pattern'],
      },
    },
  },
};

// ============================================================================
// Codex Agent Service
// ============================================================================

const CODEX_DESCRIPTOR: OpenAIAgentDescriptor = {
  agentType: 'codex',
  loggerLabel: 'Agents:Codex',
  defaultModel: 'codex-1',
  defaultPort: 5000,
  spawnArgs: (port: number) => ['serve', '--port', String(port)],
  findBinary: findCodexBinarySync,
  tools: CODEX_TOOLS,
  promptRole: 'user',
  envPrefix: 'OPENAI',
};

export class CodexAgent extends OpenAIAgentBase<CodexConfig, CodexMessage, CodexTool> {
  constructor(config: CodexConfig) {
    super(CODEX_DESCRIPTOR, config);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createCodexAgent(config: CodexConfig): Promise<CodexAgent> {
  const agent = new CodexAgent(config);
  await agent.start();
  return agent;
}

export default CodexAgent;
