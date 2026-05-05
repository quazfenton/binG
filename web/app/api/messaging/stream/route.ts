import { NextRequest } from 'next/server';

export const runtime = 'edge';


export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return new Response("Missing email", { status: 400 });

  // 1. Identity Lookup (Standard Matrix Identity Server)
  try {
    const lookupRes = await fetch(`https://matrix.org/_matrix/identity/v2/lookup?medium=email&address=${email}`);
    const lookupData = await lookupRes.json();
    const matrixId = lookupData.mxid;

    if (!matrixId) return new Response("User not found", { status: 404 });

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    const interval = setInterval(() => {
      writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'ping', time: Date.now() })}\n\n`));
    }, 5000);

    req.signal.onabort = () => {
      clearInterval(interval);
      writer.close();
    };

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    return new Response("Lookup failed", { status: 500 });
  }
}
