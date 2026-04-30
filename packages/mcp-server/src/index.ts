/**
 * @bing/mcp-server
 *
 * Standalone MCP server package.
 *
 * NOTE: The stdio server entrypoint (`stdio-server.ts`) has runtime side effects
 * (starts an MCP server on stdio, calls `process.exit()` on error). It is NOT
 * re-exported from this module root to avoid unexpectedly starting the server
 * or terminating the host process when imported as a library.
 *
 * To run the server directly, use the `bing-mcp` CLI binary or import
 * `./stdio-server.js` explicitly with full awareness of the side effects.
 *
 * CRIT-1 fix: Export tool functions and types for programmatic use.
 * Consumers can register individual tools with their own MCP server instance
 * without running the standalone stdio server.
 */

// Re-export tool factories for programmatic use
export { createAgentTool, getAgentStatusTool, stopAgentTool, spawnAgentSessionTool } from './tools/agent-tools';
export { voiceSpeechTool } from './tools/voice-tools';
export { generateImageTool } from './tools/image-tools';
export { registerExtractedTools } from './tools/registry';

// Re-export server config type (not the singleton, to avoid side effects)
export type { ServerConfig } from './stdio-server';
