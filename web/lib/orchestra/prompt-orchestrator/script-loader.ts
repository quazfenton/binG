/**
 * prompt-orchestrator/script-loader.ts
 *
 * Loads a prompt script from disk. Scripts are JSON files (chosen over YAML
 * to avoid adding a runtime parser dependency — see thinker's design notes).
 *
 * Expected file shape (see types.ts):
 *   {
 *     "promptId": "onboarding-v1",
 *     "steps": [
 *       { "step": "1", "mode": "append", "payload": "..." }
 *     ]
 *   }
 *
 * This module does a single `JSON.parse` round-trip + a minimal shape
 * validation. Production deployments may want to add a Zod schema here.
 */
import { readFileSync } from 'fs';
import type { PromptScript } from './types';

/** Thrown when a script file is missing, unreadable, or malformed. */
export class ScriptLoadError extends Error {
  constructor(message: string, public readonly filePath: string) {
    super(`${message} (filePath=${filePath})`);
    this.name = 'ScriptLoadError';
  }
}

/** Minimal shape validation. Throws ScriptLoadError on the first bad field. */
function validateScript(parsed: unknown, filePath: string): asserts parsed is PromptScript {
  if (!parsed || typeof parsed !== 'object') {
    throw new ScriptLoadError('script root is not an object', filePath);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.promptId !== 'string' || obj.promptId.length === 0) {
    throw new ScriptLoadError('script.promptId must be a non-empty string', filePath);
  }
  if (!Array.isArray(obj.steps)) {
    throw new ScriptLoadError('script.steps must be an array', filePath);
  }
  for (let i = 0; i < obj.steps.length; i++) {
    const step = obj.steps[i] as Record<string, unknown>;
    if (typeof step.step !== 'string' || step.step.length === 0) {
      throw new ScriptLoadError(`script.steps[${i}].step must be a non-empty string`, filePath);
    }
    if (typeof step.mode !== 'string' || step.mode.length === 0) {
      throw new ScriptLoadError(`script.steps[${i}].mode must be a non-empty string`, filePath);
    }
    if (typeof step.payload !== 'string') {
      throw new ScriptLoadError(`script.steps[${i}].payload must be a string`, filePath);
    }
  }
}

/** Load a prompt script from a JSON file on disk. Throws ScriptLoadError on bad input. */
export function loadScript(filePath: string): PromptScript {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScriptLoadError(`failed to read script file: ${msg}`, filePath);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScriptLoadError(`failed to parse script JSON: ${msg}`, filePath);
  }
  validateScript(parsed, filePath);
  return parsed;
}
