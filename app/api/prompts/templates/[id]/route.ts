/**
 * Prompt Template Management API
 *
 * PUT /api/prompts/templates/:id - Update template
 * DELETE /api/prompts/templates/:id - Delete template
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateTemplate, deleteTemplate } from '@/lib/prompt-engineering/prompt-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Prompts:Manage');

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    const template = await updateTemplate(id, body);
    
    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }
    
    logger.info('Template updated:', { id });
    
    return NextResponse.json({
      success: true,
      template,
    });
  } catch (error: any) {
    logger.error('Failed to update template:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update template' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const success = await deleteTemplate(id);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }
    
    logger.info('Template deleted:', { id });
    
    return NextResponse.json({
      success: true,
      message: 'Template deleted',
    });
  } catch (error: any) {
    logger.error('Failed to delete template:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete template' },
      { status: 500 }
    );
  }
}
