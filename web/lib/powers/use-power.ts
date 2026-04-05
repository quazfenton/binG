/**
 * usePowers — React hook for the Powers Marketplace UI
 *
 * Provides state management for:
 * - Browsing marketplace powers
 * - Installing/uninstalling powers
 * - Toggling powers on/off for the current session
 *
 * Usage:
 * ```tsx
 * const { powers, active, install, uninstall, toggle, systemPrompt } = usePowers();
 *
 * // Pass active power IDs into your chat API call
 * const response = await fetch('/api/chat', {
 *   body: JSON.stringify({ messages, activePowerIds: [...active] }),
 * });
 * ```
 */

import { useState, useEffect, useCallback } from 'react';

export interface PowerSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  installed: boolean;
  actions: number;
}

export interface UsePowersResult {
  /** All marketplace + installed powers */
  powers: PowerSummary[];
  /** Set of active (enabled for current session) power IDs */
  active: Set<string>;
  /** Install a power from marketplace */
  install: (powerId: string) => Promise<void>;
  /** Uninstall a power */
  uninstall: (powerId: string) => Promise<void>;
  /** Toggle a power on/off for current session */
  toggle: (powerId: string) => void;
  /** Enable a power for current session */
  enable: (powerId: string) => void;
  /** Disable a power for current session */
  disable: (powerId: string) => void;
  /** Body params to pass into chat API */
  chatBody: { activePowerIds: string[] };
  /** System prompt block listing active powers for the LLM */
  systemPrompt: string;
  /** Reload powers from server */
  reload: () => Promise<void>;
}

export function usePowers(): UsePowersResult {
  const [powers, setPowers] = useState<PowerSummary[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());

  // Fetch installed + marketplace powers on mount
  const reload = useCallback(async () => {
    try {
      const [marketRes, installedRes] = await Promise.all([
        fetch('/api/powers/marketplace').catch(() => ({ ok: false })),
        fetch('/api/powers').catch(() => ({ ok: false })),
      ]);

      const marketPowers: PowerSummary[] = marketRes.ok ? await marketRes.json() : [];
      const installedPowers: PowerSummary[] = installedRes.ok ? await installedRes.json() : [];

      // Merge: installed powers take precedence
      const merged = new Map<string, PowerSummary>();
      for (const p of [...marketPowers, ...installedPowers]) {
        const existing = merged.get(p.id);
        merged.set(p.id, { ...p, installed: existing?.installed || p.installed });
      }

      setPowers([...merged.values()]);
    } catch {
      // Silently fail — powers are optional
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const install = useCallback(async (powerId: string) => {
    await fetch('/api/powers/install', {
      method: 'POST',
      body: JSON.stringify({ powerId, source: 'marketplace' }),
      headers: { 'Content-Type': 'application/json' },
    });
    setPowers(prev => prev.map(p => p.id === powerId ? { ...p, installed: true } : p));
    setActive(prev => new Set([...prev, powerId]));
  }, []);

  const uninstall = useCallback(async (powerId: string) => {
    await fetch('/api/powers/uninstall', {
      method: 'DELETE',
      body: JSON.stringify({ powerId }),
      headers: { 'Content-Type': 'application/json' },
    });
    setPowers(prev => prev.map(p => p.id === powerId ? { ...p, installed: false } : p));
    setActive(prev => {
      const next = new Set(prev);
      next.delete(powerId);
      return next;
    });
  }, []);

  const toggle = useCallback((powerId: string) => {
    setActive(prev => {
      const next = new Set(prev);
      next.has(powerId) ? next.delete(powerId) : next.add(powerId);
      return next;
    });
  }, []);

  const enable = useCallback((powerId: string) => {
    setActive(prev => new Set([...prev, powerId]));
  }, []);

  const disable = useCallback((powerId: string) => {
    setActive(prev => {
      const next = new Set(prev);
      next.delete(powerId);
      return next;
    });
  }, []);

  const chatBody = { activePowerIds: [...active] };

  // Build system prompt block for active powers
  const systemPrompt = (() => {
    const activePowers = powers.filter(p => active.has(p.id));
    if (activePowers.length === 0) return '';

    return `
## Available Powers (Active)
You have the following user-installed powers available:
${activePowers.map(p => `- **${p.name}** (v${p.version}): ${p.description}`).join('\n')}
`;
  })();

  return {
    powers,
    active,
    install,
    uninstall,
    toggle,
    enable,
    disable,
    chatBody,
    systemPrompt,
    reload,
  };
}
