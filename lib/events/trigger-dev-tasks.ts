/**
 * Trigger.dev Task Definitions
 *
 * Advanced trigger.dev patterns for persistent agent cognition.
 * Based on trigger.md design - unlocks behaviors that can't be faked with ad-hoc code.
 *
 * These tasks provide:
 * - Persistent agent loops (background cognition)
 * - Multi-agent negotiation protocols
 * - Skill bootstrapping (self-extending agents)
 * - Reflection + self-improvement loops
 * - Autonomous tool discovery
 *
 * Integration: When @trigger.dev/sdk is installed, these definitions
 * can be registered with the Trigger.dev runtime.
 *
 * @see lib/events/trigger/ - Trigger.dev wrappers with fallback
 */

import { z } from 'zod';

// Re-export trigger task wrappers for backward compatibility
export {
  executeAgentLoopTask,
  executeConsensusTask,
  executeResearchTask,
  executeReflectionTask,
  executeDAGTask,
  executeSkillBootstrapTask,
  scheduleAgentLoop,
  scheduleReflection,
  scheduleDAGExecution,
  scheduleSkillBootstrap,
  isTriggerAvailable,
  getExecutionMode,
} from './trigger';

// ============================================================================
// Common Event Types (for trigger.dev event triggers)
// ============================================================================

/**
 * Cross-Agent Communication Event
 * Enables agents to talk via events
 */
export const AgentMessageEvent = z.object({
  from: z.string().describe('Source agent ID'),
  to: z.string().describe('Destination agent ID'),
  payload: z.record(z.any()).describe('Message payload'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
});

/**
 * Agent State Update Event
 * For persistent agent memory
 */
export const AgentStateUpdateEvent = z.object({
  agentId: z.string(),
  state: z.record(z.any()).describe('Agent state to persist'),
  checkpoint: z.boolean().default(false).describe('Create a checkpoint'),
});

/**
 * Task Result Event
 * For chaining tasks together
 */
export const TaskResultEvent = z.object({
  taskId: z.string(),
  result: z.record(z.any()),
  success: z.boolean(),
  metadata: z.record(z.any()).optional(),
});

// ============================================================================
// Trigger.dev Task Definitions
// These are compatible with @trigger.dev/sdk when installed
// ============================================================================

/**
 * Persistent Agent Loop Task
 *
 * Agents don't just run once - they wake up, think, act, sleep, repeat.
 * This is the core pattern for autonomous agents.
 *
 * Usage: Register with trigger.dev schedules to run every N minutes
 */

export interface AgentLoopTaskDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  
  // Schedule configuration
  schedule?: {
    type: 'cron' | 'interval';
    expression: string;
  };
  
  // Handler function signature
  handler: (input: unknown, context: {
    io: any; // Trigger.dev IO interface
    agentId: string;
    userId: string;
  }) => Promise<any>;
}

export const AgentLoopTask = {
  id: 'agent-loop',
  name: 'Persistent Agent Loop',
  description: 'Background cognition loop - agents wake up, think, act, sleep, repeat',
  
  inputSchema: z.object({
    agentId: z.string().describe('Agent to run'),
    goal: z.string().describe('Current goal'),
    maxIterations: z.number().optional().default(10),
    checkpointInterval: z.number().optional().default(5),
  }),
  
  schedule: {
    type: 'cron' as const,
    expression: '*/2 * * * *', // Every 2 minutes
  },
};

/**
 * Multi-Agent Consensus Task
 * 
 * Agents can argue, vote, or specialize.
 * Example: Debate → Consensus pattern.
 */
export interface ConsensusTaskDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
}

export const ConsensusTask = {
  id: 'multi-agent-consensus',
  name: 'Multi-Agent Consensus',
  description: 'Run multiple agents in parallel and synthesize results',
  
  inputSchema: z.object({
    prompt: z.string().describe('Prompt for all agents'),
    agents: z.array(z.object({
      id: z.string(),
      role: z.enum(['planner', 'executor', 'critic', 'optimizer']),
      model: z.string().optional(),
    })),
    synthesisModel: z.string().optional().default('claude-3-opus'),
    timeout: z.number().optional().default(60000),
  }),
};

/**
 * Skill Bootstrapping Engine
 * 
 * Agents create reusable skills from successful runs.
 * Self-extending agents pattern.
 */
export const SkillBuilderTask = {
  id: 'skill-builder',
  name: 'Skill Bootstrapper',
  description: 'Extract reusable skills from successful task sequences',
  
  inputSchema: z.object({
    successfulRun: z.object({
      steps: z.array(z.object({
        action: z.string(),
        result: z.any(),
        success: z.boolean(),
      })),
      totalDuration: z.number(),
    }),
    abstractionLevel: z.enum(['simple', 'moderate', 'complex']).default('moderate'),
  }),
};

/**
 * Reflection + Self-Improvement Loop
 * 
 * After execution, agents reflect on what went wrong and improve.
 */
