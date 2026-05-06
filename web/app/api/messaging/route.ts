import { NextRequest } from 'next/server';
import { GET as searchGET } from './search/gateway';
import { POST as sendPOST } from './send/gateway';
import { GET as streamGET } from './stream/gateway';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'search':
      return searchGET(request);
    case 'stream':
      return streamGET(request);
    default:
      return searchGET(request);
  }
}

export async function POST(request: NextRequest) {
  return sendPOST(request);
}
