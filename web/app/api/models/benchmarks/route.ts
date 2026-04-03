/**
 * Model Benchmarks API
 *
 * GET /api/models/benchmarks - Get model benchmarks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getModelBenchmarks } from '@/lib/model-comparison/model-comparison';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Models:Benchmarks');

export async function GET() {
  try {
    const benchmarks = await getModelBenchmarks();
    
    return NextResponse.json({
      success: true,
      benchmarks,
    });
  } catch (error: any) {
    logger.error('Failed to get benchmarks:', error);
    return NextResponse.json(
      { error: 'Failed to get benchmarks' },
      { status: 500 }
    );
  }
}
