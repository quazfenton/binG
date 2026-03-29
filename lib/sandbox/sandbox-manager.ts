/**
 * @deprecated Use lib/sandbox/core-sandbox-service.ts for production cloud providers
 * or lib/sandbox/local-sandbox-manager.ts for local development
 *
 * This file is kept for backward compatibility only.
 * The sandbox-manager.ts has been renamed to local-sandbox-manager.ts to clarify
 * its purpose as a local filesystem-based sandbox implementation.
 *
 * For production use, prefer:
 * - lib/sandbox/core-sandbox-service.ts - Cloud providers (Daytona, Blaxel, Sprites, etc.)
 * - lib/sandbox/sandbox-orchestrator.ts - Multi-provider coordination
 *
 * Migration guide:
 * ```typescript
 * // Before
 * import { SandboxManager } from '@/lib/sandbox/sandbox-manager';
 *
 * // After - For local development
 * import { SandboxManager } from '@/lib/sandbox/local-sandbox-manager';
 *
 * // After - For production (recommended)
 * import { coreSandboxService } from '@/lib/sandbox/core-sandbox-service';
 * ```
 *
 * @see lib/sandbox/local-sandbox-manager.ts - Local filesystem sandbox (this implementation)
 * @see lib/sandbox/core-sandbox-service.ts - Production cloud providers
 * @see lib/sandbox/sandbox-orchestrator.ts - Multi-provider orchestration
 */

// Re-export from local-sandbox-manager for backward compatibility
export {
  SandboxManager,
  type SandboxConfig,
  type Sandbox,
  type ExecResult,
  type FileEntry,
  sandboxManager,
} from './local-sandbox-manager';
