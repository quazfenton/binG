/**
 * Agent Orchestration Module - Consolidated Index
 *
 * Unified exports for all agent orchestration components including:
 * - Session management with background jobs
 * - Execution graph for task tracking
 * - Workforce management with YAML persistence
 * - Mastra workflow integration
 * - Multi-agent collaboration
 * - Stateful agent with Plan-Act-Verify
 * - HITL (Human-in-the-Loop) system
 *
 * This index provides a single import point for all orchestration functionality.
 *
 * @example
 * ```typescript
 * import {
 *   sessionManager,
 *   executionGraphEngine,
 *   workforceManager,
 *   mastraWorkflowIntegration,
 *   multiAgentCollaboration,
 *   statefulAgent,
 *   hitlManager,
 * } from '@bing/shared/agent/orchestration';
 *
 * // Start session with background jobs
 * const session = await sessionManager.getOrCreateSession(userId, conversationId);
 * await sessionManager.startBackgroundJob(session.id, {
 *   command: 'npm run dev',
 *   interval: 30,
 * });
 *
 * // Execute workflow
 * const result = await mastraWorkflowIntegration.executeWorkflow('code-agent', {
 *   task: 'Implement authentication',
 *   ownerId: userId,
 * });
 * ```
 */

import { sessionManager } from '@/lib/session/session-manager';
import { executionGraphEngine } from './execution-graph';
import { enhancedBackgroundJobsManager } from './enhanced-background-jobs';
import { workforceManager } from './workforce-manager';
import { mastraWorkflowIntegration } from './mastra-workflow-integration';

// ============================================================================
// Session Management
// ============================================================================

export {
  sessionManager,
  agentSessionManager, // Deprecated backward compatibility
  openCodeV2SessionManager, // Deprecated backward compatibility
  SessionManager,
  type Session,
  type SessionConfig,
  type SessionQuota,
} from '@/lib/session/session-manager';

export {
  sessionStateBridge,
  type SessionStateBridge,
  type StateStorageEntry,
  type PersistStateResult,
  type RestoreStateResult,
} from '@/lib/session/state-bridge';

// ============================================================================
// Execution Graph
// ============================================================================

export {
  executionGraphEngine,
  ExecutionGraphEngine,
  type ExecutionGraph,
  type ExecutionNode,
  type ExecutionNodeType,
  type NodeStatus,
  type GraphExecutionResult,
} from './execution-graph';

// ============================================================================
// Background Jobs
// ============================================================================

export {
  enhancedBackgroundJobsManager,
  EnhancedBackgroundJobsManager,
  type EnhancedJobConfig,
  type EnhancedJob,
  type JobExecutionResult,
  type JobExecutor,
} from './enhanced-background-jobs';

// ============================================================================
// Workforce Management
// ============================================================================

export {
  workforceManager,
  type SpawnTaskInput,
} from './workforce-manager';

export {
  loadState as loadWorkforceState,
  saveState as saveWorkforceState,
  addTask as addWorkforceTask,
  updateTask as updateWorkforceTask,
  type WorkforceTask,
  type WorkforceState,
  type TaskStatus,
} from './workforce-state';

// ============================================================================
// Mastra Workflow Integration
// ============================================================================

export {
  mastraWorkflowIntegration,
  MastraWorkflowIntegration,
  type MastraTaskProposal,
  type MastraTaskReview,
  type MastraWorkflowResult,
  type MastraIntegrationConfig,
} from './mastra-workflow-integration';

// ============================================================================
// Multi-Agent Collaboration
// ============================================================================

export {
  MultiAgentCollaboration,
  createMultiAgentCollaboration,
  quickCollaborativeExecute,
  type AgentRole,
  type AgentState,
  type Task,
  type AgentMessage,
  type CollaborationResult,
} from './multi-agent-collaboration';

// ============================================================================
// Task Router
// ============================================================================

export {
  taskRouter,
  type TaskRequest,
  type TaskType,
  type AdvancedTaskType,
} from './task-router';

// ============================================================================
// Agent Kernel (OS-like Scheduler)
// ============================================================================

export {
  AgentKernel,
  getAgentKernel,
  createAgentKernel,
  startAgentKernel,
  stopAgentKernel,
  type AgentType,
  type AgentPriority,
  type AgentStatus,
  type AgentConfig,
  type Agent,
  type AgentResources,
  type AgentQuota,
  type WorkItem,
  type KernelStats,
} from './agent-kernel';

// ============================================================================
// Unified Agent
// ============================================================================

export {
  UnifiedAgent,
  createAgent,
  type UnifiedAgentConfig,
  type AgentSession,
  type TerminalOutput,
  type CodeExecutionResult,
} from './unified-agent';

// ============================================================================
// Stateful Agent (from Orchestra)
// ============================================================================

