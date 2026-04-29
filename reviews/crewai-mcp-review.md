# Code Review: web/lib/crewai/mcp

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## mcp/server.ts (335 lines)

This module implements an MCP (Model Context Protocol) server within the CrewAI framework, allowing CrewAI tools and workflows to be exposed to external MCP clients.

### Good Practices

1. **Protocol Adherence** (line 29)
   Strictly follows the JSON-RPC 2.0 specification required by MCP.

2. **Zod Integration** (line 18)
   Uses Zod schemas for tool input validation, ensuring type safety when external clients invoke local CrewAI tools.

3. **Event Notification** (line 46)
   Supports asynchronous notifications (`MCPEvent`), which is useful for long-running agent tasks where the client needs progress updates.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 2 |

### MEDIUM PRIORITY

1. **Custom MCP Implementation**
   This module implements the MCP specification manually (JSON-RPC structures, handlers, etc.) rather than using the official `@modelcontextprotocol/sdk`. This introduces a high maintenance burden and the risk of protocol drift.
   
   **Recommendation:** Refactor to use the official MCP SDK to ensure full compatibility with the evolving specification and ecosystem tools.

### LOW PRIORITY

1. **Limited Error Codes** (line 39)
   The `MCPResponse` error structure should follow the standard MCP error codes (e.g., `-32601` for Method not found).
2. **Context Passing**
   Ensure that session context (userId, sessionId) is properly propagated through the MCP handlers so that tools respect filesystem permissions.

---

## Wiring

- **Used by:**
  - `web/lib/crewai/index.ts`
  - Potential remote agent integrations.

**Status:** ✅ Functional but could be more robust by using the official SDK.

---

## Summary

The CrewAI MCP server is a valuable interop layer. Its manual implementation of the protocol is a risk, but the integration with local tools and Zod validation is a solid foundation.

---

*End of Review*