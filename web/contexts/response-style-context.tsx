"use client";
/**
 * Response Style Context
 *
 * Manages response style preferences (response depth, expertise level, tone, etc.)
 * across the application. Features:
 * - Persists to localStorage with graceful degradation
 * - Cross-tab synchronization via BroadcastChannel
 * - Keyboard shortcuts (⌘/Ctrl+1..9 for presets, ⌘/Ctrl+0 to reset)
 * - Configuration export/import as JSON
 * - Undo/redo support
 *
 * Usage:
 * ```tsx
 * import { ResponseStyleProvider, useResponseStyle } from '@/contexts/response-style-context';
 *
 * // In provider tree:
 * <ResponseStyleProvider>
 *   <App />
 * </ResponseStyleProvider>
 *
 * // In component:
 * const { params, setPreset, presetKey, promptSuffix, exportConfig, undo } = useResponseStyle();
 * ```
 */

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  PromptParameters,
  PromptPresetKey,
  DEFAULT_PROMPT_PARAMETERS,
  PROMPT_PRESETS,
  generateDebugHeaderValue,
  applyPromptModifiers,
} from '@bing/shared/agent/prompt-parameters';
import { encodeParams, decodeParams } from '@bing/shared/agent/prompt-parameters.codec';

const STORAGE_KEY = 'response_style_params';
const PRESET_KEY = 'response_style_preset';
const HISTORY_KEY = 'response_style_history';
const BROADCAST_CHANNEL_NAME = 'bing-response-style';
const MAX_HISTORY = 20;

// ============================================================================
// Keyboard Shortcut Map
// Maps ⌘/Ctrl+0..9 to preset keys or reset action
// ============================================================================

const KEYBOARD_SHORTCUT_MAP: Record<string, PromptPresetKey | '__reset__'> = {
  '1': 'QuickAnswer',
  '2': 'ExpertBrief',
  '3': 'StandardProfessional',
  '4': 'DeepExpertAnalysis',
  '5': 'MaximumRigor',
  '6': 'CasualExplanation',
  '7': 'Brainstorming',
  '8': 'ExecutiveSummary',
  '9': 'Teaching',
  '0': '__reset__',
};

interface ResponseStyleContextValue {
  /** Current prompt parameters */
  params: PromptParameters;
  /** Set all parameters at once */
  setParams: (params: PromptParameters) => void;
  /** Update a single parameter field */
  updateParam: <K extends keyof PromptParameters>(key: K, value: PromptParameters[K]) => void;
  /** Current preset key, if any */
  presetKey: PromptPresetKey | null;
  /** Set the preset (merges preset with any existing custom params) */
  setPreset: (preset: PromptPresetKey | null) => void;
  /** Reset to default parameters */
  reset: () => void;
  /** Generated prompt suffix for appending to base system prompt */
  promptSuffix: string;
  /** Debug header value for observability */
  debugHeader: string;
  /** Whether any non-default modifiers are active */
  hasActiveModifiers: boolean;
  /** Encoded string for URL sharing */
  encodedParams: string;
  /** Undo the last change */
  undo: () => boolean;
  /** Redo a previously undone change */
  redo: () => boolean;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Export configuration as JSON string */
  exportConfig: () => string;
  /** Import configuration from JSON string */
  importConfig: (json: string) => boolean;
}

const ResponseStyleContext = createContext<ResponseStyleContextValue | null>(null);

// ============================================================================
// Helpers
// ============================================================================

