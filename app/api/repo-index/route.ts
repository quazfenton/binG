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
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Failed to index',
    }, { status: 500 });
  }
}

/**
 * GET /api/repo-index/search
 *
 * Search code by keyword or symbol
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const type = searchParams.get('type') || 'keyword';
    const language = searchParams.get('language') || undefined;
    const symbolType = searchParams.get('symbolType') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!query) {
      return NextResponse.json({ error: 'Query parameter "q" required' }, { status: 400 });
    }

    let results;

    if (type === 'symbol') {
      results = repoIndexer.searchSymbol(query, { type: symbolType as any });
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
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Search failed',
    }, { status: 500 });
  }
}

/**
 * GET /api/repo-index/stats
 *
 * Get index statistics
 */
export async function GET_STATS() {
  try {
    const stats = repoIndexer.getIndexStats();

    return NextResponse.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Failed to get stats',
    }, { status: 500 });
  }
}

/**
 * DELETE /api/repo-index
 *
 * Clear index
 */
export async function DELETE() {
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
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Failed to clear index',
    }, { status: 500 });
  }
}
