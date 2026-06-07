/**
 * Shared utilities for workspace session reconnection API endpoints.
 *
 * Provides consistent formatting for session labels, idle duration display,
 * and reconnection hints across the reconnectable query and reconnect action
 * endpoints.
 */

import type { SessionGraphNode } from '@/lib/workspace/workspace-session-graph';

/** Format milliseconds into a human-readable relative time string. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Build a human-readable label for a session graph node. */
export function formatSessionLabel(node: Pick<SessionGraphNode, 'sessionType' | 'sessionSubtype' | 'metadata'>): string {
  switch (node.sessionType) {
    case 'shell':
      return `Shell: ${node.sessionSubtype || 'terminal'} (${node.metadata?.workingDir || '/'})`;
    case 'agent':
      return `Agent: ${node.sessionSubtype || 'AI agent'} (${node.metadata?.mode || 'opencode'})`;
    case 'preview':
      return `Preview: ${node.metadata?.serviceName || node.sessionSubtype || 'dev server'} (port ${node.metadata?.port || '?'})`;
    case 'editor':
      return `Editor: ${node.sessionSubtype || node.metadata?.reason || 'file operation'}`;
    case 'log':
      return `Log: ${node.metadata?.serviceName || node.sessionSubtype || 'service output'}`;
    case 'execution':
      return `Execution: ${node.sessionSubtype || 'code'} (${node.metadata?.language || 'unknown'})`;
    default:
      return `${node.sessionType}: ${node.sessionSubtype}`;
  }
}

/** Get a human-readable hint describing what reconnection means for a session type. */
export function getReconnectHint(sessionType: string): string {
  switch (sessionType) {
    case 'shell':
      return 'Reconnects the terminal PTY session — a new WebSocket connection will be established.';
    case 'agent':
      return 'Resumes the AI agent session — the agent loop will continue from where it left off.';
    case 'preview':
      return 'Re-establishes the preview URL for the dev server — the browser preview will refresh.';
    case 'editor':
      return 'Restores the editor session — file operations resume from last state.';
    case 'log':
      return 'Reconnects to the service log stream — new output will be visible.';
    case 'execution':
      return 'Restores the code execution session — execution context is re-established.';
    default:
      return 'Reconnects the session.';
  }
}
