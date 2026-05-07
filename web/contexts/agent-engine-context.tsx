"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

/**
 * Engine Selection
 * 
 * Allows users to select which execution engine to use:
 * - 'auto': Default - automatically select based on environment
 * - 'v1-api': Standard API calls (Vercel AI SDK)
 * - 'v2-cli': CLI binary spawn (OpenCode CLI)
 * - 'v2-http-sdk': HTTP SDK (OpenCode SDK)
 * - 'v2-container': Containerized execution
 */
export type AgentEngine = 'auto' | 'v1-api' | 'v2-cli' | 'v2-http-sdk' | 'v2-container';

export interface AgentEngineConfig {
  engine: AgentEngine;
  autoApply: boolean;
}

interface AgentEngineContextType {
  config: AgentEngineConfig;
  setEngine: (engine: AgentEngine) => void;
  resetToDefault: () => void;
  isOverridden: boolean;
}

const DEFAULT_CONFIG: AgentEngineConfig = {
  engine: 'auto',
  autoApply: true,
};

const AgentEngineContext = createContext<AgentEngineContextType | null>(null);

export function AgentEngineProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AgentEngineConfig>(DEFAULT_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('agent_engine');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.engine && parsed.autoApply !== undefined) {
          setConfig(parsed);
        }
      }
    } catch { /* ignore */ }
    setIsLoaded(true);
  }, []);

  // Persist to localStorage when changed
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem('agent_engine', JSON.stringify(config));
      } catch { /* ignore */ }
    }
  }, [config, isLoaded]);

  const setEngine = useCallback((engine: AgentEngine) => {
    setConfig(prev => ({ ...prev, engine }));
  }, []);

  const resetToDefault = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
  }, []);

  const isOverridden = config.engine !== 'auto';

  return (
    <AgentEngineContext.Provider value={{ config, setEngine, resetToDefault, isOverridden }}>
      {children}
    </AgentEngineContext.Provider>
  );
}

export function useAgentEngine() {
  const context = useContext(AgentEngineContext);
  if (!context) {
    throw new Error('useAgentEngine must be used within AgentEngineProvider');
  }
  return context;
}

/**
 * Get engine header value for API requests
 */
export function getAgentEngineHeader(): string {
  if (typeof window === 'undefined') return 'auto';
  try {
    const stored = localStorage.getItem('agent_engine');
    if (stored) {
      const config = JSON.parse(stored);
      return config.engine || 'auto';
    }
  } catch { /* ignore */ }
  return 'auto';
}