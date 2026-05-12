/**
 * Pi MCP Tools Adapter
 * 
 * Wraps Pi session as MCP tools for integration with binG's MCP system.
 */

import type { PiTool, PiToolContext } from './pi-types';
import type { ToolDefinition, ToolResult } from '@/lib/agent/types';

type PiSession = Awaited<ReturnType<typeof import('./pi-types')['createPiSession']>>;

/** Create Pi tools from a session */
export function createPiTools(session: PiSession): PiTool[] {
  return [
    {
      name: 'pi_prompt',
      description: 'Send a prompt to the Pi coding agent',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The prompt/message to send to the agent' },
        },
        required: ['message'],
      },
      async execute(args: Record<string, unknown>, context: PiToolContext): Promise<ToolResult> {
        try {
          await session.prompt(args.message as string);
          return {
            content: [{ type: 'text', text: 'Prompt sent to agent' }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    },
    {
      name: 'pi_status',
      description: 'Get Pi agent status',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute(args: Record<string, unknown>, context: PiToolContext): Promise<ToolResult> {
        try {
          const state = await session.getState();
          return {
            content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    },
    {
      name: 'pi_abort',
      description: 'Abort the current Pi agent operation',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute(args: Record<string, unknown>, context: PiToolContext): Promise<ToolResult> {
        try {
          await session.abort();
          return {
            content: [{ type: 'text', text: 'Agent operation aborted' }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    },
    {
      name: 'pi_messages',
      description: 'Get Pi conversation messages',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute(args: Record<string, unknown>, context: PiToolContext): Promise<ToolResult> {
        try {
          const messages = await session.getMessages();
          return {
            content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    },
  ];
}

/** Register Pi tools with MCP registry */
export async function registerPiTools(config: {
  mode: 'vfs' | 'local';
  userId?: string;
  cwd?: string;
  remoteUrl?: string;
}) {
  const { createPiSession } = await import('./pi-types');
  const session = await createPiSession({
    cwd: config.cwd || '/workspace',
    mode: config.mode,
  });

  const tools = createPiTools(session);

  return {
    session,
    tools,
  };
}