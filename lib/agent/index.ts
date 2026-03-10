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
} from './agent-session-manager';

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
