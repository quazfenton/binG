/**
 * MCP timeout constants — single source of truth for all ceiling values.
 *
 * Moved from inline literals to a single module so:
 *   1. A future retune (e.g. 60_000 → 90_000) is a one-line change that
 *      propagates to every consumer automatically.
 *   2. A vitest lock (`__tests__/timeouts.test.ts`) can assert the value
 *      AND assert each consumer imports the constant — no stale copy.
 */

/**
 * MCP agent tool-call timeout (ms). Applied as the outer-most ceiling on
 * every `callMCPToolFromAI_SDK` invocation that does NOT have its own
 * upstream AbortSignal (the 3 back-port sites: unified-agent.ts,
 * opencode-direct.ts, task-router.ts). Also wired into route.ts
 * `agentTurnSignal` so the chat route's watchdog respects the same 60s
 * budget regardless of which dispatch path resolves the agent turn.
 */
export const MCP_AGENT_TIMEOUT_MS = 60_000;

/**
 * Per-server ceiling for the initializeMCPForArchitecture1 probe loop.
 * Each HTTP transport's listTools() probe gets an
 * AbortSignal.timeout(INIT_PROBE_TIMEOUT_MS) so a single dead server no
 * longer holds init open for the full transport.timeout (30_000ms).
 */
export const INIT_PROBE_TIMEOUT_MS = 5_000;