export const ReflectionTask = {
  id: 'reflection',
  name: 'Agent Reflection',
  description: 'Analyze execution results and generate improvements',
  
  inputSchema: z.object({
    result: z.record(z.any()).describe('Task execution result'),
    error: z.string().optional().describe('Error if any'),
    history: z.array(z.object({
      action: z.string(),
      result: z.any(),
      timestamp: z.number(),
    })).optional(),
  }),
};

/**
 * Autonomous Tool Discovery
 * 
 * Agent explores tools dynamically and ranks them by usefulness.
 */
export const ToolDiscoveryTask = {
  id: 'tool-discovery',
  name: 'Tool Discovery',
  description: 'Dynamically explore and rank available tools',
  
  inputSchema: z.object({
    task: z.string().describe('Current task context'),
    availableTools: z.array(z.object({
      name: z.string(),
      description: z.string(),
      category: z.string(),
    })),
  }),
};

/**
 * DAG Runner with Self-Healing
 * 
 * Execute compiled bash DAG with durability and retry logic.
 * Integrates with the existing self-healing system.
 */
export const DAGRunnerTask = {
  id: 'dag-runner',
  name: 'DAG Executor',
  description: 'Execute DAG workflow with self-healing on failures',
  
  inputSchema: z.object({
    dag: z.object({
      nodes: z.array(z.object({
        id: z.string(),
        type: z.string(),
        command: z.string().optional(),
        dependencies: z.array(z.string()).optional(),
      })),
      edges: z.array(z.object({
        from: z.string(),
        to: z.string(),
      })),
    }),
    agentId: z.string().optional(),
    maxRetries: z.number().default(3),
    healOnFailure: z.boolean().default(true),
  }),
};

/**
 * Cross-Agent Communication Bus
 * 
 * Agents talk via events - pub/sub pattern.
 */
export const AgentMessageTask = {
  id: 'agent-message' as const,
  name: 'Agent Message Router',
  description: 'Route messages between agents',
  
  inputSchema: AgentMessageEvent,
};

/**
 * Autonomous Debugging System
 * 
 * When code fails, automatically try to fix it.
 */
export const AutonomousDebugTask = {
  id: 'autonomous-debug',
  name: 'Auto-Debugger',
  description: 'Automatically diagnose and fix code errors',
  
  inputSchema: z.object({
    error: z.object({
      message: z.string(),
      stack: z.string().optional(),
      language: z.string().optional(),
    }),
    context: z.record(z.any()).optional(),
    maxAttempts: z.number().default(3),
  }),
};

/**
 * Speculative Parallel Execution
 * 
 * Run multiple strategies in parallel and pick the best.
 */
export const SpeculativeExecutionTask = {
  id: 'speculative-execution',
  name: 'Speculative Runner',
  description: 'Execute multiple strategies in parallel, select best result',
  
  inputSchema: z.object({
    strategies: z.array(z.object({
      id: z.string(),
      name: z.string(),
      execute: z.string().describe('Function or command to execute'),
    })),
    selectionCriteria: z.enum(['speed', 'quality', 'cost']).default('quality'),
    parallel: z.boolean().default(true),
  }),
};

/**
 * Research Agent Task
 * 
 * Long-horizon research with depth control.
 */
export const ResearchAgentTask = {
  id: 'research-agent',
  name: 'Research Agent',
  description: 'Multi-step research with planning and synthesis',
  
  inputSchema: z.object({
    query: z.string(),
    depth: z.number().min(1).max(10).default(5),
    sources: z.array(z.enum(['web', 'news', 'academic', 'code'])).default(['web']),
    checkpointInterval: z.number().default(3),
  }),
};

// ============================================================================
// Task Registry
// ============================================================================

export const ALL_TRIGGER_TASKS = [
  AgentLoopTask,
  ConsensusTask,
  SkillBuilderTask,
  ReflectionTask,
  ToolDiscoveryTask,
  DAGRunnerTask,
  AgentMessageTask,
  AutonomousDebugTask,
  SpeculativeExecutionTask,
  ResearchAgentTask,
];

export const TASK_BY_ID = new Map(
  ALL_TRIGGER_TASKS.map(t => [t.id, t])
);

/**
 * Get task definition by ID
 */
export function getTriggerTask(id: string) {
  return TASK_BY_ID.get(id);
}

/**
 * Get all task IDs
 */
export function getAllTriggerTaskIds(): string[] {
  return Array.from(TASK_BY_ID.keys());
}

// ============================================================================
// Integration Helper
// ============================================================================

/**
 * Generate trigger.dev SDK code for a task
 * Can be used to export tasks when SDK is installed
 */
export function generateTriggerCode(task: { id: string; name: string; description: string }): string {
  return `
// ${task.name}
// ${task.description}
export const ${task.id.replace(/-/g, '_')} = task({
  id: "${task.id}",
  run: async (payload, io) => {
    // Handler implementation
  }
});
`.trim();
}

/**
 * Compatibility check - returns true if trigger.dev SDK is available
 */
export async function isTriggerAvailable(): Promise<boolean> {
  try {
    await import('@trigger.dev/sdk');
    return true;
  } catch {
    return false;
  }
}