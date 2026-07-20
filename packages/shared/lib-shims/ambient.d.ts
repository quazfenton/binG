/**
 * Decoupling epic ④ (2026-07-16) — Ambient module declarations for path-alias
 * override in /opt/bing/packages/shared/tsconfig.json.
 *
 * The package-level tsconfig overrides `paths: { "@/*": ["./lib-shims/*"] }`
 * which DROPS the parent tsconfig's fallback into web/lib/* — meaning real
 * source files for `@/lib/X` imports are no longer resolvable. Without an
 * ambient declaration, tsc would error on every `@/lib/X` site. Below,
 * each distinct `@/lib/X` import path consumed by packages/shared/* is
 * declared as an ambient module with `any`-typed exports. This satisfies the
 * type system without introducing runtime side-effects; runtime imports
 * importing via these paths are out of scope (covered by the broader
 * monorepo-split epic tracked separately).
 *
 * Maintenance contract (note: JSDoc avoids glob patterns to keep TypeScript's
 *  * comment lexer happy — `**` followed by `/*.ts` would prematurely close
 *  * the JSDoc block):
 *   - Each `declare module` entry MUST correspond to one `@/lib/X` import
 *     site somewhere under packages/shared (agent, FS, auth, lib subdirs).
 *   - When packages/shared adds a NEW `@/lib/Y` import, add a corresponding
 *     `declare module '@/lib/Y'` entry here so tsc still produces exit 0.
 *   - Resolution path: tsc first looks for a real .ts file under lib-shims
 *     matching the path (per the path-override); failing that, it falls
 *     back to the ambient declarations below. No real source files are
 *     required for the ambient path to satisfy tsc.
 *
 * Two declaration styles co-exist intentionally:
 *   1. TYPED (with explicit `any`-typed exports) — provides IDE hint for the
 *      first 30 well-known import sites. Used when the imported name and
 *      symbol shape are predictable (Logger interface, MCP entry-points).
 *   2. BODY-LESS (no body, no exports) — used for the 9 second-round paths
 *      discovered during validation. Body-less form treats the entire
 *      module as `any`-typed so consumer property access NEVER errors
 *      (verified empirically that typed form with a partial surface
 *      causes TS2339 when mirror files access undeclared members).
 *
 * Why no `@bing/shared/*` wildcards: the prefix-glob ambient
 * (`declare module '@bing/shared/agent/*';`) was tested in the second-round
 * pass and did NOT suppress mirror semantic-resolved loading. tsc still
 * walked into the mirror copies and reported ~26 TS2322 errors against
 * agent-kernel.ts body contents. Therefore wildcards were removed.
 */

// --- First-round typed declarations: 30 well-known @/lib/X import sites ---

declare module '@/lib/sandbox/types' {
  export type ExecutionPolicy = any;
  export type PreviewInfo = any;
  export const determineExecutionPolicy: (...args: unknown[]) => ExecutionPolicy;
  export type SandboxHandle = any;
}

declare module '@/lib/utils/logger' {
  export const createLogger: (name: string) => {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
    trace: (...args: unknown[]) => void;
    fatal: (...args: unknown[]) => void;
    child: (name: string) => ReturnType<typeof createLogger>;
  };
}



declare module '@/lib/sandbox/providers' {
  export const getSandboxProvider: (...args: unknown[]) => Promise<any>;
}

declare module '@/lib/sandbox/providers/sandbox-provider' {
  export type SandboxHandle = any;
}

declare module '@/lib/sandbox/sandbox-service-bridge' {
  export const sandboxBridge: any;
}

declare module '@/lib/sandbox/provider-router' {
  export const providerRouter: any;
  export const latencyTracker: any;
}

declare module '@/lib/sandbox/provider-health' {
  export const providerHealthTracker: any;
}

declare module '@/lib/mcp' {
  export const getMCPToolsForAI_SDK: (...args: unknown[]) => Promise<any[]>;
  export const callMCPToolFromAI_SDK: (...args: unknown[]) => Promise<any>;
  export const MCP_AGENT_TIMEOUT_MS: number;
}

