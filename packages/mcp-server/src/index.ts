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
 */

// No library exports — this package is intended to be run as a CLI,
// not imported as a side-effect-free library.
export {};
