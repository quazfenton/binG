'use client';

/**
 * useMCPTools — React Hook for MCP Tool Discovery and Execution
 *
 * Provides a React-friendly interface for discovering available MCP tools
 * and invoking them. Automatically handles loading states, error handling,
 * and cleanup. Can optionally auto-discover tools on mount.
 *
 * @example
 * ```tsx
 * function MCPSidebar() {
 *   const { tools, loading, callTool } = useMCPTools({ autoDiscover: true });
 *
 *   return (
 *     <div>
 *       {tools.map(tool => (
 *         <button key={tool.name} onClick={() => callTool(tool.name, {})}>
 *           {tool.name}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Hooks:useMCPTools');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPToolDefinition {
  /** Unique tool name (e.g. "vfs_read_file", "bash_execute") */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Tool provider/source (e.g. "vfs", "bash", "composio", "arcade") */
  provider?: string;
  /** JSON Schema for the tool's parameters */
  parameters?: Record<string, any>;
}

export interface MCPCallResult {
  success: boolean;
  output?: any;
  error?: string;
  toolName: string;
  /** Time taken in ms */
  durationMs: number;
}

export interface UseMCPToolsOptions {
  /** Optional server/transport label to filter tools by provider */
  serverLabel?: string;
  /** Auto-discover tools on mount (default: false) */
  autoDiscover?: boolean;
  /** Called when tools are successfully discovered */
  onToolsLoaded?: (tools: MCPToolDefinition[]) => void;
  /** Called when a tool call succeeds */
  onToolSuccess?: (result: MCPCallResult) => void;
  /** Called when a tool call or discovery errors */
  onError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMCPTools(options: UseMCPToolsOptions = {}) {
  const {
    serverLabel,
    autoDiscover = false,
    onToolsLoaded,
    onToolSuccess,
    onError,
  } = options;

  const [tools, setTools] = useState<MCPToolDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callingTool, setCallingTool] = useState<string | null>(null);

  // Refs
  const optionsRef = useRef({ onToolsLoaded, onToolSuccess, onError });
  optionsRef.current = { onToolsLoaded, onToolSuccess, onError };
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // -----------------------------------------------------------------------
  // discoverTools — fetch available MCP tool definitions
  // -----------------------------------------------------------------------
  const discoverTools = useCallback(async (): Promise<MCPToolDefinition[]> => {
    setLoading(true);
    setError(null);

    try {
      // Build the URL — optionally filter by server label
      let url = '/api/mcp/tools';
      if (serverLabel) {
        url += `?server=${encodeURIComponent(serverLabel)}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`MCP discovery failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const toolList: MCPToolDefinition[] = (data.tools || data || []).map((t: any) => ({
        name: t.name,
        description: t.description || t.function?.description,
        provider: t.provider || t.source || serverLabel,
        parameters: t.parameters || t.inputSchema || t.function?.parameters,
      }));

      if (mountedRef.current) {
        setTools(toolList);
        setLoading(false);
      }
      optionsRef.current.onToolsLoaded?.(toolList);
      return toolList;
    } catch (err: any) {
      const msg = err?.message || 'Failed to discover MCP tools';
      logger.error('[useMCPTools] discoverTools failed:', msg);
      if (mountedRef.current) {
        setError(msg);
        setLoading(false);
      }
      optionsRef.current.onError?.(msg);
      return [];
    }
  }, [serverLabel]);

  // -----------------------------------------------------------------------
  // callTool — invoke an MCP tool by name with arguments
  // -----------------------------------------------------------------------
  const callTool = useCallback(async (
    toolName: string,
    args: Record<string, any> = {},
  ): Promise<MCPCallResult> => {
    const startTime = Date.now();
    setCallingTool(toolName);
    setError(null);

    try {
      const response = await fetch('/api/mcp/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName,
          arguments: args,
          serverLabel,
        }),
      });

      const data = await response.json();
      const durationMs = Date.now() - startTime;

      if (!response.ok || data.error) {
        const result: MCPCallResult = {
          success: false,
          error: data.error || `HTTP ${response.status}`,
          toolName,
          durationMs,
        };
        if (mountedRef.current) setCallingTool(null);
        optionsRef.current.onError?.(result.error!);
        return result;
      }

      const result: MCPCallResult = {
        success: true,
        output: data.output || data.result || data,
        toolName,
        durationMs,
      };
      if (mountedRef.current) setCallingTool(null);
      optionsRef.current.onToolSuccess?.(result);
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const msg = err?.message || 'MCP tool call failed';
      const result: MCPCallResult = {
        success: false,
        error: msg,
        toolName,
        durationMs,
      };
      logger.error('[useMCPTools] callTool failed:', msg);
      if (mountedRef.current) {
        setCallingTool(null);
        setError(msg);
      }
      optionsRef.current.onError?.(msg);
      return result;
    }
  }, [serverLabel]);

  // -----------------------------------------------------------------------
  // Auto-discover on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (autoDiscover) {
      discoverTools();
    }
  }, [autoDiscover, discoverTools]);

  return {
    /** Discovered MCP tool definitions */
    tools,
    /** True while discovering tools */
    loading,
    /** Last error message, or null */
    error,
    /** Name of the tool currently being called, or null */
    callingTool,
    /** True if any tool call is in-flight */
    isCalling: callingTool !== null,
    /** Discover available MCP tools */
    discoverTools,
    /** Call an MCP tool by name with arguments */
    callTool,
    /** Number of tools available */
    toolCount: tools.length,
  };
}
