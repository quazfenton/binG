import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, config } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const existing = sandboxBridge.getSessionByUserId(userId);
    if (existing) {
      return NextResponse.json({ session: existing });
    }

    const session = await sandboxBridge.createWorkspace(userId, config);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const session = sandboxBridge.getSessionByUserId(userId);
  if (!session) {
    return NextResponse.json({ error: 'No active session' }, { status: 404 });
  }

  return NextResponse.json({ session });
}

export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const sandboxId = req.nextUrl.searchParams.get('sandboxId');
  if (!sessionId || !sandboxId) {
    return NextResponse.json({ error: 'sessionId and sandboxId are required' }, { status: 400 });
  }

  await sandboxBridge.destroyWorkspace(sessionId, sandboxId);
  return NextResponse.json({ success: true });
}
