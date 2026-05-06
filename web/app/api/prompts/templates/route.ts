/**
 * Prompt Lab API
 *
 * GET /api/prompts/templates - List templates
 * POST /api/prompts/templates - Create template
 * PUT /api/prompts/templates/:id - Update template
 * DELETE /api/prompts/templates/:id - Delete template
 * POST /api/prompts/test - Test prompt
 * POST /api/prompts/compare - Compare prompts
 * GET /api/prompts/history - Get test history
 */

import { NextRequest, NextResponse } from 'next/server';


import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Prompts');

// GET - List templates
export async function GET(request: NextRequest) {
  try {
    // TODO: Re-implement when prompt-service is available
    /*
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category') as PromptCategory | undefined;

    const templates = await getTemplates(category);

    return NextResponse.json({
      success: true,
      templates,
      count: templates.length,
    });
    */

    return NextResponse.json({ error: 'This endpoint is not implemented' }, { status: 501 });
  } catch (error: any) {
    logger.error('Failed to get templates:', error);
    return NextResponse.json(
      { error: 'Failed to get templates' },
      { status: 500 }
    );
  }
}

// POST - Create template
export async function POST(request: NextRequest) {
  try {
    // TODO: Re-implement when prompt-service is available
    /*
    const body = await request.json();
    const template = await createTemplate(body);

    logger.info('Template created:', { id: template.id });

    return NextResponse.json({
      success: true,
      template,
    });
    */

    return NextResponse.json({ error: 'This endpoint is not implemented' }, { status: 501 });
  } catch (error: any) {
    logger.error('Failed to create template:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create template' },
      { status: 500 }
    );
  }
}
