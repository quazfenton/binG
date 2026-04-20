/**
 * Amp Agent Service (OpenAI Codex Successor)
 * 
 * Containerized OpenAI Amp implementation for advanced coding tasks.
 * Provides:
 * - Code generation and completion
 * - Code review and refactoring
 * - Test generation
 * - Documentation writing
 * 
 * @see https://platform.openai.com/docs/amp
 */

import { OpenAIAgentBase, type OpenAIAgentDescriptor, type OpenAIAgentConfig, type OpenAIAgentMessage, type OpenAIAgentTool } from './openai-agent-base';
import { findAmpBinarySync } from '@/lib/agent-bins/find-amp-binary';

// ============================================================================
// Types
// ============================================================================

export interface AmpConfig extends OpenAIAgentConfig {
  /** Model to use (default: amp-coder-1) */
  model?: string;
}

export interface AmpMessage extends OpenAIAgentMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string | Array<{
    type: 'text' | 'image_url' | 'input_audio' | 'output_audio';
    text?: string;
    image_url?: { url: string; detail?: string };
    input_audio?: { data: string; format: 'wav' | 'mp3' };
    output_audio?: { format: 'pcm16' };
  }>;
}

export interface AmpTool extends OpenAIAgentTool {}

// Built-in Amp tools
export const AMP_TOOLS: Record<string, AmpTool> = {
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
// Amp Agent Service
// ============================================================================

const AMP_DESCRIPTOR: OpenAIAgentDescriptor = {
  agentType: 'amp',
  loggerLabel: 'Agents:Amp',
  defaultModel: 'amp-coder-1',
  defaultPort: 3000,
  spawnArgs: (port: number) => ['serve', '--port', String(port)],
  findBinary: findAmpBinarySync,
  tools: AMP_TOOLS,
  promptRole: 'developer',
  envPrefix: 'OPENAI',
};

export class AmpAgent extends OpenAIAgentBase<AmpConfig, AmpMessage, AmpTool> {
  constructor(config: AmpConfig) {
    super(AMP_DESCRIPTOR, config);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createAmpAgent(config: AmpConfig): Promise<AmpAgent> {
  const agent = new AmpAgent(config);
  await agent.start();
  return agent;
}

export default AmpAgent;
