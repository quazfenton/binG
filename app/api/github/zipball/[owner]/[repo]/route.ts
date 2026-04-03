/**
 * GitHub zipball proxy endpoint
 *
 * Fetches repo zipball server-side to bypass CORS restrictions,
 * then streams it to the client.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  const searchParams = request.nextUrl.searchParams;
  const ref = searchParams.get('ref') || '';

  const zipUrl = ref
    ? `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`
    : `https://api.github.com/repos/${owner}/${repo}/zipball`;

  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'binG-App/1.0',
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(zipUrl, {
      headers,
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `GitHub API error: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    // Get the zip as array buffer and forward it
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': buffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch zipball' },
      { status: 502 }
    );
  }
}
