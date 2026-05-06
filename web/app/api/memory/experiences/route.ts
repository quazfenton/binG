import { NextRequest, NextResponse } from 'next/server';


import { createLogger } from '@/lib/utils/logger';
import {
  addExperience,
  getRelevantExperiences,
  getExperienceStats,
  formatExperiencesForPrompt,
} from '@/lib/memory/agent-experience';

const logger = createLogger('API:Experience');

// GET /api/memory/experiences | /api/memory/experiences/stats | /api/memory/experiences/search?query=...&category=...&maxResults=...
export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.pathname;
    const segments = path.split('/').filter(Boolean);

    if (segments.length === 4 && segments[3] === 'stats') {
      const stats = getExperienceStats();
      return NextResponse.json({ success: true, stats, timestamp: Date.now() });
    }

    if (segments.length === 4 && segments[3] === 'search') {
      const query = req.nextUrl.searchParams.get('query') || '';
      const category = req.nextUrl.searchParams.get('category') || undefined;
      const maxResults = parseInt(req.nextUrl.searchParams.get('maxResults') || '5', 10);

      if (!query) {
        return NextResponse.json({ success: false, error: 'Missing required parameter: query' }, { status: 400 });
      }

      const experiences = await getRelevantExperiences(query, { category, maxResults });

      return NextResponse.json({
        success: true,
        experiences,
        count: experiences.length,
        formatted: formatExperiencesForPrompt(experiences),
      });
    }

    // Default: list all experiences (simplified)
    const stats = getExperienceStats();
    return NextResponse.json({ success: true, stats, message: 'Use /memory/experiences/stats or /memory/experiences/search?query=...' });

  } catch (err) {
    logger.error('GET /api/memory/experiences failed', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

// POST /api/memory/experiences
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const { lesson, category, tags, priority, successRate, contextHint } = body;
    
    if (!lesson || !category) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: lesson, category',
      }, { status: 400 });
    }
    
    const experience = await addExperience(lesson, category, {
      tags: tags || [],
      priority: priority ?? 50,
      successRate: successRate ?? 0.5,
      contextHint,
    });
    
    logger.info('Experience added via API', { id: experience.id, category });
    
    return NextResponse.json({
      success: true,
      experience,
    });
    
  } catch (err) {
    logger.error('POST /api/memory/experiences failed', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}

// DELETE /api/memory/experiences/clear
export async function DELETE(req: NextRequest) {
  try {
  const path = req.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 4 && segments[3] === 'clear') {
    const { getExperienceCache } = await import('@/lib/memory/agent-experience');
    getExperienceCache().clear();
    logger.info('Experience cache cleared via API');
    return NextResponse.json({ success: true, message: 'Experience cache cleared' });
  }

  return NextResponse.json({ success: false, error: 'Use /memory/experiences/clear' }, { status: 404 });

  } catch (err) {
    logger.error('DELETE /api/memory/experiences failed', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}