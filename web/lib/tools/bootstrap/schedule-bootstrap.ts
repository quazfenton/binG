/**
 * Bootstrap Task Scheduling Tool Registration
 * 
 * Registers task.schedule, task.status, and task.cancel capabilities
 * with the tool system. Connects to the event system (lib/events/)
 * 
 * Integrates trigger.md patterns:
 * - Persistent agent loops (background cognition)
 * - DAG execution with self-healing
 * - Event-driven task processing
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';
import { z } from 'zod';
import {
  scheduleTask,
  getTaskStatus,
  cancelTask,
  ScheduleTaskInput,
} from '../../events/trigger-integration';

const logger = createLogger('Tools:Bootstrap:Schedule');

// Track registration to avoid duplicates when called alongside bootstrap-events.ts
let basicScheduleRegistered = false;

/**
 * Register task scheduling tools with registry
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerScheduleTools(
  registry: ToolRegistry,
  config: BootstrapConfig
): Promise<number> {
  // Skip if basic schedule tools already registered by bootstrap-events.ts
  if (basicScheduleRegistered) {
    logger.debug('Basic schedule tools already registered, skipping');
    return 0;
  }

  // Check if tools already exist (registered by bootstrap-events.ts)
  if (registry.getTool('task.schedule')) {
    logger.debug('task.schedule already registered by another bootstrap module');
    basicScheduleRegistered = true;
    return 0;
  }

  try {
    logger.info('Registering task scheduling tools...');

    let registered = 0;

    // Register task.schedule capability
    await registry.registerTool({
      name: 'task.schedule',
      capability: 'task.schedule',
      provider: 'events',
      handler: async (args: any, _context: any) => {
        const result = await scheduleTask({
          taskType: args.taskType,
          schedule: args.schedule,
          payload: args.payload,
          metadata: args.metadata,
          userId: args.userId || config.userId,
        });
        return result;
      },
      inputSchema: ScheduleTaskInput,
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.95,
        tags: ['task', 'schedule', 'background', 'cron', 'event'],
      },
      permissions: ['task:schedule'],
    });
    registered++;

    // Register task.status capability
    await registry.registerTool({
      name: 'task.status',
      capability: 'task.status',
      provider: 'events',
      handler: async (args: any, _context: any) => {
        const result = await getTaskStatus(args.taskId);
        return result;
      },
      inputSchema: z.object({
        taskId: z.string().describe('Task ID returned from task.schedule'),
      }),
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['task', 'status', 'background', 'check'],
      },
      permissions: ['task:read'],
    });
    registered++;

    // Register task.cancel capability
    await registry.registerTool({
      name: 'task.cancel',
      capability: 'task.cancel',
      provider: 'events',
      handler: async (args: any, _context: any) => {
        const result = await cancelTask(args.taskId);
        return result;
      },
      inputSchema: z.object({
        taskId: z.string().describe('Task ID to cancel'),
      }),
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.95,
        tags: ['task', 'cancel', 'background', 'stop'],
      },
      permissions: ['task:cancel'],
    });
    registered++;

    logger.info(`Registered ${registered} task scheduling tools`);
    basicScheduleRegistered = true;
    return registered;
  } catch (error: any) {
    logger.error('Failed to register task scheduling tools', error);
    throw error;
  }
}

/**
 * Register persistent agent loop task (trigger.md pattern #1)
 * 
 * This enables agents that wake up, think, act, sleep, repeat.
 * 
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerAgentLoopTask(
  registry: ToolRegistry,
  config: BootstrapConfig
): Promise<number> {
  try {
    logger.debug('Registering agent loop task capability...');

    // Register agent_loop capability
    await registry.registerTool({
      name: 'task.agent-loop',
      capability: 'task.agent-loop',
      provider: 'events',
      handler: async (args: any, _context: any) => {
        // Agent loop task - schedules recurring agent execution
        const result = await scheduleTask({
          taskType: 'NULLCLAW_AGENT',
          schedule: {
            type: 'cron',
            expression: args.interval || '*/2 * * * *', // Default: every 2 minutes
          },
          payload: {
            prompt: args.goal,
            model: args.model,
            tools: args.tools,
          },
          metadata: {
            name: args.name || 'Agent Loop',
            priority: args.priority || 'normal',
            maxRetries: args.maxRetries || 3,
          },
          userId: args.userId || config.userId,
        });
        return result;
      },
      inputSchema: z.object({
        goal: z.string().describe('Agent goal to pursue'),
        interval: z.string().optional().describe('Cron expression for loop frequency'),
        model: z.string().optional().describe('Model to use'),
        tools: z.array(z.string()).optional().describe('Tools available to agent'),
        name: z.string().optional().describe('Loop name'),
        priority: z.enum(['low', 'normal', 'high']).optional(),
        maxRetries: z.number().optional(),
        userId: z.string().optional(),
      }),
      metadata: {
        latency: 'medium',
        cost: 'high',
        reliability: 0.9,
        tags: ['agent', 'loop', 'persistent', 'background', 'autonomous'],
      },
      permissions: ['task:schedule', 'agent:execute'],
    });

    logger.info('Agent loop task registered');
    return 1;
  } catch (error: any) {
    logger.error('Failed to register agent loop task', error);
    return 0;
  }
}

