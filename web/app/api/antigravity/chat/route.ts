/**
 * Antigravity Chat API Route
 *
 * POST /api/antigravity/chat
 *
 * Body: { model: string, messages: [...], stream?: boolean, thinking?: {...} }
 *
 * Uses the authenticated user's Antigravity account(s) to make LLM requests.
 * Supports multi-account rotation for rate limit handling.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendAntigravityChat, ANTIGRAVITY_MODELS } from '@/lib/llm/antigravity-provider';
import { verifyAuth } from '@/lib/auth/jwt';

export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { model, messages, stream, thinking } = body;

    if (!model || !messages) {
      return NextResponse.json(
        { error: 'model and messages are required' },
        { status: 400 }
      );
    }

    if (!ANTIGRAVITY_MODELS[model]) {
      return NextResponse.json(
        { error: `Unknown model: ${model}. Available: ${Object.keys(ANTIGRAVITY_MODELS).join(', ')}` },
        { status: 400 }
      );
    }

    // TODO: Fetch user's Antigravity accounts from DB
    // const accounts = await db.antigravityAccounts.findMany({
    //   where: { userId: authResult.userId, enabled: true },
    // });
    //
    // if (!accounts.length) {
    //   return NextResponse.json(
    //     { error: 'No Antigravity accounts connected. Visit /api/antigravity/login to authenticate.' },
    //     { status: 400 }
    //   );
    // }

    // For now, return placeholder — accounts need to be stored in DB first
    return NextResponse.json({
      message: 'Antigravity chat endpoint ready. Connect accounts via /api/antigravity/login first.',
      availableModels: Object.keys(ANTIGRAVITY_MODELS),
    });

    // Once accounts are stored, use this pattern:
    // let lastError: Error | null = null;
    // for (const account of accounts) {
    //   try {
    //     const response = await sendAntigravityChat({ model, messages, stream, thinking }, account);
    //     return NextResponse.json(response);
    //   } catch (e) {
    //     lastError = e instanceof Error ? e : new Error(String(e));
    //     if (lastError.message.includes('Rate limited')) continue; // Try next account
    //     throw lastError; // Non-rate-limit error — fail immediately
    //   }
    // }
    // return NextResponse.json({ error: `All accounts rate limited. Last error: ${lastError?.message}` }, { status: 429 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Antigravity chat failed' },
      { status: 500 }
    );
  }
}
