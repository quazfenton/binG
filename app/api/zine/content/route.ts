/**
 * Zine Engine Content API
 * GET /api/zine/content - Fetch all active content
 * POST /api/zine/content - Add new content
 * DELETE /api/zine/content - Remove content
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

interface ZineContent {
  id: string;
  type: string;
  title?: string;
  body?: string;
  media?: string[];
  metadata?: Record<string, any>;
  source?: string;
  createdAt: number;
  expiresAt?: number;
  priority?: number;
}

// ============================================================================
// In-memory storage (use database in production)
// ============================================================================

const contentStore: Map<string, ZineContent> = new Map();

// ============================================================================
// Validation Schema
// ============================================================================

const ContentSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["text", "image", "video", "audio", "mixed", "interactive", "embed"]),
  title: z.string().optional(),
  body: z.string().optional(),
  media: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
  source: z.string().optional(),
  createdAt: z.number().optional(),
  expiresAt: z.number().optional(),
  priority: z.number().optional(),
  style: z.record(z.any()).optional(),
  position: z.record(z.any()).optional(),
  animation: z.string().optional(),
});

// ============================================================================
// GET /api/zine/content - Fetch all active content
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");
    const source = searchParams.get("source");
    const limit = parseInt(searchParams.get("limit") || "50");
    
    let contents = Array.from(contentStore.values());
    
    // Filter by type
    if (type) {
      contents = contents.filter(c => c.type === type);
    }
    
    // Filter by source
    if (source) {
      contents = contents.filter(c => c.source === source);
    }
    
    // Remove expired
    const now = Date.now();
    contents = contents.filter(c => !c.expiresAt || c.expiresAt > now);
    
    // Sort by priority and limit
    contents = contents
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, limit);
    
    return NextResponse.json({ contents, count: contents.length });
  } catch (error) {
    console.error("Error fetching zine content:", error);
    return NextResponse.json(
      { error: "Failed to fetch content", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/zine/content - Add new content
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = ContentSchema.safeParse(body);
    
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid content format", details: result.error.flatten() },
        { status: 400 }
      );
    }
    
    const content: ZineContent = {
      ...result.data,
      id: result.data.id || `zine-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: result.data.createdAt || Date.now(),
    };
    
    contentStore.set(content.id, content);
    
    return NextResponse.json({ 
      success: true, 
      content,
      message: "Content added successfully"
    });
  } catch (error) {
    console.error("Error adding zine content:", error);
    return NextResponse.json(
      { error: "Failed to add content", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/zine/content?id=xxx - Remove content
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json(
        { error: "Content ID required", hint: "Use ?id=xxx query parameter" },
        { status: 400 }
      );
    }
    
    const deleted = contentStore.delete(id);
    
    if (!deleted) {
      return NextResponse.json(
        { error: "Content not found", id },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      message: "Content deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting zine content:", error);
    return NextResponse.json(
      { error: "Failed to delete content", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
