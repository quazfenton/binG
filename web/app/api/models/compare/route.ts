/**
 * Model Comparison API
 *
 * GET /api/models/compare - Get available models
 * POST /api/models/compare - Compare models
 * GET /api/models/benchmarks - Get benchmarks
 * GET /api/models/history - Get comparison history
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAvailableModels,
  compareModels,
  getModelBenchmarks,
  getComparisonHistory,
} from '@/lib/model-comparison/model-comparison';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Models');

// GET - List available models
export async function GET() {
  try {
    const models = await getAvailableModels();
    
    return NextResponse.json({
      success: true,
      models,
      count: models.length,
    });
  } catch (error: any) {
    logger.error('Failed to get models:', error);
    return NextResponse.json(
      { error: 'Failed to get models' },
      { status: 500 }
    );
  }
}

// POST - Compare models
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelIds, input } = body;

    if (!modelIds || !Array.isArray(modelIds) || modelIds.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 models required for comparison' },
        { status: 400 }
      );
    }

    if (!input || typeof input !== 'string') {
      return NextResponse.json(
        { error: 'Input is required' },
        { status: 400 }
      );
    }

    const comparison = await compareModels(modelIds, input);

    logger.info('Models compared:', { comparisonId: comparison.id });

    return NextResponse.json({
      success: true,
      ...comparison,
    });
  } catch (error: any) {
    logger.error('Failed to compare models:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to compare models' },
      { status: 500 }
    );
  }
}
