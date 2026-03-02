export {
  allTools,
  readFileTool,
  listFilesTool,
  createFileTool,
  applyDiffTool,
  execShellTool,
  syntaxCheckTool,
  requestApprovalTool,
  discoveryTool,
  createPlanTool,
  commitTool,
  rollbackTool,
  historyTool,
} from './sandbox-tools';

export { astDiffTool, AstDiffManager, analyzeAstStructure } from './ast-aware-diff';
export type { AstDiffInput, AstDiffResult } from './ast-aware-diff';

// Nango tools
export { nangoTools } from './nango-tools';
export { nangoSyncTools } from './nango-sync-tools';
export { nangoWebhookTools } from './nango-webhook-tools';
export { nangoConnectionManager } from './nango-connection';
export { nangoRateLimiter } from './nango-rate-limit';

export { ToolExecutor, createToolExecutor } from './tool-executor';
export type { ToolExecutorConfig, ToolExecution } from './tool-executor';

// Combined tools for AI SDK usage
import { allTools } from './sandbox-tools';
import { nangoTools } from './nango-tools';
import { nangoSyncTools } from './nango-sync-tools';
import { nangoWebhookTools } from './nango-webhook-tools';
import { astDiffTool } from './ast-aware-diff';

export const combinedTools = {
  ...allTools,
  ...nangoTools,
  ...nangoSyncTools,
  ...nangoWebhookTools,
  astDiff: astDiffTool,
};

export type { ToolResult, ToolContext } from './sandbox-tools';
