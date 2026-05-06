import { NextRequest } from 'next/server';
import { POST as shortenPOST } from './shorten/gateway';

export async function POST(request: NextRequest) {
  return shortenPOST(request);
}
