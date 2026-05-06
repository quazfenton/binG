/**
 * app/api/memory/experiences/route.ts — Agent Experience API
 * 
 * API endpoints for managing agent learning experiences.
 * Integrates with the agent-experience.ts module for real-time feedback.
 * 
 * GET    /api/memory/experiences      - List experiences
 * POST   /api/memory/experiences      - Add new experience
 * GET    /api/memory/experiences/stats - Get experience stats
 * DELETE /api/memory/experiences      - Clear all experiences
 */

import { NextRequest, NextResponse } from 'next/server';


import { createLogger } from '@/lib/utils/logger';
import {
  addExperience,
  getRelevantExperiences,
  getExperienceStats,
  formatExperiencesForPrompt,
} from '@/lib/memory/agent-experience';
import type { AgentExperience } from '@/lib/memory/agent-experience';

const logger = createLogger('API:Experience');

// GET /api/memory/experiences
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || 'list';
    
    if (action === 'stats') {
      // Get experience cache statistics
      const stats = getExperienceStats();
      return NextResponse.json({
        success: true,
        stats,
        timestamp: Date.now(),
      });
    }
    
    if (action === 'search') {
      // Search for relevant experiences
      const query = searchParams.get('query') || '';
      const category = searchParams.get('category') || undefined;
      const maxResults = parseInt(searchParams.get('maxResults') || '5', 10);
      
      if (!query) {
        return NextResponse.json({
          success: false,
          error: 'Missing required parameter: query',
        }, { status: 400 });
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
    return NextResponse.json({
      success: true,
      stats,
      message: 'Use ?action=stats for detailed stats, ?action=search&query=... for semantic search',
    });
    
  } catch (err) {
    logger.error('GET /api/memory/experiences failed', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
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

// DELETE /api/memory/experiences
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    
    if (action === 'clear') {
      // Clear the experience cache (for testing or reset)
      const { getExperienceCache } = await import('@/lib/memory/agent-experience');
      getExperienceCache().clear();
      
      logger.info('Experience cache cleared via API');
      
      return NextResponse.json({
        success: true,
        message: 'Experience cache cleared',
      });
    }
    
    return NextResponse.json({
      success: false,
      error: 'Use ?action=clear to clear all experiences',
    }, { status: 400 });
    
  } catch (err) {
    logger.error('DELETE /api/memory/experiences failed', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}