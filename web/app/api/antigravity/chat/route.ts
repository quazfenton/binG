/**
 * Antigravity Chat API Route
 *
 * POST /api/antigravity/chat
 *
 * Body: { model: string, messages: [...], stream?: boolean, thinking?: {...} }
 *
 * Uses the authenticated user's Antigravity account(s) to make LLM requests.
 * Supports multi-account rotation for rate limit handling.
 * Falls back to master server account if user has no accounts.
 */

import { NextRequest, NextResponse } from 'next/server';


import { sendAntigravityChat, ANTIGRAVITY_MODELS } from '@/lib/llm/antigravity-provider';
import { getAntigravityAccounts, isMasterAccountConfigured } from '@/lib/database/antigravity-accounts';
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

    // Fetch user's Antigravity accounts from DB (includes master as fallback)
    const accounts = await getAntigravityAccounts(authResult.userId);

    if (!accounts.length) {
      return NextResponse.json(
        {
          error: 'No Antigravity accounts connected. Visit /api/antigravity/login to authenticate.',
          connectUrl: '/api/antigravity/login',
          availableModels: Object.keys(ANTIGRAVITY_MODELS),
        },
        { status: 400 }
      );
    }

    // Try each account with rate-limit fallback
    let lastError: Error | null = null;
    for (const account of accounts) {
      try {
        const response = await sendAntigravityChat({ model, messages, stream, thinking }, account);
        return NextResponse.json({
          ...response,
          model,
          account: {
            email: account.email,
            isMaster: account.isMaster || false,
          },
        });
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (lastError.message.includes('Rate limited')) {
          continue; // Try next account
        }
        throw lastError; // Non-rate-limit error — fail immediately
      }
    }

    return NextResponse.json(
      { error: `All accounts rate limited. Last error: ${lastError?.message}` },
      { status: 429 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Antigravity chat failed' },
      { status: 500 }
    );
  }
}
