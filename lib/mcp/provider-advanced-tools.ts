/**
 * Provider-Specific Advanced MCP Tools
 * 
 * Exposes advanced provider capabilities as MCP tools:
 * - E2B: AMP (Anthropic) and Codex (OpenAI) agent offloading
 * - Daytona: Computer Use (screenshots, recording) and LSP services
 * - CodeSandbox: Batch execution and task management
 * - Sprites: Checkpoint management
 * 
 * These tools are ADDITIVE - they don't replace existing MCP tools.
 * Auto-discovered when provider API keys are configured.
 * 
 * @see lib/mcp/architecture-integration.ts - Main MCP integration
 * @see lib/mcp/tool-registry.ts - Tool registry
 * 
 * @example
 * ```typescript
 * // In your AI SDK tool calling:
 * import { getProviderAdvancedTools, callProviderTool } from './provider-advanced-tools';
 * 
 * const tools = getProviderAdvancedTools();
 * // Pass to LLM...
 * 
 * // When LLM calls tool:
 * const result = await callProviderTool('e2b_runAmpAgent', { prompt: 'Fix the bug' });
 * ```
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('MCP:ProviderTools');

/**
 * Tool definition format (AI SDK compatible)
 */
export interface ProviderToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

/**
 * Tool execution result
 */
export interface ProviderToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

// ==================== E2B Advanced Tools ====================

/**
 * Get E2B AMP (Anthropic) agent tool definitions
 * 
 * AMP is E2B's Anthropic-powered coding agent that runs in cloud sandboxes.
 * Requires: E2B_API_KEY, AMP_API_KEY
 * 
 * @see https://e2b.dev/docs/agents/amp
 */
export function getE2BAmpToolDefinitions(): ProviderToolDefinition[] {
  if (!process.env.E2B_API_KEY || !process.env.AMP_API_KEY) {
    return [];
  }

  return [
    {
      type: 'function',
      function: {
        name: 'e2b_runAmpAgent',
        description: 'Run Anthropic AMP coding agent in E2B sandbox. Use for complex code tasks that require autonomous agent execution.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Task description for the agent (e.g., "Fix all TODO comments in the codebase")',
            },
            workingDir: {
              type: 'string',
              description: 'Working directory inside sandbox (default: /home/user)',
              default: '/home/user',
            },
            streamJson: {
              type: 'boolean',
              description: 'Stream JSON-formatted events (default: false)',
              default: false,
            },
            model: {
              type: 'string',
              description: 'Anthropic model to use (default: claude-3-5-sonnet-20241022)',
              default: 'claude-3-5-sonnet-20241022',
            },
          },
          required: ['prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'e2b_runAmpAgentWithRepo',
        description: 'Run AMP agent on a git repository. Clones repo, runs agent, returns changes.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Task description for the agent',
            },
            repoUrl: {
              type: 'string',
              description: 'Git repository URL to clone',
            },
            branch: {
              type: 'string',
              description: 'Branch to clone (default: main)',
              default: 'main',
            },
            workingDir: {
              type: 'string',
              description: 'Directory to clone into (default: /home/user/repo)',
              default: '/home/user/repo',
            },
          },
          required: ['prompt', 'repoUrl'],
        },
      },
    },
  ];
}

/**
 * Get E2B Codex (OpenAI) agent tool definitions
 * 
 * Codex is E2B's OpenAI-powered coding agent.
 * Requires: E2B_API_KEY, CODEX_API_KEY (or OPENAI_API_KEY)
 * 
 * @see https://e2b.dev/docs/agents/codex
 */
