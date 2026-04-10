"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

/**
 * Spec Enhancement Mode Selector
 * 
 * Controls how the SPEC is amplified during the build/implementation process.
 * Different modes provide different levels of detail and iteration.
 * 
 * Modes:
 * - 'normal': No spec amplification - direct implementation
 * - 'enhanced': DAG-based refinement (original spec amplification)
 * - 'max': Maximalist spec enhancer with meta-prompts (10 rounds, mid-point regen)
 * - 'super': Super mode - hyper-detailed multi-chain (100+ steps)
 */
export type SpecEnhancementMode = 
  | 'normal'           // No spec amplification
  | 'enhanced'         // DAG-based refinement (original)
  | 'max'              // Maximalist with meta-prompts
  | 'super';           // Super mode - hyper-detailed

export interface SpecEnhancementConfig {
  mode: SpecEnhancementMode;
  autoApply: boolean;  // Auto-apply to all requests
  chain?: string;      // For 'super' mode: which chain to use (frontend, backend, etc.)
}

interface SpecEnhancementContextType {
  config: SpecEnhancementConfig;
  setMode: (mode: SpecEnhancementMode) => void;
  setAutoApply: (enabled: boolean) => void;
  setChain: (chain: string | undefined) => void;
  resetToDefault: () => void;
  isOverridden: boolean;  // True if user has selected a non-default mode
}

const DEFAULT_CONFIG: SpecEnhancementConfig = {
  mode: 'max',  // Default to maximalist for comprehensive builds
  autoApply: false,
  chain: undefined,
};

const STORAGE_KEY = 'spec_enhancement_config';

// Valid modes set for validation
const VALID_MODES = new Set<SpecEnhancementMode>([
  'normal',
  'enhanced',
  'max',
  'super',
]);

// Valid chains for super mode
const VALID_CHAINS = new Set<string>([
  'default',
  'frontend',
  'ml_ai',
  'backend',
  'mobile',
  'security',
  'devops',
  'data',
  'api',
  'system',
  'web3',
]);

/**
 * Validate and sanitize persisted config from localStorage
 */
function validatePersistedConfig(parsed: unknown): Partial<SpecEnhancementConfig> {
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  const config = parsed as Record<string, unknown>;
  const validated: Partial<SpecEnhancementConfig> = {};

  // Validate mode
  if (
    typeof config.mode === 'string' &&
    VALID_MODES.has(config.mode as SpecEnhancementMode)
  ) {
    validated.mode = config.mode as SpecEnhancementMode;
  }

  // Validate autoApply
  if (typeof config.autoApply === 'boolean') {
    validated.autoApply = config.autoApply;
  }

  // Validate chain
  if (
    typeof config.chain === 'string' &&
    VALID_CHAINS.has(config.chain)
  ) {
    validated.chain = config.chain;
  }

  return validated;
}

const SpecEnhancementModeContext = createContext<SpecEnhancementContextType | undefined>(undefined);

export function SpecEnhancementModeProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SpecEnhancementConfig>(() => {
    if (typeof window === 'undefined') return DEFAULT_CONFIG;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const validated = validatePersistedConfig(parsed);
        return { ...DEFAULT_CONFIG, ...validated };
      }
    } catch (error) {
      console.warn('[SpecEnhancement] Failed to load config:', error);
    }

    return DEFAULT_CONFIG;
  });

  const saveConfig = useCallback((newConfig: SpecEnhancementConfig) => {
    const validated = validatePersistedConfig(newConfig);
    const finalConfig = { ...DEFAULT_CONFIG, ...validated };

    setConfig(finalConfig);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finalConfig));
      } catch (error) {
        console.warn('[SpecEnhancement] Failed to save config:', error);
      }
    }
  }, []);

  const setMode = useCallback((mode: SpecEnhancementMode) => {
    if (!VALID_MODES.has(mode)) {
      console.warn('[SpecEnhancement] Invalid mode:', mode);
      return;
    }

    saveConfig({ ...config, mode });

    // Persist to server
    if (typeof window !== 'undefined') {
      fetch('/api/chat/spec-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode,
          source: 'ui',
          chain: config.chain,
        }),
      }).catch(err => {
        console.warn('[SpecEnhancement] Server persistence error:', err.message);
      });
    }
  }, [config, saveConfig]);

  const setAutoApply = useCallback((enabled: boolean) => {
    saveConfig({ ...config, autoApply: enabled });
  }, [config, saveConfig]);

  const setChain = useCallback((chain: string | undefined) => {
    if (chain && !VALID_CHAINS.has(chain)) {
      console.warn('[SpecEnhancement] Invalid chain:', chain);
      return;
    }
    saveConfig({ ...config, chain });
  }, [config, saveConfig]);

  const resetToDefault = useCallback(() => {
    saveConfig(DEFAULT_CONFIG);

    if (typeof window !== 'undefined') {
      fetch('/api/chat/spec-mode', { method: 'DELETE', credentials: 'include' }).catch(() => {});
    }
  }, [saveConfig]);

  const isOverridden = config.mode !== DEFAULT_CONFIG.mode;

  return (
    <SpecEnhancementModeContext.Provider
      value={{
        config,
        setMode,
        setAutoApply,
        setChain,
        resetToDefault,
        isOverridden,
      }}
    >
      {children}
    </SpecEnhancementModeContext.Provider>
  );
}

export function useSpecEnhancementMode() {
  const context = useContext(SpecEnhancementModeContext);
  if (context === undefined) {
    throw new Error('useSpecEnhancementMode must be used within SpecEnhancementModeProvider');
  }
  return context;
}

/**
 * Get HTTP headers for spec enhancement mode
 */
export function getSpecEnhancementHeaders(config?: SpecEnhancementConfig): Record<string, string> {
  const modeConfig = config || DEFAULT_CONFIG;

  const headers: Record<string, string> = {
    'X-Spec-Enhancement-Mode': modeConfig.mode,
  };

  if (modeConfig.chain) {
    headers['X-Spec-Enhancement-Chain'] = modeConfig.chain;
  }

  return headers;
}

/**
 * Get mode display info for UI
 */
export function getSpecEnhancementModeInfo(mode: SpecEnhancementMode): {
  label: string;
  description: string;
  icon: string;
} {
  switch (mode) {
    case 'normal':
      return {
        label: 'Normal',
        description: 'Direct implementation without spec amplification',
        icon: '1',
      };
    case 'enhanced':
      return {
        label: 'Enhanced',
        description: 'DAG-based spec refinement (original spec amplification)',
        icon: '2',
      };
    case 'max':
      return {
        label: 'Maximalist',
        description: 'Comprehensive multi-round enhancement with meta-prompts (10 rounds)',
        icon: '3',
      };
    case 'super':
      return {
        label: 'Super Mode',
        description: 'Hyper-detailed multi-chain build process (100+ steps)',
        icon: '4',
      };
    default:
      return {
        label: mode,
        description: '',
        icon: '?',
      };
  }
}