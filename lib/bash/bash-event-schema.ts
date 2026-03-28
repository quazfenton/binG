/**
 * Bash Execution Event Schema
 * 
 * Typed events for bash execution pipeline
 * 
 * @see bash.md - Bash-native agent execution patterns
 */

import { z } from 'zod';

// ============================================================================
// Bash Execution Events
// ============================================================================

/**
 * Bash execution request event
 */
export const BashExecutionEvent = z.object({
  type: z.literal('BASH_EXECUTION'),
  command: z.string().describe('Bash command to execute'),
  agentId: z.string().describe('Agent/thread ID'),
  persist: z.boolean().default(true).describe('Persist to VFS'),
  workingDir: z.string().optional().describe('Working directory'),
  env: z.record(z.string()).optional().describe('Environment variables'),
  timeout: z.number().optional().describe('Timeout in ms'),
  selfHeal: z.boolean().optional().default(true).describe('Enable self-healing on failure'),
  maxRetries: z.number().optional().default(3).describe('Max retry attempts'),
});

export type BashExecutionEvent = z.infer<typeof BashExecutionEvent>;

/**
 * Bash execution result
 */
export const BashExecutionResult = z.object({
  success: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  duration: z.number().describe('Execution duration in ms'),
  command: z.string(),
  workingDir: z.string(),
  outputPath: z.string().optional().describe('VFS path where output was persisted'),
});

export type BashExecutionResult = z.infer<typeof BashExecutionResult>;

// ============================================================================
// Self-Healing Types
// ============================================================================

/**
 * Bash failure context for self-healing
 */
export const BashFailureContext = z.object({
  command: z.string(),
  stderr: z.string(),
  stdout: z.string(),
  exitCode: z.number(),
  workingDir: z.string(),
  files: z.array(z.string()).describe('File snapshot from VFS'),
  attempt: z.number(),
  errorType: z.enum([
    'missing_binary',
    'missing_file',
    'permissions',
    'syntax',
    'timeout',
    'unknown',
  ]).optional(),
});

export type BashFailureContext = z.infer<typeof BashFailureContext>;

/**
 * Command repair result from LLM
 */
export const CommandRepair = z.object({
  fixedCommand: z.string(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  diff: z.array(z.object({
    type: z.enum(['replace', 'insert', 'delete']),
    target: z.string(),
    value: z.string().optional(),
  })).optional().describe('Diff-based patches'),
});

export type CommandRepair = z.infer<typeof CommandRepair>;

// ============================================================================
// DAG Types for Pipeline Execution
// ============================================================================

/**
 * DAG node type
 */
export const DAGNodeType = z.enum(['bash', 'tool', 'container']);

export type DAGNodeType = z.infer<typeof DAGNodeType>;

/**
 * DAG node for pipeline execution
 */
export const DAGNode = z.object({
  id: z.string(),
  type: DAGNodeType,
  command: z.string().optional(),
  tool: z.string().optional(),
  args: z.any().optional(),
  dependsOn: z.array(z.string()).default([]),
  outputs: z.array(z.string()).optional().describe('Output file paths'),
  stdin: z.string().optional().describe('Stdin from previous node'),
  metadata: z.object({
    latency: z.enum(['low', 'medium', 'high']).optional(),
    cost: z.enum(['low', 'medium', 'high']).optional(),
    reliability: z.number().min(0).max(1).optional(),
    retryCount: z.number().optional().default(0),
  }).optional(),
});

export type DAGNode = z.infer<typeof DAGNode>;

/**
 * Complete DAG for pipeline execution
 */
export const DAG = z.object({
  nodes: z.array(DAGNode),
  metadata: z.object({
    createdAt: z.number(),
    agentId: z.string(),
    originalCommand: z.string().optional(),
    optimized: z.boolean().optional().default(false),
  }).optional(),
});

export type DAG = z.infer<typeof DAG>;

/**
 * DAG execution result
 */
export const DAGExecutionResult = z.object({
  success: z.boolean(),
  nodeResults: z.record(z.any()),
  outputs: z.record(z.string()).describe('Output files and their content'),
  duration: z.number(),
  errors: z.array(z.object({
    nodeId: z.string(),
    error: z.string(),
    attempt: z.number(),
  })).optional(),
});

export type DAGExecutionResult = z.infer<typeof DAGExecutionResult>;

// ============================================================================
// Reinforcement Memory Types
// ============================================================================

/**
 * Command fix memory for reinforcement learning
 */
export const FixMemory = z.object({
  id: z.string(),
  pattern: z.string().describe('Normalized command pattern'),
  error: z.string(),
  originalCommand: z.string(),
  fixedCommand: z.string(),
  successRate: z.number().min(0).max(1),
  uses: z.number().default(1),
  lastUsed: z.number(),
  errorType: z.string().optional(),
});

export type FixMemory = z.infer<typeof FixMemory>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a bash execution event
 */
export function createBashExecutionEvent(
  command: string,
  agentId: string,
  options?: Partial<Omit<BashExecutionEvent, 'type' | 'command' | 'agentId'>>
): BashExecutionEvent {
  return {
    type: 'BASH_EXECUTION',
    command,
    agentId,
    persist: true,
    selfHeal: true,
    maxRetries: 3,
    ...options,
  };
}

/**
 * Create a bash failure context
 */
export function createBashFailureContext(
  result: BashExecutionResult,
  files: string[],
  attempt: number
): BashFailureContext {
  return {
    command: result.command,
    stderr: result.stderr,
    stdout: result.stdout,
    exitCode: result.exitCode,
    workingDir: result.workingDir,
    files,
    attempt,
  };
}

/**
 * Create a DAG node
 */
export function createDAGNode(
  id: string,
  type: DAGNodeType,
  command: string,
  dependsOn: string[] = []
): DAGNode {
  return {
    id,
    type,
    command,
    dependsOn,
    metadata: {
      latency: 'medium',
      cost: 'low',
      reliability: 0.95,
    },
  };
}

/**
 * Create a complete DAG from nodes
 */
export function createDAG(
  nodes: DAGNode[],
  agentId: string,
  originalCommand?: string
): DAG {
  return {
    nodes,
    metadata: {
      createdAt: Date.now(),
      agentId,
      originalCommand,
      optimized: false,
    },
  };
}