/**
 * Register DAG execution task (trigger.md pattern #2)
 * 
 * Runs compiled bash DAG with durability and self-healing.
 * 
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerDAGTask(
  registry: ToolRegistry,
  config: BootstrapConfig
): Promise<number> {
  try {
    logger.debug('Registering DAG execution task...');

    await registry.registerTool({
      name: 'task.dag-run',
      capability: 'task.dag-run',
      provider: 'events',
      handler: async (args: any, _context: any) => {
        // DAG execution - runs a workflow of tasks
        const result = await scheduleTask({
          taskType: 'CUSTOM_DAG',
          schedule: {
            type: args.immediate ? 'immediate' : 'cron',
            expression: args.schedule,
          },
          payload: {
            nodes: args.nodes,
            edges: args.edges,
            agentId: args.agentId,
          },
          metadata: {
            name: args.name || 'DAG Workflow',
            priority: args.priority || 'normal',
            maxRetries: args.maxRetries || 3,
            timeout: args.timeout,
          },
          userId: args.userId || config.userId,
        });
        return result;
      },
      inputSchema: z.object({
        nodes: z.array(z.object({
          id: z.string(),
          type: z.string(),
          action: z.string(),
          config: z.record(z.any()).optional(),
        })).describe('DAG nodes'),
        edges: z.array(z.object({
          from: z.string(),
          to: z.string(),
          condition: z.string().optional(),
        })).describe('DAG edges'),
        schedule: z.string().optional().describe('Cron expression'),
        immediate: z.boolean().optional().describe('Run immediately'),
        name: z.string().optional(),
        priority: z.enum(['low', 'normal', 'high']).optional(),
        maxRetries: z.number().optional(),
        timeout: z.number().optional(),
        agentId: z.string().optional(),
        userId: z.string().optional(),
      }),
      metadata: {
        latency: 'medium',
        cost: 'medium',
        reliability: 0.9,
        tags: ['dag', 'workflow', 'pipeline', 'execution'],
      },
      permissions: ['task:schedule'],
    });

    logger.info('DAG execution task registered');
    return 1;
  } catch (error: any) {
    logger.error('Failed to register DAG task', error);
    return 0;
  }
}

/**
 * Register skill bootstrap task (trigger.md pattern #3)
 *
 * Extracts reusable skills from successful task executions.
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerSkillBootstrapTask(
  registry: ToolRegistry,
  config: BootstrapConfig
): Promise<number> {
  try {
    logger.debug('Registering skill bootstrap task...');

    await registry.registerTool({
      name: 'task.skill-bootstrap',
      capability: 'task.skill-bootstrap',
      provider: 'events',
      handler: async (args: any, _context: any) => {
        // Skill bootstrap - extract reusable skill from successful run
        const { executeSkillBootstrapTask } = await import('@/lib/events/trigger');
        
        const result = await executeSkillBootstrapTask({
          successfulRun: args.successfulRun,
          abstractionLevel: args.abstractionLevel || 'moderate',
          model: args.model,
          storeSkill: args.storeSkill !== false,
        });
        
        return result;
      },
      inputSchema: z.object({
        successfulRun: z.object({
          steps: z.array(z.object({
            action: z.string(),
            result: z.any(),
            success: z.boolean(),
          })),
          totalDuration: z.number(),
          userId: z.string(),
        }).describe('Successful execution to extract skill from'),
        abstractionLevel: z.enum(['simple', 'moderate', 'complex']).optional().describe('Level of abstraction'),
        model: z.string().optional().describe('Model to use for extraction'),
        storeSkill: z.boolean().optional().describe('Whether to store the extracted skill'),
      }),
      metadata: {
        latency: 'high',
        cost: 'medium',
        reliability: 0.95,
        tags: ['skill', 'bootstrap', 'extraction', 'learning', 'self-improvement'],
      },
      permissions: ['skill:extract', 'skill:store'],
    });

    logger.info('Skill bootstrap task registered');
    return 1;
  } catch (error: any) {
    logger.error('Failed to register skill bootstrap task', error);
    return 0;
  }
}

/**
 * Register all schedule-related tools
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Total tools registered
 */
export async function registerAllScheduleTools(
  registry: ToolRegistry,
  config: BootstrapConfig
): Promise<number> {
  const basic = await registerScheduleTools(registry, config);
  const agentLoop = await registerAgentLoopTask(registry, config);
  const dag = await registerDAGTask(registry, config);
  const skillBootstrap = await registerSkillBootstrapTask(registry, config);

  return basic + agentLoop + dag + skillBootstrap;
}