export function getE2BCodexToolDefinitions(): ProviderToolDefinition[] {
  if (!process.env.E2B_API_KEY || (!process.env.CODEX_API_KEY && !process.env.OPENAI_API_KEY)) {
    return [];
  }

  return [
    {
      type: 'function',
      function: {
        name: 'e2b_runCodexAgent',
        description: 'Run OpenAI Codex coding agent in E2B sandbox. Use for autonomous code review, refactoring, or generation.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Task description for Codex (e.g., "Review this codebase for security issues")',
            },
            workingDir: {
              type: 'string',
              description: 'Working directory inside sandbox (default: /home/user)',
              default: '/home/user',
            },
            fullAuto: {
              type: 'boolean',
              description: 'Run in fully autonomous mode (default: false)',
              default: false,
            },
            outputSchemaPath: {
              type: 'string',
              description: 'Path to JSON schema for structured output',
            },
          },
          required: ['prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'e2b_runCodexAgentWithRepo',
        description: 'Run Codex agent on a git repository. Clones repo, runs agent, returns structured output.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Task description for Codex',
            },
            repoUrl: {
              type: 'string',
              description: 'Git repository URL to clone',
            },
            branch: {
              type: 'string',
              description: 'Branch to clone (default: main)',
              default: 'main',
            },
            outputSchemaPath: {
              type: 'string',
              description: 'Path to JSON schema for structured output',
            },
          },
          required: ['prompt', 'repoUrl'],
        },
      },
    },
  ];
}

/**
 * Execute E2B AMP agent
 */
export async function executeE2BAmpAgent(args: {
  prompt: string;
  workingDir?: string;
  streamJson?: boolean;
  model?: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('e2b');
    const handle = await provider.createSandbox({});

    const ampService = handle.getAmpService();
    if (!ampService) {
      await provider.destroySandbox(handle.id);
      return {
        success: false,
        output: '',
        error: 'AMP_API_KEY not configured',
      };
    }

    const result = await ampService.run({
      prompt: args.prompt,
      workingDir: args.workingDir || '/home/user',
      streamJson: args.streamJson ?? false,
      model: args.model,
    });

    // Destroy sandbox after execution
    await provider.destroySandbox(handle.id);

    return {
      success: true,
      output: result.output || '',
      metadata: {
        sandboxId: handle.id,
        cost: result.cost || 0,
        tokens: result.tokens,
      },
    };
  } catch (error: any) {
    logger.error('E2B AMP agent failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'AMP agent execution failed',
    };
  }
}

/**
 * Execute E2B Codex agent
 */
export async function executeE2BCodexAgent(args: {
  prompt: string;
  workingDir?: string;
  fullAuto?: boolean;
  outputSchemaPath?: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('e2b');
    const handle = await provider.createSandbox({});

    const codexService = handle.getCodexService();
    if (!codexService) {
      await provider.destroySandbox(handle.id);
      return {
        success: false,
        output: '',
        error: 'CODEX_API_KEY not configured',
      };
    }

    const result = await codexService.run({
      prompt: args.prompt,
      workingDir: args.workingDir || '/home/user',
      fullAuto: args.fullAuto ?? false,
      outputSchemaPath: args.outputSchemaPath,
    });

    // Destroy sandbox after execution
    await provider.destroySandbox(handle.id);

    return {
      success: true,
      output: result.output || '',
      metadata: {
        sandboxId: handle.id,
        cost: result.cost || 0,
        tokens: result.tokens,
      },
    };
  } catch (error: any) {
    logger.error('E2B Codex agent failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Codex agent execution failed',
    };
  }
}

/**
 * Execute E2B AMP agent with git repository
 * Clones repo first, then runs AMP agent
 */
export async function executeE2BAmpAgentWithRepo(args: {
  prompt: string;
  repoUrl: string;
  branch?: string;
  workingDir?: string;
  streamJson?: boolean;
  model?: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('e2b');
    const handle = await provider.createSandbox({});

    // Clone repository first
    const clonePath = args.workingDir || '/home/user/project';
    await handle.executeCommand(`git clone ${args.repoUrl} ${clonePath}`);
    
    if (args.branch) {
      await handle.executeCommand(`cd ${clonePath} && git checkout ${args.branch}`);
    }

    const ampService = handle.getAmpService();
    if (!ampService) {
      await provider.destroySandbox(handle.id);
      return {
        success: false,
        output: '',
        error: 'AMP_API_KEY not configured',
      };
    }

    const result = await ampService.run({
      prompt: args.prompt,
      workingDir: clonePath,
      streamJson: args.streamJson ?? false,
      model: args.model,
    });

    // Destroy sandbox after execution
    await provider.destroySandbox(handle.id);

    return {
      success: true,
      output: result.output || '',
      metadata: {
        sandboxId: handle.id,
        cost: result.cost || 0,
        tokens: result.tokens,
        repoUrl: args.repoUrl,
        branch: args.branch || 'default',
      },
    };
  } catch (error: any) {
    logger.error('E2B AMP with repo failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'AMP with repo failed',
    };
  }
}

