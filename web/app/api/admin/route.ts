import { NextRequest, NextResponse } from 'next/server';

import { GET as rolesGET, POST as rolesPOST, DELETE as rolesDELETE } from './roles/gateway';

// GET /api/admin/roles
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && segments[2] === 'roles') {
    return rolesGET(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// POST /api/admin/roles
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && segments[2] === 'roles') {
    return rolesPOST(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// DELETE /api/admin/roles
export async function DELETE(request: NextRequest) {
  return rolesDELETE(request);
}