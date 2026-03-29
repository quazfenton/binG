/**
 * Zine Engine API Routes
 * 
 * Handles:
 * - Webhook endpoints for external data
 * - RSS proxy (CORS bypass)
 * - OAuth token management
 * - Content management
 * - Configuration storage
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

interface StoredConfig {
  dataSources: any[];
  templates: any[];
  settings: Record<string, any>;
}

// ============================================================================
// In-memory storage (use database in production)
// ============================================================================

const contentStore: Map<string, ZineContent> = new Map();
const configStore: Map<string, StoredConfig> = new Map();

// ============================================================================
// Validation Schemas
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

const WebhookSchema = z.object({
  content: ContentSchema,
  signature: z.string().optional(),
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
    
    return NextResponse.json({ contents });
  } catch (error) {
    console.error("Error fetching zine content:", error);
    return NextResponse.json(
      { error: "Failed to fetch content" },
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
        { error: "Invalid content format", details: result.error },
        { status: 400 }
      );
    }
    
    const content: ZineContent = {
      ...result.data,
      id: result.data.id || `zine-${Date.now()}`,
      createdAt: result.data.createdAt || Date.now(),
    };
    
    contentStore.set(content.id, content);
    
    // Broadcast to connected clients (via WebSocket or SSE)
    // broadcastContent(content);
    
    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error("Error adding zine content:", error);
    return NextResponse.json(
      { error: "Failed to add content" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/zine/content/:id - Remove content
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json(
        { error: "Content ID required" },
        { status: 400 }
      );
    }
    
    const deleted = contentStore.delete(id);
    
    return NextResponse.json({ success: deleted });
  } catch (error) {
    console.error("Error deleting zine content:", error);
    return NextResponse.json(
      { error: "Failed to delete content" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/zine/config - Get configuration
// ============================================================================

export async function getConfig(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get("key") || "default";
    
    const config = configStore.get(key) || {
      dataSources: [],
      templates: [],
      settings: {},
    };
    
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error fetching zine config:", error);
    return NextResponse.json(
      { error: "Failed to fetch config" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/zine/config - Save configuration
// ============================================================================

export async function saveConfig(request: NextRequest) {
  try {
    const body = await request.json();
    const key = body.key || "default";
    
    const config: StoredConfig = {
      dataSources: body.dataSources || [],
      templates: body.templates || [],
      settings: body.settings || {},
    };
    
    configStore.set(key, config);
    
    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error("Error saving zine config:", error);
    return NextResponse.json(
      { error: "Failed to save config" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/zine/webhook - Webhook endpoint for external data
// ============================================================================

export async function handleWebhook(request: NextRequest) {
  try {
    const body = await request.json();
    const result = WebhookSchema.safeParse(body);
    
    if (!result.success) {
      // Try to parse as direct content
      const contentResult = ContentSchema.safeParse(body);
      if (contentResult.success) {
        const content: ZineContent = {
          ...contentResult.data,
          id: contentResult.data.id || `webhook-${Date.now()}`,
          createdAt: contentResult.data.createdAt || Date.now(),
          source: "webhook",
        };
        
        contentStore.set(content.id, content);
        
        return NextResponse.json({ success: true, content });
      }
      
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 }
      );
    }
    
    // Verify signature if provided
    if (body.signature) {
      // In production, verify HMAC signature
      // const isValid = verifySignature(body.signature, JSON.stringify(body.content));
      // if (!isValid) {
      //   return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      // }
    }
    
    const content: ZineContent = {
      ...result.data.content,
      id: result.data.content.id || `webhook-${Date.now()}`,
      createdAt: result.data.content.createdAt || Date.now(),
      source: "webhook",
    };
    
    contentStore.set(content.id, content);
    
    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error("Error handling webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/zine/rss-proxy - CORS proxy for RSS feeds
// ============================================================================

export async function rssProxy(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get("url");
    
    if (!url) {
      return NextResponse.json(
        { error: "URL parameter required" },
        { status: 400 }
      );
    }
    
    // Validate URL
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        throw new Error("Invalid protocol");
      }
      
      // Block SSRF attempts
      const hostname = parsedUrl.hostname.toLowerCase();
      const blockedPatterns = [
        "localhost", "127.", "10.", "192.168.", "172.16.",
        "169.254.", "0.0.0.0", ".local", ".internal", "metadata"
      ];
      
      if (blockedPatterns.some(pattern => hostname.includes(pattern))) {
        return NextResponse.json(
          { error: "Blocked unsafe URL" },
          { status: 403 }
        );
      }
    } catch (e) {
      return NextResponse.json(
        { error: "Invalid URL" },
        { status: 400 }
      );
    }
    
    // Fetch RSS feed
    const response = await fetch(url, {
      headers: {
        "User-Agent": "binG Zine Engine RSS Reader",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
    });
    
    if (!response.ok) {
      throw new Error(`RSS feed returned ${response.status}`);
    }
    
    const xml = await response.text();
    
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=300", // 5 min cache
      },
    });
  } catch (error) {
    console.error("Error proxying RSS:", error);
    return NextResponse.json(
      { error: "Failed to fetch RSS feed" },
      { status: 500 }
    );
  }
}

// ============================================================================
// Route handler export
// ============================================================================

export {
  getConfig as GET_CONFIG,
  saveConfig as POST_CONFIG,
  handleWebhook as POST_WEBHOOK,
  rssProxy as GET_RSS_PROXY,
};