/**
 * Execute E2B Codex agent with git repository
 * Clones repo first, then runs Codex agent
 */
export async function executeE2BCodexAgentWithRepo(args: {
  prompt: string;
  repoUrl: string;
  branch?: string;
  workingDir?: string;
  fullAuto?: boolean;
  outputSchemaPath?: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('e2b');
    const handle = await provider.createSandbox({});

    // Clone repository first
    const clonePath = args.workingDir || '/home/user/project';
    await handle.executeCommand(`git clone ${args.repoUrl} ${clonePath}`);
    
    if (args.branch) {
      await handle.executeCommand(`cd ${clonePath} && git checkout ${args.branch}`);
    }

    const codexService = handle.getCodexService();
    if (!codexService) {
      await provider.destroySandbox(handle.id);
      return {
        success: false,
        output: '',
        error: 'CODEX_API_KEY not configured',
      };
    }

    const result = await codexService.run({
      prompt: args.prompt,
      workingDir: clonePath,
      fullAuto: args.fullAuto ?? false,
      outputSchemaPath: args.outputSchemaPath,
    });

    // Destroy sandbox after execution
    await provider.destroySandbox(handle.id);

    return {
      success: true,
      output: result.output || '',
      metadata: {
        sandboxId: handle.id,
        cost: result.cost || 0,
        tokens: result.tokens,
        repoUrl: args.repoUrl,
        branch: args.branch || 'default',
      },
    };
  } catch (error: any) {
    logger.error('E2B Codex with repo failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Codex with repo failed',
    };
  }
}

// ==================== Daytona Computer Use Tools ====================

/**
 * Get Daytona Computer Use tool definitions
 * 
 * Computer Use allows taking screenshots and screen recordings of sandbox desktop.
 * Requires: DAYTONA_API_KEY
 * 
 * @see https://www.daytona.io/docs/computer-use
 */
