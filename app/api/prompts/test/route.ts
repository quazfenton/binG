/**
 * Prompt Testing API
 *
 * POST /api/prompts/test - Test prompt with LLM
 * POST /api/prompts/compare - A/B test prompts
 * GET /api/prompts/history - Get test history
 */

import { NextRequest, NextResponse } from 'next/server';
import { testPrompt, comparePrompts, getTestHistory } from '@/lib/prompt-engineering/prompt-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Prompts:Test');

// POST - Test prompt
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { template, input, provider, model, variables } = body;

    if (!template || !input) {
      return NextResponse.json(
        { error: 'Template and input are required' },
        { status: 400 }
      );
    }

    const result = await testPrompt(template, input, provider || 'openrouter', model || 'default', variables);

    logger.info('Prompt tested:', { result });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    logger.error('Failed to test prompt:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to test prompt' },
      { status: 500 }
    );
  }
}

// POST - Compare prompts (A/B test)
export async function POST_COMPARE(request: NextRequest) {
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

// GET - Get test history
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const templateId = searchParams.get('templateId') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');

    const history = await getTestHistory(templateId, limit);

    return NextResponse.json({
      success: true,
      history,
      count: history.length,
    });
  } catch (error: any) {
    logger.error('Failed to get test history:', error);
    return NextResponse.json(
      { error: 'Failed to get test history' },
      { status: 500 }
    );
  }
}
