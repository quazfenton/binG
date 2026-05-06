import { NextRequest } from 'next/server';
import { POST as tokenPOST } from './token/gateway';

export async function POST(request: NextRequest) {
  return tokenPOST(request);
}
