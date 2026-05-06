import { NextRequest } from 'next/server';
import { POST as executePOST, GET as toolsGET } from './execute/gateway';

export async function GET(request: NextRequest) {
  return toolsGET(request);
}

export async function POST(request: NextRequest) {
  return executePOST(request);
}
