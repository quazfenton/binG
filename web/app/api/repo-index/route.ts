/**
 * Repo Index API
 *
 * Endpoints for code indexing and search.
 *
 * POST /api/repo-index/index - Index files/directory
 * GET /api/repo-index/search - Search code
 * GET /api/repo-index/stats - Get index statistics
 * DELETE /api/repo-index - Clear index
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { repoIndexer } from '@/lib/repo-index/indexer';

/**
 * POST /api/repo-index/index
 *
 * Index files or directory
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, path, content, language, options } = body;

    if (action === 'file') {
      if (!path || !content) {
        return NextResponse.json({ error: 'path and content required' }, { status: 400 });
      }

      const file = await repoIndexer.indexFile(path, content, { language });

      return NextResponse.json({
        success: true,
        action: 'index-file',
        file: {
          path: file.path,
          language: file.language,
          symbols: file.symbols.length,
          keywords: file.keywords.length,
        },
      });
    }

    if (action === 'directory') {
      if (!path) {
        return NextResponse.json({ error: 'path required' }, { status: 400 });
      }

      const result = await repoIndexer.indexDirectory(path, options);

      return NextResponse.json({
        success: true,
        action: 'index-directory',
        ...result,
      });
    }

    return NextResponse.json({
      error: 'Invalid action. Use "file" or "directory"',
    }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RepoIndex] POST /api/repo-index/index failed', { message });
    return NextResponse.json({
      error: 'Internal server error',
    }, { status: 500 });
  }
}

/**
 * GET /api/repo-index/search or /api/repo-index?action=stats
 *
 * Search code by keyword or symbol, or get index stats
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const query = searchParams.get('q');
    
    // Handle stats action
    if (action === 'stats') {
      const stats = repoIndexer.getIndexStats();
      return NextResponse.json({
        success: true,
        stats,
      });
    }

    // Search action - require authentication
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!query) {
      return NextResponse.json({ error: 'Query parameter "q" required or use action=stats' }, { status: 400 });
    }

    const type = searchParams.get('type') || 'keyword';
    const language = searchParams.get('language') || undefined;
    const symbolType = searchParams.get('symbolType') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');

    let results;

    if (type === 'symbol') {
      // Symbol search - honor language and limit filters
      const symbolResults = repoIndexer.searchSymbol(query, { type: symbolType as any });
      
      // Filter by language if specified
      let filtered = language
        ? symbolResults.filter(r => r.file.language === language)
        : symbolResults;
      
      // Apply limit
      results = filtered.slice(0, limit);
    } else {
      results = repoIndexer.search(query, {
        language,
        symbolType,
        limit,
      });
    }

    return NextResponse.json({
      success: true,
      query,
      count: results.length,
      results: results.map(r => ({
        file: {
          path: r.file.path,
          language: r.file.language,
        },
        score: r.score,
        matches: r.matches.slice(0, 5), // Limit matches in response
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RepoIndex] GET /api/repo-index failed', { message });
    return NextResponse.json({
      error: 'Request failed',
    }, { status: 500 });
  }
}

/**
 * DELETE /api/repo-index
 *
 * Clear index
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    repoIndexer.clearIndex();

    return NextResponse.json({
      success: true,
      message: 'Index cleared',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RepoIndex] DELETE /api/repo-index failed', { message });
    return NextResponse.json({
      error: 'Internal server error',
    }, { status: 500 });
  }
}
