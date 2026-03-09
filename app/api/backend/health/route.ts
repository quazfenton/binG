import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    let wsServer: any = null;
    try {
      const { webSocketTerminalServer } = await import('@/lib/backend/websocket-terminal');
      wsServer = webSocketTerminalServer;
    } catch {
      // WS module not available
    }

    return NextResponse.json({
      status: 'healthy',
      version: '1.0.0',
      services: {
        websocket: !!wsServer,
        storage: true,
        runtime: true,
        metrics: true,
      },
      activeSessions: wsServer?.getActiveSessions?.() ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'unhealthy', error: error.message },
      { status: 500 },
    );
  }
}