export function getDaytonaComputerUseToolDefinitions(): ProviderToolDefinition[] {
  if (!process.env.DAYTONA_API_KEY) {
    return [];
  }

  return [
    {
      type: 'function',
      function: {
        name: 'daytona_takeScreenshot',
        description: 'Take a screenshot of the Daytona sandbox desktop. Use for visual debugging or computer use agents.',
        parameters: {
          type: 'object',
          properties: {
            sandboxId: {
              type: 'string',
              description: 'Daytona sandbox ID',
            },
            x: {
              type: 'number',
              description: 'X coordinate (default: 0)',
              default: 0,
            },
            y: {
              type: 'number',
              description: 'Y coordinate (default: 0)',
              default: 0,
            },
            width: {
              type: 'number',
              description: 'Screenshot width (default: 1920)',
              default: 1920,
            },
            height: {
              type: 'number',
              description: 'Screenshot height (default: 1080)',
              default: 1080,
            },
          },
          required: ['sandboxId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'daytona_startRecording',
        description: 'Start screen recording of Daytona sandbox desktop.',
        parameters: {
          type: 'object',
          properties: {
            sandboxId: {
              type: 'string',
              description: 'Daytona sandbox ID',
            },
          },
          required: ['sandboxId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'daytona_stopRecording',
        description: 'Stop screen recording and get video URL.',
        parameters: {
          type: 'object',
          properties: {
            sandboxId: {
              type: 'string',
              description: 'Daytona sandbox ID',
            },
            recordingId: {
              type: 'string',
              description: 'Recording ID from startRecording',
            },
          },
          required: ['sandboxId', 'recordingId'],
        },
      },
    },
  ];
}

/**
 * Take screenshot via Daytona Computer Use
 */
export async function executeDaytonaScreenshot(args: {
  sandboxId: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('daytona');
    const handle = await provider.getSandbox(args.sandboxId);

    const computerUseService = handle.getComputerUseService();
    if (!computerUseService) {
      return {
        success: false,
        output: '',
        error: 'Computer Use Service not available',
      };
    }

    const result = await computerUseService.takeRegion({
      x: args.x ?? 0,
      y: args.y ?? 0,
      width: args.width ?? 1920,
      height: args.height ?? 1080,
    });

    return {
      success: true,
      output: `Screenshot taken: ${result.image}`,
      metadata: { imageUrl: result.image },
    };
  } catch (error: any) {
    logger.error('Daytona screenshot failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Screenshot failed',
    };
  }
}

/**
 * Start screen recording via Daytona
 */
export async function executeDaytonaStartRecording(args: {
  sandboxId: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('daytona');
    const handle = await provider.getSandbox(args.sandboxId);

    const computerUseService = handle.getComputerUseService();
    if (!computerUseService) {
      return {
        success: false,
        output: '',
        error: 'Computer Use Service not available',
      };
    }

    const result = await computerUseService.startRecording();

    return {
      success: true,
      output: `Recording started: ${result.recordingId}`,
      metadata: { recordingId: result.recordingId },
    };
  } catch (error: any) {
    logger.error('Daytona recording start failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Failed to start recording',
    };
  }
}

/**
 * Stop screen recording via Daytona
 */
export async function executeDaytonaStopRecording(args: {
  sandboxId: string;
  recordingId: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('daytona');
    const handle = await provider.getSandbox(args.sandboxId);

    const computerUseService = handle.getComputerUseService();
    if (!computerUseService) {
      return {
        success: false,
        output: '',
        error: 'Computer Use Service not available',
      };
    }

    const result = await computerUseService.stopRecording(args.recordingId);

    return {
      success: true,
      output: `Recording stopped: ${result.video}`,
      metadata: { videoUrl: result.video },
    };
  } catch (error: any) {
    logger.error('Daytona recording stop failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Failed to stop recording',
    };
  }
}

// ==================== CodeSandbox Batch Tools ====================

/**
 * Get CodeSandbox batch execution tool definitions
 * 
 * Allows running parallel jobs across multiple sandboxes.
 * Requires: CSB_API_KEY
 */
export function getCodesandboxBatchToolDefinitions(): ProviderToolDefinition[] {
  if (!process.env.CSB_API_KEY) {
    return [];
  }

  return [
    {
      type: 'function',
      function: {
        name: 'codesandbox_runBatchJob',
        description: 'Run batch job across multiple CodeSandbox instances. Use for parallel testing, data processing, or CI/CD.',
        parameters: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  command: { type: 'string' },
                  files: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        path: { type: 'string' },
                        content: { type: 'string' },
                      },
                      required: ['path', 'content'],
                    },
                  },
                },
                required: ['command'],
              },
              description: 'Array of tasks to execute in parallel',
            },
            maxConcurrent: {
              type: 'number',
              description: 'Maximum concurrent sandboxes (default: 10)',
              default: 10,
            },
            timeout: {
              type: 'number',
              description: 'Timeout per task in ms (default: 300000)',
              default: 300000,
            },
          },
          required: ['tasks'],
        },
      },
    },
  ];
}

/**
 * Execute CodeSandbox batch job
 */
