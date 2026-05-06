import { NextRequest, NextResponse } from 'next/server';


import { MessagingIdentity } from '@/lib/messaging/identity';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q');
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await MessagingIdentity.searchUsers(query);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
