/**
 * Register MCP Tools
 *
 * Auto-discovers and registers tools from MCP servers at runtime.
 *
 * Features:
 * - Auto-discovery from configured MCP servers
 * - Dynamic tool registration
 * - Capability mapping
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';
import { logToolCount } from '../bootstrap-health';

const logger = createLogger('Tools:MCP-Bootstrap');

/**
 * Detect a transport-level fetch failure that retrying on the same URL
 * cannot recover from. Used to short-circuit the gateway retry loop so we
 * don't waste 1s+2s+4s=7s on a TCP blackhole / DNS failure / localhost
 * port closed — every retry has the same outcome, so retries are pure
 * latency. Detects:
 *   - `fetch failed` (plain Node fetch message, no cause) → TCP blackhole signature
 *     (kernel SYN timeout when the host is unreachable)
 *   - `err.cause.code in {ECONN*, ENOTFOUND, EAI_*, ETIMEDOUT, UND_ERR_*}` →
 *     standard Node.js + undici transport-layer codes
 *   - `err.cause.code === 'ECONNREFUSED'` / `'ENOTFOUND'` etc. carry when
 *     the underlying `fetch` wraps the cause correctly.
 */
function isTransportLevelFetchError(err: any): boolean {
  if (!err) return false;
  // Chat-hang-fix #4 (PR-2): AbortError from a caller-provided
  // AbortSignal.timeout() (mirrored onto the internal AbortController in
  // lib/mcp/client.ts). The caller already gave up — retrying with the
  // same URL is futile. Detecting by err.name is portable across all
  // Node versions that surface AbortError on rejected fetches.
  if (err?.name === 'AbortError') return true;
  // Plain "fetch failed" with no cause = TCP blackhole signature.
  // This is the exact shape produced by Node 18+ native fetch when the
  // kernel TCP SYN times out (no RST, no DNS error, no TLS handshake).
  if (typeof err.message === 'string' && /fetch failed/i.test(err.message)) {
    return true;
  }
  // Node.js + undici tag the underlying transport error on err.cause.code.
  // Cover the standard transport-layer codes (Linux errno + Node additions).
  const code = err?.cause?.code;
  if (typeof code === 'string') {
    if (/^ECONN/.test(code)) return true;       // ECONNREFUSED, ECONNRESET, ECONNABORTED, …
    if (/^ENOTFOUND$/.test(code)) return true;  // DNS resolution failed
    if (/^EAI_/.test(code)) return true;       // getaddrinfo errors
    if (/^ETIMEDOUT$/.test(code)) return true;  // Operation timed out
    if (/^UND_ERR_/.test(code)) return true;   // undici-specific (UND_ERR_SOCKET, …)
  }
  return false;
}