export {
  StatefulAgent,
  createStatefulAgent,
  runStatefulAgent,
  type StatefulAgentOptions,
  type StatefulAgentResult,
  type Task as StatefulTask,
  type TaskGraph,
  type MemoryNode,
  type MemoryGraph,
} from '@/lib/orchestra/stateful-agent/agents/stateful-agent';

// ============================================================================
// HITL (Human-in-the-Loop)
// ============================================================================

export {
  hitlManager,
  createHITLWorkflowManager,
  requireApproval,
  requireApprovalWithWorkflow,
  evaluateWorkflow,
  evaluateActiveWorkflow,
  HITLWorkflowManager,
} from '@/lib/orchestra/stateful-agent/human-in-the-loop';

// HITL audit logger is available via hitlManager

// ============================================================================
// Unified Agent Service
// ============================================================================

export {
  processUnifiedAgentRequest,
  checkProviderHealth,
  getAvailableModes,
  type UnifiedAgentResult,
  type ProviderHealth,
} from '@/lib/orchestra/unified-agent-service';

// ============================================================================
// Agent Loop
// ============================================================================

export {
  runAgentLoop,
} from '@/lib/orchestra/agent-loop';

// ============================================================================
// Reflection Engine
// ============================================================================

export {
  reflectionEngine,
  type ReflectionPerspective,
  type ReflectionResult,
  type ReflectionConfig,
} from '@/lib/orchestra/reflection-engine';

// ============================================================================
// Simulated Orchestration (Deprecated)
// ============================================================================

export {
  simulatedOrchestrator,
  type TaskProposal,
  type TaskReview,
} from './simulated-orchestration';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Initialize all orchestration components
 * Call this at application startup
 */
export async function initializeOrchestration(): Promise<void> {
  // Initialize session manager with background jobs
  enhancedBackgroundJobsManager.setSessionManager(sessionManager);
  enhancedBackgroundJobsManager.setExecutionGraphEngine(executionGraphEngine);
  
  // Initialize workforce manager with execution graph
  workforceManager.setExecutionGraphEngine(executionGraphEngine);
  
  // Log initialization
  const logger = await import('../utils/logger').then(m => m.createLogger('Orchestration:Init'));
  logger.info('Agent orchestration initialized');
}

/**
 * Get orchestration statistics
 */
export function getOrchestrationStats(): {
  sessions: {
    total: number;
    active: number;
  };
  backgroundJobs: {
    total: number;
    running: number;
  };
  workforceTasks: {
    total: number;
    pending: number;
    completed: number;
  };
  executionGraphs: {
    total: number;
    running: number;
  };
  mastraWorkflows: {
    activeWorkflows: number;
    totalProposals: number;
  };
} {
  const sessionStats = sessionManager.getStats();
  const backgroundJobsStats = enhancedBackgroundJobsManager.getStats();
  
  return {
    sessions: {
      total: sessionStats.totalSessions,
      active: sessionStats.activeSessions,
    },
    backgroundJobs: {
      total: backgroundJobsStats.total,
      running: backgroundJobsStats.running,
    },
    workforceTasks: {
      total: 0, // Would need to aggregate from all users
      pending: 0,
      completed: 0,
    },
    executionGraphs: {
      total: executionGraphEngine['graphs'].size,
      running: Array.from(executionGraphEngine['graphs'].values())
        .filter(g => g.status === 'running').length,
    },
    mastraWorkflows: mastraWorkflowIntegration.getStats(),
  };
}

/**
 * Shutdown all orchestration components gracefully
 */
export async function shutdownOrchestration(): Promise<void> {
  const logger = await import('../utils/logger').then(m => m.createLogger('Orchestration:Shutdown'));
  logger.info('Shutting down orchestration components');
  
  // Stop all background jobs
  await enhancedBackgroundJobsManager.shutdown();
  
  // Destroy all sessions
  const sessionIds = Array.from(sessionManager['sessionsById'].keys());
  for (const sessionId of sessionIds) {
    const session = sessionManager.getSessionById(sessionId);
    if (session) {
      await sessionManager.destroySession(session.userId, session.conversationId);
    }
  }
  
  logger.info('Orchestration shutdown complete');
}

// ============================================================================
// Cloud Deployment Service
// ============================================================================

export {
  cloudDeploymentService,
  CloudDeploymentService,
  type CloudDeployment,
  type CloudDeploymentConfig,
  type DeploymentResult,
  type CloudProvider,
} from '@/lib/sandbox/cloud-deployment-service';

// ============================================================================
// Workflow Templates
// ============================================================================

export {
  workflowTemplateService,
  WorkflowTemplateService,
  type WorkflowTemplate,
  type WorkflowStep,
  type WorkflowTemplateId,
  type TemplateExecutionConfig,
  type TemplateExecutionResult,
} from './workflow-templates';
