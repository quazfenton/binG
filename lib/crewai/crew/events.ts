/**
 * CrewAI Event Types
 * 
 * TypeScript equivalents for Python SDK event types.
 */

export interface BaseCrewAIEvent {
  timestamp: number;
}

export interface CrewKickoffStartedEvent extends BaseCrewAIEvent {
  type: 'crew_kickoff_started';
  crew_name: string;
  inputs: Record<string, any>;
}

export interface CrewKickoffCompletedEvent extends BaseCrewAIEvent {
  type: 'crew_kickoff_completed';
  crew_name: string;
  output: string;
  duration_ms: number;
}

export interface CrewPlanCreatedEvent extends BaseCrewAIEvent {
  type: 'crew_plan_created';
  crew_name: string;
  plan: string;
}

export interface AgentExecutionStartedEvent extends BaseCrewAIEvent {
  type: 'agent_execution_started';
  agent_role: string;
  task_description: string;
}

export interface AgentExecutionCompletedEvent extends BaseCrewAIEvent {
  type: 'agent_execution_completed';
  agent_role: string;
  output: string;
  tokens_used?: number;
}

export interface AgentExecutionErrorEvent extends BaseCrewAIEvent {
  type: 'agent_execution_error';
  agent_role: string;
  error: string;
}

export interface AgentDelegationEvent extends BaseCrewAIEvent {
  type: 'agent_delegation';
  delegating_agent: string;
  delegated_agent: string;
  task: string;
}

export interface AgentHandoffEvent extends BaseCrewAIEvent {
  type: 'agent_handoff';
  from_agent: string;
  to_agent: string;
  reason?: string;
}

export interface TaskExecutionStartedEvent extends BaseCrewAIEvent {
  type: 'task_execution_started';
  task_id: string;
  task_description: string;
  agent_role: string;
}

export interface TaskExecutionCompletedEvent extends BaseCrewAIEvent {
  type: 'task_execution_completed';
  task_id: string;
  task_description: string;
  agent_role: string;
  output: string;
  duration_ms: number;
}

export interface TaskExecutionErrorEvent extends BaseCrewAIEvent {
  type: 'task_execution_error';
  task_id: string;
  task_description: string;
  error: string;
}

export interface ToolExecutionStartedEvent extends BaseCrewAIEvent {
  type: 'tool_execution_started';
  tool_name: string;
  tool_input: Record<string, any>;
}

export interface ToolExecutionCompletedEvent extends BaseCrewAIEvent {
  type: 'tool_execution_completed';
  tool_name: string;
  tool_output: any;
  duration_ms: number;
}

export interface ToolExecutionErrorEvent extends BaseCrewAIEvent {
  type: 'tool_execution_error';
  tool_name: string;
  error: string;
}

export interface MemoryRetrievalEvent extends BaseCrewAIEvent {
  type: 'memory_retrieval';
  memory_type: 'short' | 'long' | 'entity';
  retrieved_context: string;
}

export interface KnowledgeRetrievalEvent extends BaseCrewAIEvent {
  type: 'knowledge_retrieval';
  knowledge_source: string;
  retrieved_documents: number;
}

export interface LLMCallStartedEvent extends BaseCrewAIEvent {
  type: 'llm_call_started';
  model: string;
  messages_count: number;
}

export interface LLMCallCompletedEvent extends BaseCrewAIEvent {
  type: 'llm_call_completed';
  model: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
}

export interface LLMCallErrorEvent extends BaseCrewAIEvent {
  type: 'llm_call_error';
  model: string;
  error: string;
}

export type CrewAIEvent =
  | CrewKickoffStartedEvent
  | CrewKickoffCompletedEvent
  | CrewPlanCreatedEvent
  | AgentExecutionStartedEvent
  | AgentExecutionCompletedEvent
  | AgentExecutionErrorEvent
  | AgentDelegationEvent
  | AgentHandoffEvent
  | TaskExecutionStartedEvent
  | TaskExecutionCompletedEvent
  | TaskExecutionErrorEvent
  | ToolExecutionStartedEvent
  | ToolExecutionCompletedEvent
  | ToolExecutionErrorEvent
  | MemoryRetrievalEvent
  | KnowledgeRetrievalEvent
  | LLMCallStartedEvent
  | LLMCallCompletedEvent
  | LLMCallErrorEvent;

