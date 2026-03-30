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

    // Validate required fields
    if (!templateA || !templateB || !input) {
      return NextResponse.json(
        { error: 'Both templates and input are required' },
        { status: 400 }
      );
    }

    // Validate input types
    if (typeof templateA !== 'string' || typeof templateB !== 'string') {
      return NextResponse.json(
        { error: 'Templates must be strings' },
        { status: 400 }
      );
    }

    if (typeof input !== 'object' || input === null) {
      return NextResponse.json(
        { error: 'Input must be an object' },
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
    // Distinguish between validation errors and internal errors
    if (error instanceof Error && error.message.includes('Invalid')) {
      logger.warn('Validation error in prompt comparison:', error.message);
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    logger.error('Failed to compare prompts:', error);
    return NextResponse.json(
      { error: 'Failed to compare prompts' },
      { status: 500 }
    );
  }
}