/**
 * Register MCP tools from configured servers
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerMCPTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  let count = 0;

  try {
    // Check if MCP is configured
    const mcpGatewayUrl = process.env.MCP_GATEWAY_URL;
    const mcpCliPort = process.env.MCP_CLI_PORT;

    if (!mcpGatewayUrl && !mcpCliPort) {
      logger.debug('MCP not configured (no MCP_GATEWAY_URL or MCP_CLI_PORT)');
      return 0;
    }

    // Import MCP client
    const { MCPClient } = await import('../../mcp/client');

    // Bug-fix: gateway and CLI tool counts are tracked in separate locals so
    // the per-branch `logToolCount` call reports the right number. Previously
    // a single shared `count` variable caused the MCP-CLI line to report the
    // combined gateway+CLI total.
    let gatewayCount = 0;
    let cliCount = 0;

    // Try to connect to MCP gateway
    if (mcpGatewayUrl) {
      try {
        const client = new MCPClient({
          type: 'sse' as any,
          url: mcpGatewayUrl,
          authToken: process.env.MCP_GATEWAY_AUTH_TOKEN,
          // Chat-hang-fix #4: attach a 2s AbortSignal so a dead-socket TCP
          // blackhole (e.g. localhost:8261 unreachable) fast-fails in 2s
          // instead of waiting on the kernel SYN timeout (~75s). The signal
          // is mirrored onto MCPClient's internal AbortController in
          // lib/mcp/client.ts (NodeEventSource constructor accepts a
          // `signal` option) — so the underlying `fetch()` aborts cleanly
          // and the connectSSE promise rejects with `fetch failed` /
          // `AbortError` rather than waiting indefinitely. Combined with
          // the prior transport-level skip (isTransportLevelFetchError),
          // this collapses the per-request stall from ~33s to <1s when
          // MCP_GATEWAY_URL points at a dead socket.
          signal: AbortSignal.timeout(2000),
        } as any);


        // Retry connection with exponential backoff (up to ~15s total) for
        // TRANSIENT failures (auth handshake glitch, recv hangup mid-read,
        // gateway warm-up race). Chat-hang-fix #4: when the error is a
        // transport-level failure (TCP blackhole, DNS, ECONNREFUSED,
        // undici socket error), retrying with the SAME URL is futile —
        // every retry has the same outcome — so we short-circuit the loop
        // immediately. This collapses the worst-case bootstrap stall from
        // 7s of pure waste down to ~0ms when the gateway port is dead.
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            await client.connect();
            lastError = null;
            break; // Connected successfully
          } catch (err: any) {
            lastError = err;
            if (isTransportLevelFetchError(err)) {
              logger.debug('[MCP-Bootstrap] Transport-level fetch failure — skipping retry loop', {
                error: err.message,
                cause: err?.cause?.code,
              });
              break;
            }
            if (attempt < 3) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
              logger.debug('[MCP-Bootstrap] Retrying gateway connection', {
                attempt: attempt + 1,
                delayMs: delay,
                error: err.message,
              });
              await new Promise(r => setTimeout(r, delay));
            }
          }
        }
        if (lastError) throw lastError;

        // List available tools
        const tools = await client.listTools();

        for (const tool of tools) {
          // Register tool with capability mapping
          const capability = mapMCPToolToCapability(tool.name);

          await registry.registerTool({
            name: `mcp:${tool.name}`,
            capability: capability,
            provider: 'mcp',
            handler: async (args: any, context: any) => {
              return await (client as any).callTool(tool.name, args) as any;
            },
            metadata: {
              latency: 'medium',
              cost: 'low',
              reliability: 0.95,
              tags: ['mcp', tool.name],
            },
            permissions: [`mcp:${tool.name}`],
          });

          count++;
          gatewayCount++;
          logger.debug(`Registered MCP tool: ${tool.name} → ${capability}`);
        }

        await client.disconnect();
        // Bug #12/#13/#24/#34: emit [WARN] when MCP gateway returned 0 tools
        logToolCount(logger, { registry: 'MCP gateway', count: gatewayCount });
      } catch (error: any) {
        // Chat-hang-fix #5: promote to warn so MCP-gateway outages are
        // visible at the project's default log level (no need for
        // LOG_LEVEL=debug to see infrastructure failures). The
        // `infrastructure_degraded: true` field lets observability
        // tooling alert on this state independent of any chat-route
        // error counters. Retry-skip on transport-level failures
        // (fetch failed / UND_ERR_SOCKET / ECONN* / DNS) was already
        // wired in the prior Chat-hang-fix #4 turn via the
        // isTransportLevelFetchError() helper.
        logger.warn('[MCP-Bootstrap] MCP gateway unavailable — degraded mode', {
          error: error.message,
          infrastructure_degraded: true,
          transport: 'sse',
        });
      }
    }

    // Try to connect to MCP CLI (local) — requires both MCP_CLI_PORT and MCP_CLI_COMMAND
    const mcpCliCommand = process.env.MCP_CLI_COMMAND;
    if (mcpCliPort && mcpCliCommand) {
      try {
        const client = new MCPClient({
          type: 'stdio',
          command: mcpCliCommand,
          args: (process.env.MCP_CLI_ARGS || '').split(' ').filter(Boolean),
          port: parseInt(mcpCliPort),
        } as any);

        await client.connect();

        // List available tools
        const tools = await client.listTools();

        for (const tool of tools) {
          // Skip if already registered from gateway
          const toolKey = `mcp:${tool.name}`;
          const existingTool = registry.getTool(toolKey);
          if (existingTool) {
            continue;
          }

          // Register tool with capability mapping
          const capability = mapMCPToolToCapability(tool.name);

          await registry.registerTool({
            name: toolKey,
            capability: capability,
            provider: 'mcp-cli',
            handler: async (args: any, context: any) => {
              return await (client as any).callTool(tool.name, args) as any;
            },
            metadata: {
              latency: 'low',
              cost: 'low',
              reliability: 0.98,
              tags: ['mcp-cli', tool.name],
            },
            permissions: [`mcp:${tool.name}`],
          });

          count++;
          cliCount++;
          logger.debug(`Registered MCP CLI tool: ${tool.name} → ${capability}`);
        }

        await client.disconnect();
        // Bug #12/#13/#24/#34: consistent [INFO]/[WARN] shape with the other registries
        logToolCount(logger, { registry: 'MCP CLI', count: cliCount });
      } catch (error: any) {
        logger.debug('Failed to connect to MCP CLI (optional infrastructure)', error.message);
      }
    }
  } catch (error: any) {
    logger.error('Failed to register MCP tools', error);
  }

  return count;
}

/**
 * Map MCP tool name to capability
 *
 * @param toolName - MCP tool name
 * @returns Capability ID
 */
function mapMCPToolToCapability(toolName: string): string {
  const lowercaseName = toolName.toLowerCase();

  // File operations
  if (lowercaseName.includes('read') && lowercaseName.includes('file')) {
    return 'file.read';
  }
  if (lowercaseName.includes('write') && lowercaseName.includes('file')) {
    return 'file.write';
  }
  if (lowercaseName.includes('delete') && lowercaseName.includes('file')) {
    return 'file.delete';
  }
  if (lowercaseName.includes('list') && (lowercaseName.includes('dir') || lowercaseName.includes('directory'))) {
    return 'file.list';
  }
  if (lowercaseName.includes('search') && lowercaseName.includes('file')) {
    return 'repo.search';
  }

  // Shell operations
  if (lowercaseName.includes('shell') || lowercaseName.includes('exec') || lowercaseName.includes('run')) {
    return 'sandbox.execute';
  }

  // Git operations
  if (lowercaseName.includes('git')) {
    return 'repo.git';
  }
  if (lowercaseName.includes('clone') || lowercaseName.includes('commit') || lowercaseName.includes('push') || lowercaseName.includes('pull')) {
    return 'repo.git';
  }

  // Default: generic execution
  return 'sandbox.execute';
}

/**
 * Unregister all MCP tools
 *
 * @param registry - Tool registry instance
 */
export async function unregisterMCPTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const mcpTools = tools.filter(t => t.provider === 'mcp' || t.provider === 'mcp-cli');

  for (const tool of mcpTools) {
    await registry.unregisterTool(tool.name);
  }

  logger.info(`Unregistered ${mcpTools.length} MCP tools`);
}