export interface EventListenerConfig {
  onCrewKickoffStarted?: (event: CrewKickoffStartedEvent) => void | Promise<void>;
  onCrewKickoffCompleted?: (event: CrewKickoffCompletedEvent) => void | Promise<void>;
  onCrewPlanCreated?: (event: CrewPlanCreatedEvent) => void | Promise<void>;
  onAgentExecutionStarted?: (event: AgentExecutionStartedEvent) => void | Promise<void>;
  onAgentExecutionCompleted?: (event: AgentExecutionCompletedEvent) => void | Promise<void>;
  onAgentExecutionError?: (event: AgentExecutionErrorEvent) => void | Promise<void>;
  onAgentDelegation?: (event: AgentDelegationEvent) => void | Promise<void>;
  onAgentHandoff?: (event: AgentHandoffEvent) => void | Promise<void>;
  onTaskExecutionStarted?: (event: TaskExecutionStartedEvent) => void | Promise<void>;
  onTaskExecutionCompleted?: (event: TaskExecutionCompletedEvent) => void | Promise<void>;
  onTaskExecutionError?: (event: TaskExecutionErrorEvent) => void | Promise<void>;
  onToolExecutionStarted?: (event: ToolExecutionStartedEvent) => void | Promise<void>;
  onToolExecutionCompleted?: (event: ToolExecutionCompletedEvent) => void | Promise<void>;
  onToolExecutionError?: (event: ToolExecutionErrorEvent) => void | Promise<void>;
  onMemoryRetrieval?: (event: MemoryRetrievalEvent) => void | Promise<void>;
  onKnowledgeRetrieval?: (event: KnowledgeRetrievalEvent) => void | Promise<void>;
  onLLMCallStarted?: (event: LLMCallStartedEvent) => void | Promise<void>;
  onLLMCallCompleted?: (event: LLMCallCompletedEvent) => void | Promise<void>;
  onLLMCallError?: (event: LLMCallErrorEvent) => void | Promise<void>;
}

export function createEventEmitter(eventConfig: EventListenerConfig) {
  const listeners: Array<(event: CrewAIEvent) => void | Promise<void>> = [];

  if (eventConfig.onCrewKickoffStarted) {
    listeners.push(eventConfig.onCrewKickoffStarted as (event: CrewAIEvent) => void | Promise<void>);
  }
  if (eventConfig.onCrewKickoffCompleted) {
    listeners.push(eventConfig.onCrewKickoffCompleted as (event: CrewAIEvent) => void | Promise<void>);
  }
  if (eventConfig.onAgentExecutionStarted) {
    listeners.push(eventConfig.onAgentExecutionStarted as (event: CrewAIEvent) => void | Promise<void>);
  }
  if (eventConfig.onAgentExecutionCompleted) {
    listeners.push(eventConfig.onAgentExecutionCompleted as (event: CrewAIEvent) => void | Promise<void>);
  }
  if (eventConfig.onTaskExecutionStarted) {
    listeners.push(eventConfig.onTaskExecutionStarted as (event: CrewAIEvent) => void | Promise<void>);
  }
  if (eventConfig.onTaskExecutionCompleted) {
    listeners.push(eventConfig.onTaskExecutionCompleted as (event: CrewAIEvent) => void | Promise<void>);
  }
  if (eventConfig.onToolExecutionStarted) {
    listeners.push(eventConfig.onToolExecutionStarted as (event: CrewAIEvent) => void | Promise<void>);
  }
  if (eventConfig.onToolExecutionCompleted) {
    listeners.push(eventConfig.onToolExecutionCompleted as (event: CrewAIEvent) => void | Promise<void>);
  }

  return {
    emit: async (event: CrewAIEvent) => {
      for (const listener of listeners) {
        try {
          await listener(event);
        } catch (error) {
          console.error('Event listener error:', error);
        }
      }
    },
    listeners,
  };
}
