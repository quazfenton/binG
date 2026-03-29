/**
 * WebMCP Native Support
 *
 * Chrome 146+ native WebMCP protocol for AI agent interactions.
 * Provides browser-native MCP discovery and tool invocation.
 *
 * @see https://developer.chrome.com/docs/capabilities/webmcp
 * @module webmcp
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('WebMCP');

/**
 * WebMCP Manifest
 *
 * This manifest is discovered by Chrome 146+ browsers
 * at the well-known location: /.well-known/webmcp
 */
export interface WebMCPManifest {
  /** WebMCP protocol version */
  version: string;
  /** Server name */
  name: string;
  /** Server description */
  description: string;
  /** Supported tools */
  tools: WebMCPTool[];
  /** Authentication requirements */
  auth?: {
    type: 'bearer' | 'api-key' | 'none';
    description?: string;
  };
  /** Capabilities */
  capabilities: {
    sandbox?: boolean;
    voice?: boolean;
    llm?: boolean;
    integrations?: boolean;
  };
  /** Endpoints */
  endpoints: {
    tools: string;
    invoke: string;
    status?: string;
  };
}

/**
 * WebMCP Tool Definition
 */
export interface WebMCPTool {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Input schema (JSON Schema format) */
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * WebMCP Manifest for binG
 */
const WEBMCP_MANIFEST: WebMCPManifest = {
  version: '1.0.0',
  name: 'binG',
  description: 'Agentic compute workspace with sandbox execution, voice control, and multi-agent orchestration',
  tools: [
    {
      name: 'execute_command',
      description: 'Execute shell commands in isolated sandbox',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Bash command to execute',
          },
          workingDir: {
            type: 'string',
            description: 'Working directory (default: /workspace)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000)',
          },
        },
        required: ['command'],
      },
    },
    {
      name: 'write_file',
      description: 'Write files to sandbox workspace',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path',
          },
          content: {
            type: 'string',
            description: 'File content',
          },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'read_file',
      description: 'Read files from sandbox workspace',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_directory',
      description: 'List directory contents',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'create_agent',
      description: 'Create and spawn AI agent for task execution',
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Task description',
          },
          model: {
            type: 'string',
            description: 'LLM model to use',
          },
          executionPolicy: {
            type: 'string',
            description: 'Execution policy (local-safe, sandbox-required, etc.)',
          },
        },
        required: ['task'],
      },
    },
    {
      name: 'get_agent_status',
      description: 'Get status of running agent',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Agent ID',
          },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'stop_agent',
      description: 'Stop running agent',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Agent ID',
          },
        },
        required: ['agentId'],
      },
    },
  ],
  auth: {
    type: 'bearer',
    description: 'Authentication via Auth0 bearer token',
  },
  capabilities: {
    sandbox: true,
    voice: true,
    llm: true,
    integrations: true,
  },
  endpoints: {
    tools: '/api/webmcp/tools',
    invoke: '/api/webmcp/invoke',
    status: '/api/webmcp/status',
  },
};

/**
 * GET /.well-known/webmcp
 *
 * WebMCP manifest discovery endpoint
 */
export async function GET() {
  logger.info('WebMCP manifest requested');

  return NextResponse.json(WEBMCP_MANIFEST, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * POST /.well-known/webmcp
 *
 * Handle WebMCP tool invocation requests
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tool, arguments: args } = body;

    logger.info('WebMCP tool invocation', { tool, args });

    // Validate tool name
    if (!tool || typeof tool !== 'string') {
      return NextResponse.json({
        error: 'Tool name required',
      }, { status: 400 });
    }

    // Route to appropriate handler
    const result = await invokeTool(tool, args);

    return NextResponse.json({
      success: true,
      tool,
      result,
    });
  } catch (error: any) {
    logger.error('WebMCP invocation error', { error: error.message });
    return NextResponse.json({
      error: error.message || 'Tool invocation failed',
    }, { status: 500 });
  }
}

/**
 * Invoke tool by name
 */
async function invokeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'execute_command': {
      const { exec } = await import('child_process');
      return new Promise((resolve, reject) => {
        exec(args.command, {
          cwd: args.workingDir || '/workspace',
          timeout: args.timeout || 30000,
        }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });
    }

    case 'write_file': {
      const { writeFile } = await import('fs/promises');
      await writeFile(args.path, args.content);
      return { success: true, path: args.path };
    }

    case 'read_file': {
      const { readFile } = await import('fs/promises');
      const content = await readFile(args.path, 'utf-8');
      return { content };
    }

    case 'list_directory': {
      const { readdir } = await import('fs/promises');
      const files = await readdir(args.path);
      return { files };
    }

    case 'create_agent': {
      // Import from existing agent system
      const { spawnAgent } = await import('@/lib/spawn');
      const agent = await spawnAgent({
        task: args.task,
        model: args.model,
        executionPolicy: args.executionPolicy,
      });
      return { agentId: agent.id, status: 'started' };
    }

    case 'get_agent_status': {
      const { getAgentServiceManager } = await import('@/lib/spawn');
      const manager = getAgentServiceManager();
      const agent = manager.getAgent(args.agentId);
      if (!agent) {
        throw new Error('Agent not found');
      }
      return { status: agent.status, progress: agent.progress };
    }

    case 'stop_agent': {
      const { getAgentServiceManager } = await import('@/lib/spawn');
      const manager = getAgentServiceManager();
      await manager.stopAgent(args.agentId);
      return { success: true };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
