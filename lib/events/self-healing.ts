/**
 * Self-Healing - LLM-based error recovery for failed events
 *
 * Analyzes failed events and attempts to generate fixes automatically.
 * Supports multiple healing strategies with confidence scoring.
 *
 * @module events/self-healing
 */

import { EventRecord } from './store';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:SelfHealing');

/**
 * Self-healing result
 */
export interface HealingResult {
  success: boolean;
  fix?: string;
  explanation?: string;
  confidence: number;
  strategy: 'llm' | 'retry' | 'fallback' | 'skip';
}

/**
 * Error classification
 */
export interface ErrorClassification {
  type: 'network' | 'timeout' | 'validation' | 'permission' | 'resource' | 'unknown';
  severity: 'low' | 'medium' | 'high';
  recoverable: boolean;
  suggestedAction: 'retry' | 'fix' | 'skip' | 'escalate';
}

/**
 * Attempt self-healing for a failed event
 */
export async function attemptSelfHealing(
  event: EventRecord,
  error: any
): Promise<HealingResult> {
  logger.info('Attempting self-healing', {
    eventId: event.id,
    type: event.type,
    retryCount: event.retryCount,
  });

  // 1. Classify the error
  const classification = classifyError(error);

  // 2. Determine healing strategy
  const strategy = determineStrategy(classification, event);

  // 3. Execute healing
  switch (strategy) {
    case 'retry':
      return await healWithRetry(event, classification);
    case 'fix':
      return await healWithLLM(event, error, classification);
    case 'fallback':
      return await healWithFallback(event, classification);
    case 'skip':
      return {
        success: false,
        confidence: 1.0,
        strategy: 'skip',
        explanation: 'Error not recoverable, skipping',
      };
    default:
      return {
        success: false,
        confidence: 0.5,
        strategy: 'skip',
        explanation: 'Unknown strategy',
      };
  }
}

/**
 * Classify error type and severity
 */
function classifyError(error: any): ErrorClassification {
  const message = error.message?.toLowerCase() || '';

  // Network errors
  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
    return {
      type: 'network',
      severity: 'medium',
      recoverable: true,
      suggestedAction: 'retry',
    };
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      type: 'timeout',
      severity: 'medium',
      recoverable: true,
      suggestedAction: 'retry',
    };
  }

  // Validation errors
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    return {
      type: 'validation',
      severity: 'high',
      recoverable: false,
      suggestedAction: 'fix',
    };
  }

  // Permission errors
  if (message.includes('permission') || message.includes('unauthorized') || message.includes('forbidden')) {
    return {
      type: 'permission',
      severity: 'high',
      recoverable: false,
      suggestedAction: 'escalate',
    };
  }

  // Resource errors
  if (message.includes('resource') || message.includes('quota') || message.includes('limit')) {
    return {
      type: 'resource',
      severity: 'high',
      recoverable: true,
      suggestedAction: 'retry',
    };
  }

  // Unknown errors
  return {
    type: 'unknown',
    severity: 'medium',
    recoverable: true,
    suggestedAction: 'retry',
  };
}

/**
 * Determine healing strategy based on error classification
 */
function determineStrategy(classification: ErrorClassification, event: EventRecord): 'retry' | 'fix' | 'fallback' | 'skip' {
  // If already retried 3 times, try LLM fix
  if (event.retryCount >= 3) {
    return classification.recoverable ? 'fix' : 'skip';
  }

  // Network/timeout errors → retry
  if (classification.type === 'network' || classification.type === 'timeout') {
    return 'retry';
  }

  // Validation errors → LLM fix
  if (classification.type === 'validation') {
    return 'fix';
  }

  // Permission errors → escalate (skip)
  if (classification.type === 'permission') {
    return 'skip';
  }

  // Resource errors → retry with backoff
  if (classification.type === 'resource') {
    return 'retry';
  }

  // Default → retry
  return 'retry';
}

/**
 * Heal with simple retry (with exponential backoff)
 */
async function healWithRetry(event: EventRecord, classification: ErrorClassification): Promise<HealingResult> {
  const backoffMs = Math.min(1000 * Math.pow(2, event.retryCount), 10000);

  logger.info('Retrying with backoff', {
    eventId: event.id,
    backoffMs,
  });

  // Wait for backoff period
  await new Promise((resolve) => setTimeout(resolve, backoffMs));

  return {
    success: true,
    confidence: 0.7,
    strategy: 'retry',
    explanation: `Retrying after ${backoffMs}ms backoff`,
  };
}

