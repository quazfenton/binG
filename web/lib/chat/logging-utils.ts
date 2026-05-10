/**
 * Shared logging utilities for redacting sensitive data and recording tool call telemetry.
 * Consolidated from architecture-integration.ts and plan-act-verify.ts to avoid duplication.
 */
import { createChatLogger } from './chat-logger';

const log = createChatLogger('logging-utils');

/**
 * Redacts sensitive or large fields from tool arguments for safe logging.
 * Preserves file paths/names for traceability while redacting content.
 *
 * @param args - The tool arguments object to redact
 * @param options - Configuration options
 * @param options.maxStringLength - Max string length before truncation (default: 200)
 * @param options.maxObjectProps - Max properties to keep from objects (default: 5)
 * @param options.maxArrayItems - Max items to keep from arrays (default: 5)
 * @returns Redacted arguments safe for logging
 */
export function redactArgsForLogging(
  args: Record<string, unknown> | null | undefined,
  options: {
    maxStringLength?: number;
    maxObjectProps?: number;
    maxArrayItems?: number;
    deep?: boolean; // Enable deep redaction via JSON.stringify with sensitive key replacer
  } = {}
): Record<string, unknown> | string {
  const { maxStringLength = 200, maxObjectProps = 5, maxArrayItems = 5 } = options;

  if (!args || typeof args !== 'object') {
    return '<non-object-args>';
  }

  try {
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      const lowerKey = key.toLowerCase();

      // Redact sensitive fields
      if (
        lowerKey.includes('content') ||
        lowerKey.includes('body') ||
        lowerKey.includes('filecontents') ||
        lowerKey === 'contentencoded'
      ) {
        redacted[key] = '<redacted>';
        continue;
      }

      // Special-case files arrays - preserve path/name for traceability
      if (key === 'files' && Array.isArray(value)) {
        redacted[key] = value.map((f: unknown) => {
          if (f && typeof f === 'object' && !Array.isArray(f)) {
            const fileObj = f as Record<string, unknown>;
            return {
              path: fileObj.path ?? fileObj.name ?? '<file>',
              name: fileObj.name,
            };
          }
          return '<file>';
        });
        continue;
      }

      // Handle strings - truncate if too long
      if (typeof value === 'string') {
        if (value.length > maxStringLength * 5) {
          redacted[key] = value.substring(0, maxStringLength) + `...[TRUNCATED:${value.length}]`;
        } else if (value.length > maxStringLength) {
          redacted[key] = value.substring(0, maxStringLength) + '...[TRUNCATED]';
        } else {
          redacted[key] = value;
        }
        continue;
      }

      // Handle arrays - limit size
      if (Array.isArray(value)) {
        if (value.length > maxArrayItems) {
          redacted[key] = [
            ...value.slice(0, maxArrayItems).map((item) =>
              typeof item === 'object' && item !== null ? '<obj>' : item
            ),
            `... [+${value.length - maxArrayItems} more]`,
          ];
        } else {
          redacted[key] = value.map((item) =>
            typeof item === 'object' && item !== null ? '<obj>' : item
          );
        }
        continue;
      }

      // Handle nested objects - limit properties and recurse
      if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length > maxObjectProps) {
          const limited: Record<string, unknown> = {};
          for (const [k, v] of entries.slice(0, maxObjectProps)) {
            limited[k] = typeof v === 'string' && v.length > maxStringLength
              ? v.substring(0, maxStringLength) + '...[TRUNCATED]'
              : v;
          }
          const morePropsKey = `... [+${entries.length - maxObjectProps} more]`;
          redacted[key] = { ...limited, [morePropsKey]: true };
        } else {
          redacted[key] = value;
        }
        continue;
      }

      // Primitives pass through
      redacted[key] = value;
    }

    // Deep redaction mode: JSON.stringify with sensitive key replacer
    if (options.deep && args && typeof args === 'object') {
      try {
        const str = JSON.stringify(args);
        const deepRedacted = JSON.parse(str, (k, v) => {
          const lowerK = k.toLowerCase();
          if (lowerK.includes('secret') || lowerK.includes('token') ||
              lowerK.includes('password') || lowerK.includes('apikey') ||
              lowerK.includes('authorization')) {
            return '<redacted>';
          }
          return v;
        });
        // Apply shallow redaction limits on top of deep-redacted result
        return redactArgsForLogging(deepRedacted as Record<string, unknown>, { ...options, deep: false });
      } catch {
        // Fall through to shallow redaction
      }
    }

    return redacted;
  } catch {
    return '<unserializable-args>';
  }
}

/**
 * Creates a truncated origin stack for telemetry.
 * Captures the call site to help trace where malformed calls originate.
 *
 * @param maxLines - Maximum stack lines to keep (default: 7)
 * @returns Truncated stack string
 */
export function createOriginStack(maxLines = 7): string {
  try {
    const err = new Error();
    const stack = err.stack ?? '';
    const lines = stack.split('\n').slice(1, maxLines + 1); // Skip Error constructor line
    return lines.join('\n');
  } catch {
    return '<stack-unavailable>';
  }
}

/**
 * Records a tool call invocation payload for telemetry/debugging.
 * Uses the shared ToolCallTracker if available, otherwise no-ops.
 *
 * @param params - The payload parameters
 * @param params.toolName - Name of the tool called
 * @param params.redactedArgs - Pre-redacted args string
 * @param params.model - Model used (optional)
 * @param params.provider - Provider used (optional)
 * @param params.toolCallId - Tool call ID for correlation (optional)
 * @param params.originStack - Stack trace at call site (optional, auto-generated if not provided)
 */
export async function recordToolCallTelemetry(params: {
  toolName?: string;
  redactedArgs?: string;
  model?: string;
  provider?: string;
  toolCallId?: string | null;
  originStack?: string;
}): Promise<void> {
  try {
    const { toolCallTracker } = await import('./tool-call-tracker');

    toolCallTracker.recordInvocationPayload({
      timestamp: Date.now(),
      model: params.model,
      provider: params.provider,
      toolName: params.toolName,
      redactedArgs: params.redactedArgs,
      originStack: params.originStack ?? createOriginStack(),
      toolCallId: params.toolCallId ?? null,
    });
  } catch (err) {
    // Silent failure - telemetry should not break tool execution
    log.debug('Failed to record tool call telemetry:', err);
  }
}

/**
 * Generates a redacted args string for logging and creates origin stack in one call.
 * Convenience function for places that need both.
 *
 * @param args - Raw tool arguments
 * @param options - Redaction options
 * @returns Object with redacted args string and origin stack
 */
export function prepareTelemetryPayload(
  args: Record<string, unknown> | null | undefined,
  options?: { maxStringLength?: number; maxObjectProps?: number; maxArrayItems?: number }
): { redactedArgs: string; originStack: string } {
  const redacted = redactArgsForLogging(args, options);
  return {
    redactedArgs: typeof redacted === 'string' ? redacted : JSON.stringify(redacted),
    originStack: createOriginStack(),
  };
}