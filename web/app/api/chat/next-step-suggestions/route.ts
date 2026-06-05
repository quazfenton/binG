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
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateNextStepSuggestions } from '@/lib/chat/next-step-suggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  recentPrompts?: string[];
  lastResponse?: string;
  messageId?: string;
}

const MAX_PROMPTS = 2;
const MAX_PROMPT_CHARS = 2000;
const MAX_RESPONSE_CHARS = 8000;

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
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

  if (!lastResponse.trim()) {
    return NextResponse.json(
      { success: false, error: 'lastResponse is required' },
      { status: 400 },
    );
  }

  const cappedResponse =
    lastResponse.length > MAX_RESPONSE_CHARS
      ? lastResponse.slice(0, MAX_RESPONSE_CHARS)
      : lastResponse;

  try {
    const suggestions = await generateNextStepSuggestions(
      recentPrompts,
      cappedResponse,
    );

    return NextResponse.json({
      success: true,
      data: {
        suggestions,
        messageId: typeof body.messageId === 'string' ? body.messageId : null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Failed to generate suggestions',
      },
      { status: 500 },
    );
  }
}