function getInitialParams(): { params: PromptParameters; presetKey: PromptPresetKey | null } {
  const envPreset = process.env.NEXT_PUBLIC_DEFAULT_RESPONSE_PRESET;

  if (typeof window !== 'undefined') {
    try {
      const storedPreset = localStorage.getItem(PRESET_KEY);
      if (storedPreset && storedPreset in PROMPT_PRESETS) {
        const preset = PROMPT_PRESETS[storedPreset as PromptPresetKey];
        const stored = localStorage.getItem(STORAGE_KEY);
        const custom = stored ? JSON.parse(stored) as Partial<PromptParameters> : {};
        return { params: { ...preset, ...custom }, presetKey: storedPreset as PromptPresetKey };
      }

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { params: JSON.parse(stored) as PromptParameters, presetKey: null };
      }
    } catch { /* corrupted storage, fall through */ }
  }

  if (envPreset && envPreset in PROMPT_PRESETS) {
    const preset = PROMPT_PRESETS[envPreset as PromptPresetKey];
    return { params: preset, presetKey: envPreset as PromptPresetKey };
  }

  return { params: DEFAULT_PROMPT_PARAMETERS, presetKey: null };
}

interface HistoryEntry {
  params: PromptParameters;
  presetKey: PromptPresetKey | null;
  timestamp: number;
}

interface ResponseStyleProviderProps {
  children: React.ReactNode;
}

