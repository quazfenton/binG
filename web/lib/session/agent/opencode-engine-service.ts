/**
 * OpenCode Engine Service
 * Placeholder for backward compatibility.
 */

export interface OpenCodeEngineConfig {
  userId: string;
  sessionId?: string;
}

export async function createOpenCodeEngine(config: OpenCodeEngineConfig) {
  const { OpenCodeAgent } = await import('./opencode-agent');
  return new OpenCodeAgent({ userId: config.userId });
}