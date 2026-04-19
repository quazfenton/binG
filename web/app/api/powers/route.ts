/**
 * Powers API
 *
 * Endpoints:
 * - GET /api/powers - List all powers
 * - GET /api/powers/:name - Get power details
 * - POST /api/powers - Add new power
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { ToolRegistry } from '@/lib/tools/registry';
import { powersRegistry } from '@/lib/powers';

const logger = createLogger('API:Powers');

// ============================================================================
// GET /api/powers - List all powers
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    // Get powers from unified registry
    const registry = ToolRegistry.getInstance();
    const tools = registry.getAllTools();
    const powers = powersRegistry.getSummary();

    // Map tools/powers to a common format
    const powerList = [
      ...tools.map(t => ({
        id: t.name,
        name: t.name,
        description: t.metadata?.tags?.join(', ') || 'Capability tool',
        type: 'capability'
      })),
      ...powers.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        type: 'power'
      }))
    ];

    // Filter by query
    let filteredPowers = powerList;
    if (query) {
      const lowerQuery = query.toLowerCase();
      filteredPowers = powerList.filter(p =>
        p.name.toLowerCase().includes(lowerQuery) ||
        p.description.toLowerCase().includes(lowerQuery)
      );
    }

    return NextResponse.json({
      success: true,
      powers: filteredPowers,
      count: filteredPowers.length,
    });
  } catch (error: any) {
    logger.error('Failed to list powers:', error);
    return NextResponse.json(
      { error: 'Failed to list powers' },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/powers/:name - Get power details (handled via slug in Next.js 13+ app router)
// Note: This requires a dynamic route /api/powers/[name]/route.ts instead of a simple export.
// For now, keeping it simple as a function that could be called if refactored.
// ============================================================================

async function GET_power(name: string) {
  try {
    const registry = ToolRegistry.getInstance();
    const tool = registry.getTool(name);
    const power = powersRegistry.getById(name);

    if (!tool && !power) {
      return { error: 'Power not found', status: 404 };
    }

    return {
      success: true,
      power: tool ? {
        id: tool.name,
        name: tool.name,
        description: tool.metadata?.tags?.join(', ') || 'Capability tool',
        type: 'capability'
      } : {
        id: power!.id,
        name: power!.name,
        description: power!.description,
        type: 'power',
        version: power!.version
      },
    };
  } catch (error: any) {
    logger.error('Failed to get power:', error);
    return { error: 'Failed to get power', status: 500 };
  }
}

// ============================================================================
// POST /api/powers - Add new power
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, actions, triggers } = body;

    if (!name || !description || !actions) {
      return NextResponse.json(
        { error: 'Name, description, and actions are required' },
        { status: 400 }
      );
    }

    // Register as a new power
    await powersRegistry.register({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      version: '1.0.0',
      description,
      triggers: triggers || [],
      actions: actions,
      source: 'user',
      enabled: true,
    });

    return NextResponse.json({
      success: true,
      message: 'Power added successfully',
    });
  } catch (error: any) {
    logger.error('Failed to add power:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to add power' },
      { status: 500 }
    );
  }
}
