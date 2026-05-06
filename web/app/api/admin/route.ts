import { NextRequest, NextResponse } from 'next/server';
import { GET as rolesGET, POST as rolesPOST, DELETE as rolesDELETE } from './roles/gateway';

/**
 * Consolidated admin route
 * @deprecated Use subdirectory endpoints directly
 * Preserved original at ./main.ts
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'roles':
      return rolesGET(request);
    default:
      return new NextResponse(JSON.stringify({ error: 'Unknown action', available: ['roles'] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'roles':
      return rolesPOST(request);
    default:
      return new NextResponse(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
  }
}

export async function DELETE(request: NextRequest) {
  return rolesDELETE(request);
}