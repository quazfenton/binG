/**
 * WebMCP Native Support — Static Export Compatible
 *
 * Chrome 146+ native WebMCP protocol for AI agent interactions.
 * In static export mode, only the manifest discovery (GET) is available.
 * Tool invocation requires a backend server (deployed separately).
 *
 * @see https://developer.chrome.com/docs/capabilities/webmcp
 */

import { NextResponse } from 'next/server';

// Required for static export — pre-renders the manifest at build time
export const dynamic = 'force-static';

/**
 * WebMCP Tool Definition
 */
export interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * WebMCP Manifest for binG
 */
const WEBMCP_MANIFEST = {
  version: '1.0.0',
  name: 'binG',
  description:
    'Agentic compute workspace with sandbox execution, voice control, and multi-agent orchestration',
  tools: [
    {
      name: 'execute_command',
      description: 'Execute shell commands (host system - use with trusted clients only)',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Bash command to execute' },
          workingDir: { type: 'string', description: 'Working directory (default: /workspace)' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
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
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'File content' },
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
          path: { type: 'string', description: 'File path' },
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
          path: { type: 'string', description: 'Directory path' },
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
          task: { type: 'string', description: 'Task description' },
          model: { type: 'string', description: 'LLM model to use' },
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
          agentId: { type: 'string', description: 'Agent ID' },
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
          agentId: { type: 'string', description: 'Agent ID' },
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
    sandbox: false,
    voice: true,
    llm: true,
    integrations: true,
  },
  endpoints: {
    tools: '/.well-known/webmcp',
    invoke: '/.well-known/webmcp',
  },
};

/**
 * GET /.well-known/webmcp
 *
 * WebMCP manifest discovery — pre-rendered at build time for static export.
 * The backend server (OCI/Railway) handles tool invocations separately.
 */
export async function GET() {
  return NextResponse.json(WEBMCP_MANIFEST, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