export async function executeCodesandboxBatch(args: {
  tasks: Array<{
    id?: string;
    command: string;
    files?: Array<{ path: string; content: string }>;
  }>;
  maxConcurrent?: number;
  timeout?: number;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('codesandbox');

    const maxConcurrent = args.maxConcurrent || 10;
    const timeout = args.timeout || 300000;
    const results: Array<{ taskId: string; success: boolean; output: string; error?: string }> = [];
    const startTime = Date.now();

    // Run tasks in batches
    for (let i = 0; i < args.tasks.length; i += maxConcurrent) {
      const batch = args.tasks.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          try {
            const handle = await provider.createSandbox({});

            // Write files if provided
            if (task.files) {
              for (const file of task.files) {
                await handle.writeFile(file.path, file.content);
              }
            }

            // Execute command
            const result = await handle.executeCommand(task.command, undefined, timeout);

            await provider.destroySandbox(handle.id);

            return {
              taskId: task.id || `task-${i}`,
              success: result.success,
              output: result.output || '',
            };
          } catch (error: any) {
            return {
              taskId: task.id || `task-${i}`,
              success: false,
              output: '',
              error: error?.message || 'Task failed',
            };
          }
        })
      );

      results.push(...batchResults);
    }

    return {
      success: true,
      output: JSON.stringify(results, null, 2),
      metadata: {
        totalTasks: results.length,
        successfulTasks: results.filter(r => r.success).length,
        failedTasks: results.filter(r => !r.success).length,
        totalDuration: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    logger.error('CodeSandbox batch job failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Batch job failed',
    };
  }
}

// ==================== Sprites Checkpoint Tools ====================

/**
 * Get Sprites checkpoint management tool definitions
 * 
 * Allows creating, listing, and restoring Sprites checkpoints.
 * Requires: SPRITES_TOKEN
 */
