/**
 * Prompt Comparison API
 *
 * POST /api/prompts/compare - A/B test prompts
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Prompts:Compare');

// Custom error class for validation errors
class ComparisonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComparisonValidationError';
  }
}

export async function POST(request: NextRequest) {
  try {
    // TODO: Re-implement when prompt-service is available
    /*
    let body: any;

    // Parse JSON with proper error handling
    try {
      body = await request.json();
    } catch (parseError: any) {
      logger.warn('Invalid JSON in prompt comparison request:', parseError.message);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

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

    if (typeof input !== 'string') {
      return NextResponse.json(
        { error: 'Input must be a string' },
        { status: 400 }
      );
    }

    // Validate provider against whitelist
    const allowedProviders = ['openrouter', 'anthropic', 'google', 'mistral', 'openai'];
    if (provider && !allowedProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Unsupported provider. Must be one of: ${allowedProviders.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate model is a non-empty string if provided
    if (model && (typeof model !== 'string' || model.trim() === '')) {
      return NextResponse.json(
        { error: 'Model must be a non-empty string' },
        { status: 400 }
      );
    }

    const comparison = await comparePrompts({ templateA, templateB, input } as any) as any;

    // Validate comparison result structure
    if (!comparison || typeof comparison.winner === 'undefined') {
      logger.error('Invalid comparison result received');
      return NextResponse.json(
        { error: 'Invalid comparison result' },
        { status: 500 }
      );
    }

    logger.info('Prompts compared:', { winner: comparison.winner });

    return NextResponse.json({
      success: true,
      ...comparison,
    });
    */

    return NextResponse.json({ error: 'This endpoint is not implemented' }, { status: 501 });
  } catch (error: any) {
    // Use proper error class detection instead of brittle string matching
    if (error instanceof ComparisonValidationError || error.name === 'ComparisonValidationError') {
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
