"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

/**
 * Orchestration Mode Selector
 * 
 * Allows users to select which orchestration framework to use for agent tasks.
 * Default is 'task-router' (current behavior), but users can select alternatives for testing.
 * 
 * Modes:
 * - 'task-router': Default - routes tasks between OpenCode/Nullclaw (lib/agent/task-router.ts)
 * - 'unified-agent': Unified agent service with fallback chain (lib/orchestra/unified-agent-service.ts)
 * - 'mastra-workflow': Mastra workflow engine (lib/agent/mastra-workflow-integration.ts)
 * - 'crewai': CrewAI role-based agents (lib/crewai/)
 * - 'v2-executor': V2 containerized execution (lib/agent/v2-executor.ts)
 */
export type OrchestrationMode =
  | 'auto'
  | 'v1-api'
  | 'v1-agent-loop'
  | 'v1-progressive-build'
  | 'dual-process'
  | 'execution-controller'
  | 'spec:super'
  | 'spec:maximal'
  | 'v2-native'
  | 'v2-containerized'
  | 'v2-local'
  | 'unified-agent'
  | 'stateful-agent'
  | 'mastra-workflow'
  | 'mastra:code-agent'
  | 'mastra:research'
  | 'mastra:parallel'
  | 'mastra:data-analysis'
  | 'mastra:hitl'
  | 'agent-loop'
  | 'task-router'
  | 'opencode-sdk'
  | 'crewai'
  | 'crewai:role-agent'
  | 'crewai:swarm'
  | 'crewai:streaming'
  | 'v2-executor'
  | 'agent-team'
  | 'attractor-driven'
  | 'intent-driven'
  | 'energy-driven'
  | 'cognitive-resonance'
  | 'cognitive:converged'
  | 'adversarial-verify'
  | 'adversarial:revised'
  | 'distributed-cognition'
  | 'distributed:no-synthesis';

export interface OrchestrationModeConfig {
  mode: OrchestrationMode;
  autoApply: boolean;  // Auto-apply to all requests
  streamEnabled: boolean;  // Enable streaming for this mode
}

interface OrchestrationModeContextType {
  config: OrchestrationModeConfig;
  setMode: (mode: OrchestrationMode) => void;
  setAutoApply: (enabled: boolean) => void;
  setStreamEnabled: (enabled: boolean) => void;
  resetToDefault: () => void;
  isOverridden: boolean;  // True if user has selected a non-default mode
}

const DEFAULT_CONFIG: OrchestrationModeConfig = {
  mode: 'auto',  // Uses unified-agent-service.ts AGENT_EXECUTION_ENGINE default
  autoApply: false,
  streamEnabled: true,
};

const STORAGE_KEY = 'orchestration_mode_config';

// Valid modes set for validation
const VALID_MODES = new Set<OrchestrationMode>([
  'auto',
  'v1-api',
  'v1-agent-loop',
  'v1-progressive-build',
  'dual-process',
  'execution-controller',
  'spec:super',
  'spec:maximal',
  'v2-native',
  'v2-containerized',
  'v2-local',
  'unified-agent',
  'stateful-agent',
  'mastra-workflow',
  'mastra:code-agent',
  'mastra:research',
  'mastra:parallel',
  'mastra:data-analysis',
  'mastra:hitl',
  'agent-loop',
  'task-router',
  'opencode-sdk',
  'crewai',
  'crewai:role-agent',
  'crewai:swarm',
  'crewai:streaming',
  'v2-executor',
  'agent-team',
  'attractor-driven',
  'intent-driven',
  'energy-driven',
  'cognitive-resonance',
  'cognitive:converged',
  'adversarial-verify',
  'adversarial:revised',
  'distributed-cognition',
  'distributed:no-synthesis',
]);

/**
 * Validate and sanitize persisted config from localStorage
 * Prevents crashes from malformed or user-edited values
 */
function validatePersistedConfig(parsed: unknown): Partial<OrchestrationModeConfig> {
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  const config = parsed as Record<string, unknown>;
  const validated: Partial<OrchestrationModeConfig> = {};

  // Validate mode - must be one of the supported modes
  if (
    typeof config.mode === 'string' &&
    VALID_MODES.has(config.mode as OrchestrationMode)
  ) {
    validated.mode = config.mode as OrchestrationMode;
  }

  // Validate autoApply - must be boolean
  if (typeof config.autoApply === 'boolean') {
    validated.autoApply = config.autoApply;
  }

  // Validate streamEnabled - must be boolean
  if (typeof config.streamEnabled === 'boolean') {
    validated.streamEnabled = config.streamEnabled;
  }

  return validated;
}

