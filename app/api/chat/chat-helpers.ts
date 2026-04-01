/**
 * Chat Route Helpers
 *
 * Non-parser helpers extracted from route.ts. Response-text parsing now lives
 * in '@/lib/chat/file-edit-parser' so backend and UI consume the same logic.
 */

import { z } from 'zod';

// ============================================================================
// Zod Schemas
// ============================================================================

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.union([z.string(), z.array(z.any())]),
}).passthrough();

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, 'Messages array cannot be empty'),
  provider: z.string().min(1, 'Provider is required'),
  model: z.string().min(1, 'Model is required'),
  temperature: z.number().min(0).refine((val) => val <= 2, 'Temperature must be at most 2').optional().default(0.7),
  maxTokens: z.number().int().min(1).refine((val) => val <= 200000, 'Max tokens must be at most 200000').optional().default(100096),
  stream: z.boolean().optional().default(true),
  apiKeys: z.record(z.string()).optional().default({}),
  requestId: z.string().optional(),
  conversationId: z.string().optional(),
  agentMode: z.enum(['v1', 'v2', 'auto']).optional().default('auto'),
  mode: z.enum(['normal', 'enhanced', 'max']).optional().default('max'),
  filesystemContext: z.object({
    attachedFiles: z.any().optional(),
    applyFileEdits: z.boolean().optional(),
    scopePath: z.string().optional(),
  }).optional(),
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Apply search/replace to content
 */
export function applySearchReplace(content: string, search: string, replace: string): string {
  const idx = content.indexOf(search);
  if (idx === -1) return content;
  return content.slice(0, idx) + replace + content.slice(idx + search.length);
}

/**
 * Poll with exponential backoff
 */
export async function pollWithBackoff<T>(
  fetcher: () => Promise<T | null>,
  isDone: (v: T) => boolean,
  options: { maxWaitMs: number; initialIntervalMs?: number; maxIntervalMs?: number },
): Promise<T> {
  const { maxWaitMs, initialIntervalMs = 500, maxIntervalMs = 5_000 } = options;
  const deadline = Date.now() + maxWaitMs;
  let interval = initialIntervalMs;

  while (Date.now() < deadline) {
    const result = await fetcher();
    if (result !== null && isDone(result)) return result;
    await new Promise(resolve => setTimeout(resolve, interval));
    interval = Math.min(interval * 1.5, maxIntervalMs);
  }

  throw new Error('Polling timed out');
}

/**
 * Build client-visible unified response
 * Preserves filesystem metadata for enhanced-diff-viewer display
 */
export function buildClientVisibleUnifiedResponse(response: any, visibleContent: string): any {
  return {
    ...response,
    content: visibleContent,
    data: {
      ...(response?.data || {}),
      content: visibleContent,
    },
    metadata: {
      ...(response?.metadata || {}),
      sanitized: true,
      // Preserve filesystem metadata for enhanced-diff-viewer
      filesystem: response?.metadata?.filesystem,
      fileEdits: response?.metadata?.fileEdits,
    },
  };
}
