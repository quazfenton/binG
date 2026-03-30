/**
 * Prompt Comparison API
 *
 * POST /api/prompts/compare - A/B test prompts
 */

import { NextRequest, NextResponse } from 'next/server';
import { comparePrompts } from '@/lib/prompt-engineering/prompt-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Prompts:Compare');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { templateA, templateB, input, provider, model } = body;

    if (!templateA || !templateB || !input) {
      return NextResponse.json(
        { error: 'Both templates and input are required' },
        { status: 400 }
      );
    }

    const comparison = await comparePrompts(templateA, templateB, input, provider || 'openrouter', model || 'default');

    logger.info('Prompts compared:', { winner: comparison.winner });

    return NextResponse.json({
      success: true,
      ...comparison,
    });
  } catch (error: any) {
    logger.error('Failed to compare prompts:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to compare prompts' },
      { status: 500 }
    );
  }
}
