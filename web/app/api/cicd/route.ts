import { NextRequest } from 'next/server';
import { GET as pipelinesGET } from './pipelines/gateway';
import { POST as restartPOST } from './restart/[id]/gateway';

export async function GET(request: NextRequest) {
  return pipelinesGET(request);
}

export async function POST(request: NextRequest) {
  return restartPOST(request);
}