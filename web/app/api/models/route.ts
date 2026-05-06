import { NextRequest, NextResponse } from 'next/server';

import { GET as modelsGET, POST as modelsPOST } from './compare/gateway';
import { GET as benchmarksGET } from './benchmarks/gateway';

// GET /api/models | /api/models/benchmarks
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && segments[2] === 'benchmarks') {
    return benchmarksGET();
  }

  return modelsGET();
}

// POST /api/models
export async function POST(request: NextRequest) {
  return modelsPOST(request);
}