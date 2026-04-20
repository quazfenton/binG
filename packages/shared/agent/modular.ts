/**
 * Modular Agent Type Definitions
 *
 * Placeholder - actual implementation may be in a different location
 */

export interface ModularConfig {
  mode?: string;
  header?: string;
}

export async function getOrchestrationModeFromRequest(req: Request): Promise<string> {
  return req.headers.get('x-orchestration-mode') || 'default';
}

export async function executeWithOrchestrationMode<T>(req: Request, fn: () => T): Promise<T> {
  return fn();
}