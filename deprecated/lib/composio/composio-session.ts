/**
 * Composio Client - Session-Based Architecture
 * 
 * CRITICAL: Each user gets isolated session for security
 * No global state sharing between users
 * 
 * Documentation: docs/sdk/composio-llms-full.txt
 */

import { Composio } from '@composio/core';

// User session storage - NEVER share between users
const userSessions = new Map<string, any>();

export interface ComposioSession {
  userId: string;
  composio: any;
  tools?: any[];
  createdAt: Date;
  lastActive: Date;
}

/**
 * Get or create Composio session for specific user
 * 
 * @param userId - Unique user identifier (REQUIRED for isolation)
 * @param opts - Optional configuration
 */
export async function getComposioSession(
  userId: string,
  opts: { apiKey?: string; host?: string } = {}
): Promise<ComposioSession> {
  if (!userId) {
    throw new Error('userId is REQUIRED for session isolation');
  }

  // Return existing session if available
  if (userSessions.has(userId)) {
    const session = userSessions.get(userId);
    session.lastActive = new Date();
    return session;
  }

  // Create new session for user
  const composio = new Composio({
    apiKey: opts.apiKey || process.env.COMPOSIO_API_KEY,
    host: opts.host || process.env.COMPOSIO_HOST,
  });

  const session = await composio.create(userId);
  
  const sessionData: ComposioSession = {
    userId,
    composio: session,
    createdAt: new Date(),
    lastActive: new Date(),
  };

  userSessions.set(userId, sessionData);

  // Auto-cleanup old sessions (24 hours)
  setTimeout(() => {
    if (userSessions.has(userId)) {
      userSessions.delete(userId);
    }
  }, 24 * 60 * 60 * 1000);

  return sessionData;
}

/**
 * Get tools for specific user
 */
export async function getUserComposioTools(
  userId: string,
  options?: { toolkits?: string[]; limit?: number }
) {
  const session = await getComposioSession(userId);
  
  return session.composio.tools.get(userId, {
    toolkits: options?.toolkits,
    limit: options?.limit || 300,
  });
}

/**
 * Search tools for specific user
 */
export async function searchComposioTools(
  userId: string,
  query: string,
  options?: { toolkit?: string; limit?: number }
) {
  const session = await getComposioSession(userId);
  
  return session.composio.tools.search({
    query,
    toolkit: options?.toolkit,
    limit: options?.limit || 10,
  });
}

/**
 * List available toolkits
 */
export async function listComposioToolkits() {
  const composio = new Composio();
  return composio.toolkits.list();
}

/**
 * Execute tool for specific user
 */
export async function executeComposioTool(
  userId: string,
  toolName: string,
  params: Record<string, any>
) {
  const session = await getComposioSession(userId);
  
  return session.composio.tools.execute({
    toolName,
    params,
  });
}

/**
 * Cleanup - remove user session
 */
export function cleanupComposioSession(userId: string) {
  userSessions.delete(userId);
}

/**
 * Get session stats
 */
export function getComposioSessionStats() {
  return {
    activeSessions: userSessions.size,
    sessionUserIds: Array.from(userSessions.keys()),
  };
}