declare module '@/lib/mcp/result-format' {
  export const formatValueForMCPText: (...args: unknown[]) => string;
}

declare module '@/lib/tools' {
  export const getToolManager: (...args: unknown[]) => any;
}

declare module '@/lib/tools/select-tool-plan' {
  export type SelectToolPlanResult = any;
  export const selectToolPlan: (...args: unknown[]) => SelectToolPlanResult;
}

declare module '@/lib/tools/capabilities' {
  export const ALL_CAPABILITIES: any[];
  export type CapabilityDefinition = any;
}

declare module '@/lib/tools/tool-integration-system' {
  export type ToolIntegrationManager = any;
}

declare module '@/lib/types/tool-invocation' {
  export const normalizeToolInvocation: <T>(x: T) => T;
  export type ToolInvocation = any;
}

declare module '@/lib/session/session-manager' {
  export const sessionManager: any;
}

declare module '@/lib/session/agent/agent-session-manager' {
  export const agentSessionManager: any;
}

declare module '@/lib/terminal/enhanced-terminal-manager' {
  export const enhancedTerminalManager: any;
}

declare module '@/lib/computer/e2b-desktop-provider-enhanced' {
  export type DesktopHandle = any;
}

declare module '@/lib/virtual-filesystem/virtual-filesystem-service' {
  export const virtualFilesystem: any;
}

declare module '@/lib/virtual-filesystem/scope-utils' {
  export const normalizeSessionId: (s: string | undefined | null) => string;
}

declare module '@/lib/events/schema' {
  export type OrchestrationProgressEvent = any;
  export type AnyEvent = any;
  export type EventTypes = any;
  export const AnyEvent: any;
}

declare module '@/lib/events/bus' {
  export const emitEvent: (...args: unknown[]) => void;
}

declare module '@/lib/redis/agent-service' {
  export const getRedisAgentService: (...args: unknown[]) => any;
  export type AgentJob = any;
  export type AgentEvent = any;
}

declare module '@/lib/utils/ndjson-parser' {
  export const createNDJSONParser: (...args: unknown[]) => any;
}

declare module '@/lib/orchestra/mastra' {
  export const getMastra: (...args: unknown[]) => any;
}

declare module '@/lib/orchestra/stateful-agent/agents/verification' {
  export const verifyChanges: (...args: unknown[]) => Promise<any>;
}

declare module '@/lib/chat/vercel-ai-streaming' {
  export const getVercelModel: (...args: unknown[]) => any;
}

declare module '@/lib/chat/message-sanitizer' {
  export const sanitizeMessages: (...args: unknown[]) => any[] | string;
}

declare module '@/lib/errors/logging-utils' {
  export const createOriginStack: (...args: unknown[]) => any;
  export const redactArgsForLogging: (...args: unknown[]) => any;
}



// --- Second-round body-less declarations: 10 paths discovered post first validator run (+ crewai for path-alias pilot) ---
// Body-less form is used because the consumer (mirror file body) accesses a
// partial subset of these modules' exports. Typed declaration with explicit
// `export const X` would force every property access into the typed surface
// and surface TS2339 errors for undeclared members. Body-less is permissive.
declare module '@/lib/events/trigger/handlers/research';
declare module '@/lib/orchestra/mastra/workflows/code-agent-workflow';
declare module '@/lib/orchestra/mastra/workflows/hitl-workflow';
declare module '@/lib/orchestra/mastra/workflows/parallel-workflow';
declare module '@/lib/sandbox/spawn/opencode-cli';
declare module '@/lib/virtual-filesystem/sync/sandbox-filesystem-sync';
declare module '@/lib/providers/model-ranker';
declare module '@/lib/orchestra/unified-agent-service';
declare module '@/lib/virtual-filesystem/filesystem-diffs';
declare module '@/lib/crewai';
