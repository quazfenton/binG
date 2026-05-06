import { NextRequest } from 'next/server';
import { GET as modelsGET, POST as modelsPOST } from './compare/gateway';
import { GET as benchmarksGET } from './benchmarks/gateway';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get('resource');

  if (resource === 'benchmarks') {
    return benchmarksGET();
  }
  return modelsGET();
}

export async function POST(request: NextRequest) {
  return modelsPOST(request);
}
