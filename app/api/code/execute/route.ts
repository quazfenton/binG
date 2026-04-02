/**
 * Code Execution API
 *
 * POST /api/code/execute - Execute code
 * GET /api/code/templates - Get code templates
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeCode, getCodeTemplate, type CodeLanguage } from '@/lib/code-executor/code-executor';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Code:Execute');

// POST - Execute code
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, language, stdin, timeout } = body;

    // Validate input
    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Code is required' },
        { status: 400 }
      );
    }

    const validLanguages: CodeLanguage[] = [
      'javascript', 'typescript', 'python', 'html', 'css', 'sql', 'bash', 'json'
    ];

    if (!validLanguages.includes(language)) {
      return NextResponse.json(
        { error: `Invalid language. Must be one of: ${validLanguages.join(', ')}` },
        { status: 400 }
      );
    }

    // Execute code
    const result = await executeCode({
      code,
      language,
      stdin,
      timeout: Math.min(timeout || 10000, 30000), // Max 30s timeout
    });

    logger.info('Code executed:', { 
      language, 
      success: result.success, 
      executionTime: result.executionTime 
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    logger.error('Code execution failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute code' },
      { status: 500 }
    );
  }
}

// GET - Get code template
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const language = searchParams.get('language') as CodeLanguage;

    const validLanguages: CodeLanguage[] = [
      'javascript', 'typescript', 'python', 'html', 'css', 'sql', 'bash', 'json'
    ];

    if (!language || !validLanguages.includes(language)) {
      return NextResponse.json(
        { error: `Invalid language. Must be one of: ${validLanguages.join(', ')}` },
        { status: 400 }
      );
    }

    const template = getCodeTemplate(language);

    return NextResponse.json({
      success: true,
      language,
      template,
    });
  } catch (error: any) {
    logger.error('Failed to get template:', error);
    return NextResponse.json(
      { error: 'Failed to get template' },
      { status: 500 }
    );
  }
}
