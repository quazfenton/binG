import { NextRequest } from 'next/server';
import { POST as agentsPOST, DELETE as agentsDELETE } from './agents/gateway';
import { GET as agentsListGET } from './agents/list/gateway';
import { GET as statsGET } from './stats/gateway';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get('resource');

  switch (resource) {
    case 'agents':
      return agentsListGET();
    case 'stats':
    default:
      return statsGET();
  }
}

export async function POST(request: NextRequest) {
  return agentsPOST(request);
}

export async function DELETE(request: NextRequest) {
  return agentsDELETE(request);
}
