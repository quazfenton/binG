/**
 * GitHub zipball proxy endpoint
 *
 * Fetches repo zipball server-side to bypass CORS restrictions,
 * then streams it to the client.
 */

import { NextRequest, NextResponse } from 'next/server';



// Validate GitHub owner/repo format (alphanumeric, dashes, underscores, dots)
function isValidOwnerOrRepo(value: string): boolean {
  return /^[\w.-]+$/.test(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  
  // Validate inputs to prevent injection/malformed URLs
  if (!isValidOwnerOrRepo(owner) || !isValidOwnerOrRepo(repo)) {
    return NextResponse.json(
      { error: 'Invalid owner or repo format' },
      { status: 400 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const ref = searchParams.get('ref') || '';

  // Validate ref if provided (branch/tag name)
  if (ref && !/^[\w./-]+$/.test(ref)) {
    return NextResponse.json(
      { error: 'Invalid ref format' },
      { status: 400 }
    );
  }

  const zipUrl = ref
    ? `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`
    : `https://api.github.com/repos/${owner}/${repo}/zipball`;

  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'binG-App/1.0',
  };

  // Do not attach a server-wide GitHub token to user-controlled requests.
  // This endpoint should only proxy publicly accessible repositories.

  try {
    const response = await fetch(zipUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `GitHub API error: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    // Stream the response directly to client to avoid memory exhaustion
    // This prevents loading entire zipball into memory for large repos
    if (!response.body) {
      return NextResponse.json(
        { error: 'GitHub response body is empty' },
        { status: 502 }
      );
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${owner}-${repo}.zip"`,
        'Cache-Control': 'public, max-age=3600',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch zipball' },
      { status: 502 }
    );
  }
}
