import { NextRequest } from 'next/server';
import { POST as audioPOST } from './audio/gateway';
import { POST as inferencePOST } from './inference/gateway';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint');

  switch (endpoint) {
    case 'audio':
      return audioPOST(request);
    case 'inference':
    default:
      return inferencePOST(request);
  }
}
