/**
 * Prompt Testing API
 *
 * POST /api/prompts/test - Test prompt with LLM
 * GET /api/prompts/test - Get test history
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Prompts:Test');

// Custom error class for validation errors
class PromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptValidationError';
  }
}

// POST - Test prompt
export async function POST(request: NextRequest) {
  try {
    // TODO: Re-implement when prompt-service is available
    /*
    const body = await request.json();
    const { template, input, provider, model, variables } = body;

    // Validate required fields
    if (!template || !input) {
      return NextResponse.json(
        { error: 'Template and input are required' },
        { status: 400 }
      );
    }

    // Validate input types
    if (typeof template !== 'string') {
      return NextResponse.json(
        { error: 'Template must be a string' },
        { status: 400 }
      );
    }

    if (typeof input !== 'object' || input === null) {
      return NextResponse.json(
        { error: 'Input must be an object' },
        { status: 400 }
      );
    }

    if (variables && typeof variables !== 'object') {
      return NextResponse.json(
        { error: 'Variables must be an object' },
        { status: 400 }
      );
    }

    const result = await testPrompt({ template, input } as any) as any;

    logger.info('Prompt tested:', { result });

    return NextResponse.json({
      success: true,
      ...result,
    });
    */

    return NextResponse.json({ error: 'This endpoint is not implemented' }, { status: 501 });
  } catch (error: any) {
    // Use proper error class detection instead of brittle string matching
    if (error instanceof PromptValidationError || error.name === 'PromptValidationError') {
      logger.warn('Validation error in prompt test:', error.message);
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    logger.error('Failed to test prompt:', error);
    return NextResponse.json(
      { error: 'Failed to test prompt' },
      { status: 500 }
    );
  }
}

// GET - Get test history
export async function GET(request: NextRequest) {
  try {
    // TODO: Re-implement when prompt-service is available
    /*
    const searchParams = request.nextUrl.searchParams;
    const templateId = searchParams.get('templateId') || undefined;

    // Parse limit with proper NaN handling
    let limit = parseInt(searchParams.get('limit') || '50', 10);
    if (isNaN(limit) || limit < 1) {
      limit = 50;
    }
    // Cap limit to prevent excessive data retrieval (max 100)
    limit = Math.min(limit, 100);

    const history = await getTestHistory(templateId) as any;

    return NextResponse.json({
      success: true,
      history,
      count: history.length,
    });
    */

    return NextResponse.json({ error: 'This endpoint is not implemented' }, { status: 501 });
  } catch (error: any) {
    logger.error('Failed to get test history:', error);
    return NextResponse.json(
      { error: 'Failed to get test history' },
      { status: 500 }
    );
  }
}
