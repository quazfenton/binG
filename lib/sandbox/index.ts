// Re-export the sandbox module for use within binG0
export { SandboxServiceBridge as SandboxService, sandboxBridge } from './sandbox-service-bridge';
export type { WorkspaceSession, SandboxConfig } from './types';
export type { ToolResult, PreviewInfo, AgentMessage } from './types';
export { runAgentLoop } from './agent-loop';
export { sandboxEvents } from './sandbox-events';
export type { SandboxEvent, SandboxEventType } from './sandbox-events';
export { terminalManager, TerminalManager } from './terminal-manager';
export { provisionBaseImage, warmPool, WarmPool } from './base-image';
export type { BasePackageSet, ProvisionResult } from './base-image';
export { sandboxFilesystemSync } from './sandbox-filesystem-sync';

// Resource monitoring
export {
  SandboxResourceMonitor,
  createResourceMonitor,
  quickMonitor,
} from './resource-monitor';

export type {
  ResourceMetrics,
  ResourceAlert,
  ScalingRecommendation,
  MonitoringConfig,
} from './resource-monitor';

// Auto-scaling
export {
  AutoScalingManager,
  createAutoScalingManager,
  ScalingPresets,
} from './auto-scaling';

export type {
  ScalingPolicy,
  ScalingDecision,
  ResourceUsage,
  ScalingPolicyType,
  ScalingAction,
} from './auto-scaling';
