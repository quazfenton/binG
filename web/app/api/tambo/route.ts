import { NextRequest } from 'next/server';
import { POST as tokenPOST, GET as tokenGET } from './oauth/token/gateway';

export async function GET(request: NextRequest) {
  return tokenGET();
}

export async function POST(request: NextRequest) {
  return tokenPOST(request);
}
