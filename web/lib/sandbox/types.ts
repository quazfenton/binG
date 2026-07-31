/**
 * Sandbox Execution Policies — re-export shim.
 *
 * The canonical body lives at /opt/bing/packages/shared/lib/sandbox/types.ts
 * (relocated 2026-07-16 per the hoist epic / MCP_TOOL_SELECTION_POSTAUDIT
 *  item ④ PARTIAL closure track). This file remains so that any web/*
 * caller still using `@/lib/sandbox/types*` resolves to the SAME exports
 * without a behavioral break. Future iterations will migrate every web/*
 * caller to a direct relative import and this shim can be removed.
 */
export * from '../../../packages/shared/lib/sandbox/types';