/**
 * Heal with LLM-generated fix
 */
async function healWithLLM(
  event: EventRecord,
  error: any,
  classification: ErrorClassification
): Promise<HealingResult> {
  try {
    // Get LLM service
    const { llmService } = await import('@/lib/chat/llm-providers');

    // Generate fix prompt
    const prompt = `
An event failed with the following error:
Error: ${error.message}
Event Type: ${event.type}
Event Payload: ${JSON.stringify(event.payload, null, 2)}
Retry Count: ${event.retryCount}

Analyze this failure and suggest a fix.
If the error is due to invalid input, suggest how to correct it.
If the error is due to a missing resource, suggest how to obtain it.
If the error cannot be fixed automatically, explain why.

Respond with JSON:
{
  "fix": "description of the fix or corrected input",
  "explanation": "brief explanation of what went wrong",
  "confidence": 0.0-1.0,
  "canAutoFix": true/false
}
`.trim();

    // Generate response
    const response = await llmService.generateResponse({
      provider: 'openrouter',
      model: 'anthropic/claude-3-5-sonnet',
      messages: [
        {
          role: 'system',
          content: 'You are a self-healing system that analyzes failures and suggests fixes. Respond with JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      maxTokens: 1000,
      temperature: 0.3,
    });

    // Parse response
    const parsed = parseLLMResponse(response.content);

    if (!parsed || !parsed.canAutoFix || (parsed.confidence ?? 0) < 0.6) {
      return {
        success: false,
        confidence: parsed?.confidence ?? 0.3,
        strategy: 'skip',
        explanation: parsed?.explanation ?? 'LLM could not generate a reliable fix',
      };
    }

    return {
      success: true,
      fix: parsed.fix,
      explanation: parsed.explanation,
      confidence: parsed.confidence,
      strategy: 'llm',
    };
  } catch (llmError: any) {
    logger.error('LLM healing failed', { error: llmError.message });

    return {
      success: false,
      confidence: 0.0,
      strategy: 'skip',
      explanation: `LLM healing failed: ${llmError.message}`,
    };
  }
}

/**
 * Heal with fallback strategy
 */
async function healWithFallback(
  event: EventRecord,
  classification: ErrorClassification
): Promise<HealingResult> {
  // Try alternative approach (e.g., use cached data, skip non-critical step)
  logger.info('Using fallback strategy', { eventId: event.id });

  return {
    success: true,
    confidence: 0.5,
    strategy: 'fallback',
    explanation: 'Using fallback approach',
  };
}

/**
 * Parse LLM response JSON
 */
function parseLLMResponse(content: string): {
  fix?: string;
  explanation?: string;
  confidence?: number;
  canAutoFix?: boolean;
} | null {
  try {
    // Look for JSON in response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error: any) {
    logger.warn('Failed to parse LLM response', { error: error.message, content });
    return null;
  }
}

/**
 * Apply fix to event payload
 */
export async function applyFix(event: EventRecord, fix: string): Promise<void> {
  const db = require('@/lib/database/connection').getDatabase();

  // Parse current payload
  const currentPayload = JSON.parse(event.payload);

  // Apply fix (this is simplified - actual implementation depends on fix format)
  const updatedPayload = {
    ...currentPayload,
    _fixApplied: fix,
    _fixTimestamp: new Date().toISOString(),
  };

  // Update event
  db.prepare(`
    UPDATE events
    SET payload = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(updatedPayload), event.id);

  logger.info('Fix applied to event', { eventId: event.id });
}

/**
 * Get healing history for an event
 */
export async function getHealingHistory(eventId: string): Promise<any[]> {
  const db = require('@/lib/database/connection').getDatabase();

  const rows = db.prepare(`
    SELECT * FROM event_healing_log
    WHERE event_id = ?
    ORDER BY created_at DESC
  `).all(eventId) as any[];

  return rows;
}

/**
 * Log healing attempt
 */
export async function logHealingAttempt(
  eventId: string,
  strategy: string,
  success: boolean,
  explanation?: string
): Promise<void> {
  const db = require('@/lib/database/connection').getDatabase();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO event_healing_log
    (id, event_id, strategy, success, explanation, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(id, eventId, strategy, success ? 1 : 0, explanation);
}

/**
 * Initialize healing log table
 */
export async function initializeHealingLog(): Promise<void> {
  const db = require('@/lib/database/connection').getDatabase();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS event_healing_log (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      explanation TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_healing_log_event_id ON event_healing_log(event_id)').run();

  logger.info('Healing log initialized');
}
