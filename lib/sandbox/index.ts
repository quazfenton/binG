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

// Enhanced terminal manager with desktop/MCP support
export { EnhancedTerminalManager } from './enhanced-terminal-manager';

// Enhanced sandbox tools with computer use, MCP, desktop operations
export { ENHANCED_SANDBOX_TOOLS, TOOL_CATEGORIES, getToolsByCategory, isToolAvailable, getToolByName } from './enhanced-sandbox-tools';

// Enhanced port detection
export { enhancedPortDetector, detectPorts, getDetectedPorts, clearDetectedPorts, type PortDetectionResult } from './enhanced-port-detector';

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
