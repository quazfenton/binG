import { NextRequest } from 'next/server';
import { POST as executePOST, GET as templatesGET } from './execute/gateway';
import { GET as snippetsGET, POST as snippetsPOST } from './snippets/gateway';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'templates':
    case 'snippet':
      return snippetsGET(request);
    default:
      return templatesGET(request);
  }
}

export async function POST(request: NextRequest) {
  return executePOST(request);
}