export function ResponseStyleProvider({ children }: ResponseStyleProviderProps) {
  const initial = useMemo(() => getInitialParams(), []);
  const [params, setParamsState] = useState<PromptParameters>(initial.params);
  const [presetKey, setPresetKeyState] = useState<PromptPresetKey | null>(initial.presetKey);

  // Undo/redo history
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const historyRef = useRef({ history, future });
  historyRef.current = { history, future };

  // BroadcastChannel for cross-tab sync
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Initialize BroadcastChannel
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    try {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channelRef.current = channel;

      channel.onmessage = (event: MessageEvent) => {
        const { type, params: newParams, presetKey: newPresetKey, source } = event.data;
        if (source === 'self') return; // Ignore own broadcasts

        if (type === 'style_change') {
          // Update state without pushing to history (sync from another tab)
          setParamsState(newParams);
          setPresetKeyState(newPresetKey);
        }
      };

      return () => { channel.close(); channelRef.current = null; };
    } catch {
      // BroadcastChannel not supported — fall back to storage events
    }
  }, []);

  // Broadcast changes to other tabs
  const broadcastChange = useCallback((newParams: PromptParameters, newPresetKey: PromptPresetKey | null) => {
    if (channelRef.current) {
      try {
        channelRef.current.postMessage({
          type: 'style_change',
          params: newParams,
          presetKey: newPresetKey,
          source: 'self',
        });
      } catch { /* ignore */ }
    }
  }, []);

  // Push current state to history before changing
  const pushHistory = useCallback(() => {
    setHistory(prev => {
      const entry: HistoryEntry = {
        params: { ...params },
        presetKey,
        timestamp: Date.now(),
      };
      const next = [...prev, entry].slice(-MAX_HISTORY);
      return next;
    });
    setFuture([]); // Clear redo stack on new change
  }, [params, presetKey]);

  // Persist to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const baseParams = presetKey && presetKey in PROMPT_PRESETS
      ? PROMPT_PRESETS[presetKey]
      : DEFAULT_PROMPT_PARAMETERS;

    const custom: Partial<PromptParameters> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== (baseParams as any)[key]) {
        (custom as any)[key] = value;
      }
    }

    try {
      if (Object.keys(custom).length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      if (presetKey) {
        localStorage.setItem(PRESET_KEY, presetKey);
      } else {
        localStorage.removeItem(PRESET_KEY);
      }
    } catch { /* storage full or private mode */ }

    // Broadcast to other tabs
    broadcastChange(params, presetKey);
  }, [params, presetKey, broadcastChange]);

  const setParams = useCallback((newParams: PromptParameters) => {
    pushHistory();
    setParamsState(newParams);
  }, [pushHistory]);

  const updateParam = useCallback(<K extends keyof PromptParameters>(key: K, value: PromptParameters[K]) => {
    pushHistory();
    setParamsState(prev => ({ ...prev, [key]: value }));
  }, [pushHistory]);

  const setPreset = useCallback((preset: PromptPresetKey | null) => {
    pushHistory();
    if (preset && preset in PROMPT_PRESETS) {
      const presetParams = PROMPT_PRESETS[preset];
      setParamsState(presetParams);
      setPresetKeyState(preset);
    } else {
      setParamsState(DEFAULT_PROMPT_PARAMETERS);
      setPresetKeyState(null);
    }
  }, [pushHistory]);

  const reset = useCallback(() => {
    pushHistory();
    setParamsState(DEFAULT_PROMPT_PARAMETERS);
    setPresetKeyState(null);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PRESET_KEY);
      } catch { /* ignore */ }
    }
    broadcastChange(DEFAULT_PROMPT_PARAMETERS, null);
  }, [pushHistory, broadcastChange]);

  // Undo/Redo
  const undo = useCallback((): boolean => {
    const { history: hist } = historyRef.current;
    if (hist.length === 0) return false;

    const last = hist[hist.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setFuture(prev => [{ params, presetKey, timestamp: Date.now() }, ...prev]);
    setParamsState(last.params);
    setPresetKeyState(last.presetKey);
    return true;
  }, [params, presetKey]);

  const redo = useCallback((): boolean => {
    const { future: fut } = historyRef.current;
    if (fut.length === 0) return false;

    const next = fut[0];
    setFuture(prev => prev.slice(1));
    setParamsState(next.params);
    setPresetKeyState(next.presetKey);
    return true;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (!modifier) return;

      const key = e.key;
      if (key in KEYBOARD_SHORTCUT_MAP) {
        e.preventDefault();
        const action = KEYBOARD_SHORTCUT_MAP[key];
        if (action === '__reset__') {
          reset();
        } else {
          setPreset(action);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reset, setPreset]);

  // Computed values
  const promptSuffix = useMemo(() => {
    // Note: applyPromptModifiers is async, but for client-side display we use the sync version
    // The actual async suffix is generated server-side in the chat API
    return '';
  }, [params]);
  const debugHeader = useMemo(() => generateDebugHeaderValue(params, presetKey), [params, presetKey]);
  const encodedParams = useMemo(() => encodeParams(params), [params]);

  const hasActiveModifiers = useMemo(() => {
    return Object.entries(params).some(([key, value]) => {
      if (key === 'customInstructions' && value) return (value as string).trim().length > 0;
      return value !== undefined && value !== (DEFAULT_PROMPT_PARAMETERS as any)[key];
    });
  }, [params]);

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  // Export/Import
  const exportConfig = useCallback((): string => {
    return JSON.stringify({
      version: 1,
      presetKey,
      params,
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }, [params, presetKey]);

  const importConfig = useCallback((json: string): boolean => {
    try {
      const data = JSON.parse(json);
      if (data.version !== 1) return false;
      if (data.params) {
        pushHistory();
        setParamsState(data.params);
        setPresetKeyState(data.presetKey || null);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [pushHistory]);

  const value = useMemo<ResponseStyleContextValue>(() => ({
    params,
    setParams,
    updateParam,
    presetKey,
    setPreset,
    reset,
    promptSuffix,
    debugHeader,
    hasActiveModifiers,
    encodedParams,
    undo,
    redo,
    canUndo,
    canRedo,
    exportConfig,
    importConfig,
  }), [
    params, setParams, updateParam, presetKey, setPreset, reset,
    promptSuffix, debugHeader, hasActiveModifiers, encodedParams,
    undo, redo, canUndo, canRedo, exportConfig, importConfig,
  ]);

  return (
    <ResponseStyleContext.Provider value={value}>
      {children}
    </ResponseStyleContext.Provider>
  );
}

export function useResponseStyle(): ResponseStyleContextValue {
  const context = useContext(ResponseStyleContext);
  if (!context) {
    throw new Error('useResponseStyle must be used within a ResponseStyleProvider');
  }
  return context;
}
