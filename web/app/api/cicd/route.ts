import { NextRequest } from 'next/server';
import { GET as pipelinesGET } from './pipelines/gateway';
import { POST as restartPOST } from './restart/[id]/gateway';

export async function GET(request: NextRequest) {
  return pipelinesGET(request);
}

export async function POST(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);
  // /api/cicd/restart/:id
  const id = pathParts[3] || '';
  return restartPOST(request, { params: Promise.resolve({ id }) });
}