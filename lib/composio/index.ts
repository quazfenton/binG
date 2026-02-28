/**
 * Composio Module
 * 
 * Provides Composio integration for tool access and management.
 */

export { composioSessionManager, ComposioSessionManager } from './session-manager';
export { composioAuthManager, ComposioAuthManager } from './auth-manager';
export { composioMCPIntegration, createComposioMCPIntegration } from './mcp-integration';
export { executionHistory, ComposioExecutionHistory, createExecutionHistory, trackExecution } from './execution-history';
export { toolkitManager, ComposioToolkitManager, createToolkitManager, getAvailableTools } from './toolkit-manager';
export { composioSubscriptionManager, ComposioSubscriptionManager, createSubscriptionManager, subscribe } from './resource-subscription';
export { composioPromptManager, ComposioPromptManager, createPromptManager, PromptTemplates } from './prompt-management';

export type { SessionManagerConfig } from './session-manager';
export type { AuthManagerConfig } from './auth-manager';
export type { MCPIntegrationConfig } from './mcp-integration';
export type { ExecutionRecord, ExecutionStats } from './execution-history';
export type { ToolkitInfo, ToolkitConfig } from './toolkit-manager';
export type { SubscriptionEvent, ResourceSubscription, SubscriptionEventType } from './resource-subscription';
export type { PromptTemplate, PromptExecutionResult } from './prompt-management';
