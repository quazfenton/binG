/**
 * Startup Capabilities
 * 
 * Determines which agent modes are available at startup based on environment
 * configuration. This is used for intelligent mode selection and routing.
 */

import { isDesktopMode } from "@bing/platform/env";
import { findOpencodeBinarySync } from "@/lib/agent-bins/find-opencode-binary";
import { agentLog } from './agent-logger';

/**
 * Startup capabilities - determines which execution modes are available
 */
export interface StartupCapabilities {
  v2Native: boolean;      // Desktop-only, OpenCode CLI binary required
  v2Containerized: boolean; // Desktop-only, sandbox provider required
  v2Local: boolean;       // Desktop-only, OpenCode CLI binary required
  opencodeSdk: boolean;    // Web + Desktop, HTTP API to OpenCode server
  statefulAgent: boolean;   // Unless explicitly disabled
  mastraWorkflows: boolean;// Explicitly enabled via env
  desktop: boolean;         // Running in Tauri desktop app
  v1Api: boolean;         // Cloud LLM APIs available
}

// Cache for startup capabilities (computed once at startup)
let _cachedCapabilities: StartupCapabilities | null = null;

// Package detection cache
let _hasOpenCodeSDKPackageCache: boolean | null = null;

function checkOpenCodeSDKPackage(): boolean {
  if (_hasOpenCodeSDKPackageCache !== null) {
    return _hasOpenCodeSDKPackageCache;
  }
  try {
    require.resolve('@opencode-ai/sdk');
    _hasOpenCodeSDKPackageCache = true;
  } catch {
    _hasOpenCodeSDKPackageCache = false;
  }
  return _hasOpenCodeSDKPackageCache;
}

/**
 * Check which agent modes are available at startup
 * Cached after first call for performance
 */
export function getStartupCapabilities(): StartupCapabilities {
  if (_cachedCapabilities) {
    return _cachedCapabilities;
  }

  const llmProvider = process.env.LLM_PROVIDER || '';
  const sandboxProvider = process.env.SANDBOX_PROVIDER || '';
  const containerized = process.env.OPENCODE_CONTAINERIZED === 'true';
  const opencodeEnabled = llmProvider === 'opencode';

  // V2 Native: only if explicitly enabled (LLM_PROVIDER=opencode)
  // RESTRICTED to desktop-only — CLI binary required on the host
  const isDesktop = isDesktopMode();
  const hasOpencodeBinary = !!findOpencodeBinarySync();
  const v2Native = opencodeEnabled && isDesktop && hasOpencodeBinary;

  // V2 Containerized: requires containerized flag + sandbox provider + API key
  // RESTRICTED to desktop-only — sandbox runs locally
  const v2Containerized = containerized
    && !!sandboxProvider
    && !!process.env[`${sandboxProvider.toUpperCase()}_API_KEY`]
    && isDesktop;

  // V2 Local: only if LLM_PROVIDER=opencode and not containerized
  // RESTRICTED to desktop-only — CLI binary required on the host
  const v2Local = opencodeEnabled && !containerized && isDesktop && hasOpencodeBinary;

  // OpenCode SDK: HTTP API to an OpenCode server — works on both web and desktop.
  // Available if OPENCODE_HOSTNAME or OPENCODE_PORT is set (server already running)
  // OR if @opencode-ai/sdk can be loaded (will try to start server as fallback).
  const opencodeSdk = !!(
    process.env.OPENCODE_HOSTNAME
    || process.env.OPENCODE_PORT
    || process.env.OPENCODE_SDK_URL
    || checkOpenCodeSDKPackage()
  );

  // StatefulAgent: enabled unless explicitly disabled
  const statefulAgent = process.env.ENABLE_STATEFUL_AGENT !== 'false'
    && process.env.STATEFUL_AGENT_DISABLED !== 'true';

  // Mastra workflows: explicitly enabled
  const mastraWorkflows = process.env.MASTRA_ENABLED === 'true'
    || !!process.env.DEFAULT_WORKFLOW_ID;

  // Desktop mode
  const desktop = isDesktop;

  // V1 API: at least one provider has an API key
  const providerKey = llmProvider ? process.env[`${llmProvider.toUpperCase()}_API_KEY`] : undefined;
  const v1Api = !!providerKey || !!process.env.OPENROUTER_API_KEY;

  // Log startup capabilities for observability
  agentLog.startupCheck('v2Native', v2Native, { llmProvider });
  agentLog.startupCheck('v2Containerized', v2Containerized, { sandboxProvider });
  agentLog.startupCheck('v2Local', v2Local, { containerized });
  agentLog.startupCheck('opencodeSdk', opencodeSdk, { 
    hasHostname: !!process.env.OPENCODE_HOSTNAME,
    hasPort: !!process.env.OPENCODE_PORT,
    hasSDKPackage: checkOpenCodeSDKPackage(),
  });
  agentLog.startupCheck('statefulAgent', statefulAgent);
  agentLog.startupCheck('mastraWorkflows', mastraWorkflows);
  agentLog.startupCheck('desktop', desktop);
  agentLog.startupCheck('v1Api', v1Api, { llmProvider });

  _cachedCapabilities = {
    v2Native,
    v2Containerized,
    v2Local,
    opencodeSdk,
    statefulAgent,
    mastraWorkflows,
    desktop,
    v1Api,
  };

  return _cachedCapabilities;
}

/**
 * Alias for getStartupCapabilities - for backward compatibility
 */
export function checkStartupCapabilities(): StartupCapabilities {
  return getStartupCapabilities();
}

/**
 * Get capabilities suitable for client-side display
 */
export function getClientCapabilities(): Omit<StartupCapabilities, 'desktop'> & { webReady: boolean } {
  const caps = getStartupCapabilities();
  return {
    ...caps,
    webReady: caps.opencodeSdk || caps.v1Api,
  };
}

/**
 * Check if a specific mode is available
 */
export function isModeAvailable(mode: keyof StartupCapabilities): boolean {
  const caps = getStartupCapabilities();
  return caps[mode] ?? false;
}
