/**
 * Next-Step Suggestions API
 *
 * Server route that generates 3 next-step suggestions for the user to
 * pick from after a chat turn appears to be complete.
 *
 * Trigger contract (client side):
 *  - Stream has emitted `done`/`finish`.
 *  - No autocontinue marker was emitted during the stream.
 *  - The last response is not a question awaiting user input (we
 *    still allow it but the prompt instructs the model to skip
 *    clarifications in that case).
 *  - No pending plan-act-verify steps remain.
 *
 * The route is intentionally lightweight: it accepts a small payload
 * (recent prompts + last response), runs the fast-model pipeline,
 * and returns up to 3 suggestions. The client caches the latest
 * suggestions per message so they persist as the user scrolls up.
 *
 * Hardening:
 *  - Content-Length is checked first to avoid buffering huge bodies
 *    into memory before parsing.
 *  - Per-process rate limit (token bucket) prevents a single client
 *    from burning provider quota.
 *  - No auth is enforced: the endpoint only consumes conversation
 *    text the client already saw, and we deliberately want anonymous
 *    visitors to benefit from suggestions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateNextStepSuggestions } from '@/lib/chat/next-step-suggestions';
import { createLogger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  recentPrompts?: string[];
  lastResponse?: string;
  messageId?: string;
  /** True only when prior turns produced at least one successful file edit.
   *  When absent/false the endpoint skips the LLM call and returns 0 suggestions. */
  hasFileEdits?: boolean;
}

const MAX_PROMPTS = 2;
const MAX_PROMPT_CHARS = 2000;
const MAX_RESPONSE_CHARS = 8000;
const MAX_BODY_BYTES = 64 * 1024; // 64 KiB hard cap on request body
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20; // 20 req/min per IP

const logger = createLogger('api:chat:next-step-suggestions');

// ----- Rate limit (in-memory token bucket) ---------------------------------
const buckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  bucket.count++;
  return true;
}

function getRateLimitKey(req: NextRequest): string {
  // Use the first IP in X-Forwarded-For, falling back to a constant so
  // we never throw on missing headers.
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'anon';
}

export async function POST(req: NextRequest) {
  const rateKey = getRateLimitKey(req);
  if (!checkRateLimit(rateKey)) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  // Pre-check body size to avoid buffering a huge payload into memory.
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { success: false, error: 'Request body too large' },
      { status: 413 },
    );
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to read request body' },
      { status: 400 },
    );
  }

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { success: false, error: 'Request body too large' },
      { status: 413 },
    );
  }

  let body: RequestBody;
  try {
    body = JSON.parse(raw) as RequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const recentPrompts = Array.isArray(body.recentPrompts)
    ? body.recentPrompts
        .filter((p) => typeof p === 'string' && p.trim().length > 0)
        .slice(-MAX_PROMPTS)
        .map((p) => (p.length > MAX_PROMPT_CHARS ? p.slice(0, MAX_PROMPT_CHARS) : p))
    : [];

  const lastResponse =
    typeof body.lastResponse === 'string' ? body.lastResponse : '';

  // Skip suggestions entirely when the prior turn produced no file edits.
  // The LLM cannot suggest meaningful next steps if the conversation
  // only contains chat (no files were touched) or all turns failed.
  if (!body.hasFileEdits) {
    return NextResponse.json({ success: true, suggestions: [] });
  }

  if (!lastResponse.trim()) {
    return NextResponse.json({ success: false, error: 'lastResponse is required' }, { status: 400 });
  }

  const cappedResponse =
    lastResponse.length > MAX_RESPONSE_CHARS
      ? lastResponse.slice(0, MAX_RESPONSE_CHARS)
      : lastResponse;

  const messageId =
    typeof body.messageId === 'string' && body.messageId.length <= 128
      ? body.messageId
      : null;

  const start = Date.now();

  // Skip expensive LLM call if the last response was an error.
  // This prevents wasting ~100s of API quota on a failure that already
  // returned no useful content. Covers timeouts, 500s, model errors, etc.
  const errorPatterns = [
    'timeout', 'timed out', 'error', '500', 'internal server error',
    'failed', 'unavailable', 'service unavailable', 'rate limit',
    'rate_limit', 'quota exceeded', 'billing', 'invalid api',
    'unauthorized', 'connection refused', 'network error',
  ];
  const responseLower = cappedResponse.toLowerCase();
  if (errorPatterns.some((p) => responseLower.includes(p))) {
    logger.debug('skipping suggestions — lastResponse appears to be an error', {
      messageId,
      elapsedMs: Date.now() - start,
    });
    return NextResponse.json({
      success: true,
      data: { suggestions: [], messageId },
    });
  }

  try {
    const suggestions = await generateNextStepSuggestions(
      recentPrompts,
      cappedResponse,
      messageId ? `nextstep-${messageId}` : undefined,
    );

    logger.debug('generated', {
      messageId,
      suggestions: suggestions.length,
      elapsedMs: Date.now() - start,
    });

    return NextResponse.json({
      success: true,
      data: {
        suggestions,
        messageId,
      },
    });
  } catch (err: any) {
    logger.warn('generation failed', {
      messageId,
      elapsedMs: Date.now() - start,
      error: err?.message,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate suggestions',
      },
      { status: 500 },
    );
  }
}
