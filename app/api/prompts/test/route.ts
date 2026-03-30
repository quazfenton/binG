/**
 * Prompt Testing API
 *
 * POST /api/prompts/test - Test prompt with LLM
 * GET /api/prompts/test - Get test history
 */

import { NextRequest, NextResponse } from 'next/server';
import { testPrompt, getTestHistory } from '@/lib/prompt-engineering/prompt-service';
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