const OrchestrationModeContext = createContext<OrchestrationModeContextType | undefined>(undefined);

export function OrchestrationModeProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<OrchestrationModeConfig>(() => {
    // Load from localStorage on mount
    if (typeof window === 'undefined') return DEFAULT_CONFIG;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const validated = validatePersistedConfig(parsed);
        // Merge validated values with defaults
        return { ...DEFAULT_CONFIG, ...validated };
      }
    } catch (error) {
      console.warn('[OrchestrationMode] Failed to load config:', error);
    }

    return DEFAULT_CONFIG;
  });

  const saveConfig = useCallback((newConfig: OrchestrationModeConfig) => {
    // Validate before saving to prevent persisting invalid configs
    const validated = validatePersistedConfig(newConfig);
    const finalConfig = { ...DEFAULT_CONFIG, ...validated };

    setConfig(finalConfig);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finalConfig));
      } catch (error) {
        console.warn('[OrchestrationMode] Failed to save config to localStorage:', error);
      }
    }
  }, []);

  const setMode = useCallback((mode: OrchestrationMode) => {
    // Validate mode before saving
    if (!VALID_MODES.has(mode)) {
      console.warn('[OrchestrationMode] Invalid mode:', mode);
      return;
    }

    const previousMode = config.mode;

    // Update local state immediately for responsive UI
    saveConfig({ ...config, mode });

    // Persist to server-side DB (fire-and-forget — doesn't block UI)
    // Server resolves userId from session_id cookie (internal auth) or JWT
    if (typeof window !== 'undefined') {
      fetch('/api/chat/modes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',  // Include session_id cookie for auth resolution
        body: JSON.stringify({
          mode,
          source: 'ui',
          config: { autoApply: config.autoApply, streamEnabled: config.streamEnabled },
        }),
      }).then(res => {
        if (!res.ok) {
          console.warn('[OrchestrationMode] Server persistence failed:', res.status);
        }
      }).catch(err => {
        console.warn('[OrchestrationMode] Server persistence error:', err.message);
      });
    }
  }, [config, saveConfig]);

  const setAutoApply = useCallback((enabled: boolean) => {
    saveConfig({ ...config, autoApply: enabled });
  }, [config, saveConfig]);

  const setStreamEnabled = useCallback((enabled: boolean) => {
    saveConfig({ ...config, streamEnabled: enabled });
  }, [config, saveConfig]);

  const resetToDefault = useCallback(() => {
    saveConfig(DEFAULT_CONFIG);

    // Reset server-side too (server resolves userId from session_id cookie)
    if (typeof window !== 'undefined') {
      fetch('/api/chat/modes', { method: 'DELETE', credentials: 'include' }).catch(() => {});
    }
  }, [saveConfig]);

  const isOverridden = config.mode !== DEFAULT_CONFIG.mode;

  return (
    <OrchestrationModeContext.Provider
      value={{
        config,
        setMode,
        setAutoApply,
        setStreamEnabled,
        resetToDefault,
        isOverridden,
      }}
    >
      {children}
    </OrchestrationModeContext.Provider>
  );
}

export function useOrchestrationMode() {
  const context = useContext(OrchestrationModeContext);
  if (context === undefined) {
    throw new Error('useOrchestrationMode must be used within OrchestrationModeProvider');
  }
  return context;
}

/**
 * Get HTTP headers for orchestration mode
 * Always includes X-Orchestration-Mode when the mode is set (even if it's the default).
 * This ensures user selection is honored regardless of server-side default wiring.
 */
export function getOrchestrationModeHeaders(config?: OrchestrationModeConfig): Record<string, string> {
  const modeConfig = config || DEFAULT_CONFIG;

  return {
    'X-Orchestration-Mode': modeConfig.mode,
    'X-Orchestration-Auto-Apply': String(modeConfig.autoApply),
    'X-Orchestration-Stream': String(modeConfig.streamEnabled),
  };
}
