/**
 * Agent V2 Module
 *
 * OpenCode V2 Engine with Nullclaw integration.
 * Provides containerized agentic capabilities with per-user isolation.
 */

// Session Management
export {
  agentSessionManager,
  AgentSessionManager,
  type AgentSession,
  type AgentSessionConfig,
} from '../session/agent/agent-session-manager';

// Filesystem Bridge
export {
  agentFSBridge,
  AgentFSBridge,
  type SyncResult,
  type SyncOptions,
} from './agent-fs-bridge';

// Nullclaw Integration
export {
  nullclawIntegration,
  NullclawIntegration,
  type NullclawConfig,
  type NullclawTask,
  type NullclawStatus,
} from './nullclaw-integration';

// Cloud Offload
export {
  cloudAgentOffload,
  CloudAgentOffload,
  type CloudAgentConfig,
  type CloudAgentInstance,
  type CloudAgentResult,
} from './cloud-agent-offload';

// Task Router
export {
  taskRouter,
  type TaskRequest,
  type TaskRoutingResult,
} from './task-router';

// V2 Executor
export {
  executeV2Task,
  executeV2TaskStreaming,
  type V2ExecuteOptions,
} from './v2-executor';

// Workforce State + Manager
export {
  workforceManager,
} from './workforce-manager';
export {
  loadState,
  saveState,
  addTask,
  updateTask,
  type WorkforceTask,
  type WorkforceState,
} from './workforce-state';

// Stateful Agent (from orchestra) - Comprehensive Plan-Act-Verify agent
export {
  StatefulAgent,
  createStatefulAgent,
  runStatefulAgent,
  type StatefulAgentOptions,
  type StatefulAgentResult,
} from '@/lib/orchestra/stateful-agent';

// Execution Graph - DAG-based task execution with parallel support
export {
  executionGraphEngine,
  ExecutionGraphEngine,
  type ExecutionGraph,
  type ExecutionNode,
  type ExecutionNodeType,
  type NodeStatus,
  type GraphExecutionResult,
} from './execution-graph';

// Unified Agent - Multi-capability agent abstraction
export {
  createAgent,
  UnifiedAgent,
  type UnifiedAgentConfig,
  type AgentCapability,
} from './unified-agent';