export function getSpritesCheckpointToolDefinitions(): ProviderToolDefinition[] {
  if (!process.env.SPRITES_TOKEN) {
    return [];
  }

  return [
    {
      type: 'function',
      function: {
        name: 'sprites_createCheckpoint',
        description: 'Create a checkpoint (filesystem snapshot) of a Sprites sandbox. Use for state preservation.',
        parameters: {
          type: 'object',
          properties: {
            sandboxId: {
              type: 'string',
              description: 'Sprites sandbox ID',
            },
            name: {
              type: 'string',
              description: 'Checkpoint name (optional)',
            },
          },
          required: ['sandboxId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'sprites_listCheckpoints',
        description: 'List all checkpoints for a Sprites sandbox.',
        parameters: {
          type: 'object',
          properties: {
            sandboxId: {
              type: 'string',
              description: 'Sprites sandbox ID',
            },
          },
          required: ['sandboxId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'sprites_restoreCheckpoint',
        description: 'Restore a Sprites sandbox from a checkpoint.',
        parameters: {
          type: 'object',
          properties: {
            sandboxId: {
              type: 'string',
              description: 'Sprites sandbox ID',
            },
            checkpointId: {
              type: 'string',
              description: 'Checkpoint ID to restore',
            },
          },
          required: ['sandboxId', 'checkpointId'],
        },
      },
    },
  ];
}

/**
 * Create Sprites checkpoint
 */
export async function executeSpritesCreateCheckpoint(args: {
  sandboxId: string;
  name?: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('sprites');
    const handle = await provider.getSandbox(args.sandboxId);

    if (!handle.createCheckpoint) {
      return {
        success: false,
        output: '',
        error: 'Provider does not support checkpoints',
      };
    }

    const checkpoint = await handle.createCheckpoint(args.name);

    return {
      success: true,
      output: `Checkpoint created: ${checkpoint.id}`,
      metadata: checkpoint,
    };
  } catch (error: any) {
    logger.error('Sprites checkpoint creation failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Failed to create checkpoint',
    };
  }
}

/**
 * List Sprites checkpoints
 */
export async function executeSpritesListCheckpoints(args: {
  sandboxId: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('sprites');
    const handle = await provider.getSandbox(args.sandboxId);

    if (!handle.listCheckpoints) {
      return {
        success: false,
        output: '',
        error: 'Provider does not support checkpoints',
      };
    }

    const checkpoints = await handle.listCheckpoints();

    return {
      success: true,
      output: JSON.stringify(checkpoints, null, 2),
      metadata: { count: checkpoints.length },
    };
  } catch (error: any) {
    logger.error('Sprites checkpoint listing failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Failed to list checkpoints',
    };
  }
}

/**
 * Restore Sprites checkpoint
 */
export async function executeSpritesRestoreCheckpoint(args: {
  sandboxId: string;
  checkpointId: string;
}): Promise<ProviderToolResult> {
  try {
    const { getSandboxProvider } = await import('../sandbox/providers');
    const provider = await getSandboxProvider('sprites');
    const handle = await provider.getSandbox(args.sandboxId);

    if (!handle.restoreCheckpoint) {
      return {
        success: false,
        output: '',
        error: 'Provider does not support checkpoint restoration',
      };
    }

    await handle.restoreCheckpoint(args.checkpointId);

    return {
      success: true,
      output: `Checkpoint ${args.checkpointId} restored successfully`,
    };
  } catch (error: any) {
    logger.error('Sprites checkpoint restoration failed:', error);
    return {
      success: false,
      output: '',
      error: error?.message || 'Failed to restore checkpoint',
    };
  }
}

// ==================== Unified Tool Discovery ====================

/**
 * Get all available provider-specific tools
 * 
 * Auto-discovers tools based on configured API keys.
 * Call this from getMCPToolsForAI_SDK() to include provider tools.
 */
export function getAllProviderAdvancedTools(): ProviderToolDefinition[] {
  const tools: ProviderToolDefinition[] = [];

  // E2B tools
  tools.push(...getE2BAmpToolDefinitions());
  tools.push(...getE2BCodexToolDefinitions());

  // Daytona tools
  tools.push(...getDaytonaComputerUseToolDefinitions());

  // CodeSandbox tools
  tools.push(...getCodesandboxBatchToolDefinitions());

  // Sprites tools
  tools.push(...getSpritesCheckpointToolDefinitions());

  logger.debug(`Discovered ${tools.length} provider-specific advanced tools`);

  return tools;
}

/**
 * Call a provider-specific tool by name
 * 
 * Use this from callMCPToolFromAI_SDK() to execute provider tools.
 */
export async function callProviderTool(
  toolName: string,
  args: Record<string, any>
): Promise<ProviderToolResult> {
  logger.debug(`Calling provider tool: ${toolName}`, { args });

  // E2B AMP tools
  if (toolName === 'e2b_runAmpAgent') {
    return executeE2BAmpAgent(args as any);
  }
  if (toolName === 'e2b_runAmpAgentWithRepo') {
    // IMPLEMENTED: Clone repo first, then run AMP agent
    return executeE2BAmpAgentWithRepo(args as any);
  }

  // E2B Codex tools
  if (toolName === 'e2b_runCodexAgent') {
    return executeE2BCodexAgent(args as any);
  }
  if (toolName === 'e2b_runCodexAgentWithRepo') {
    // IMPLEMENTED: Clone repo first, then run Codex agent
    return executeE2BCodexAgentWithRepo(args as any);
  }

  // Daytona Computer Use tools
  if (toolName === 'daytona_takeScreenshot') {
    return executeDaytonaScreenshot(args as any);
  }
  if (toolName === 'daytona_startRecording') {
    return executeDaytonaStartRecording(args as any);
  }
  if (toolName === 'daytona_stopRecording') {
    return executeDaytonaStopRecording(args as any);
  }

  // CodeSandbox batch tools
  if (toolName === 'codesandbox_runBatchJob') {
    return executeCodesandboxBatch(args as any);
  }

  // Sprites checkpoint tools
  if (toolName === 'sprites_createCheckpoint') {
    return executeSpritesCreateCheckpoint(args as any);
  }
  if (toolName === 'sprites_listCheckpoints') {
    return executeSpritesListCheckpoints(args as any);
  }
  if (toolName === 'sprites_restoreCheckpoint') {
    return executeSpritesRestoreCheckpoint(args as any);
  }

  return {
    success: false,
    output: '',
    error: `Unknown provider tool: ${toolName}`,
  };
}
