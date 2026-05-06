/**
 * Zine Engine Webhook API
 * POST /api/zine/webhook - Webhook endpoint for external data
 */

import { NextRequest, NextResponse } from "next/server";


import { z } from "zod";
import { createHmac } from "crypto";

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
// In-memory storage
// ============================================================================

const contentStore: Map<string, ZineContent> = new Map();
const webhookSecret = process.env.ZINE_WEBHOOK_SECRET || "default-secret-change-in-production";

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

const WebhookSchema = z.object({
  content: ContentSchema,
  signature: z.string().optional(),
  timestamp: z.number().optional(),
});

// ============================================================================
// Signature Verification
// ============================================================================

function verifySignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expectedSignature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    
    // Constant-time comparison
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const providedBuffer = Buffer.from(signature, "hex");
    
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < expectedBuffer.length; i++) {
      result |= expectedBuffer[i] ^ providedBuffer[i];
    }
    
    return result === 0;
  } catch {
    return false;
  }
}

// ============================================================================
// POST /api/zine/webhook - Handle webhook
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Read raw body ONCE — cannot call request.json() then request.text()
    const rawBody = await request.text();
    const signature = request.headers.get("x-zine-signature");
    const timestamp = request.headers.get("x-zine-timestamp");

    // Verify timestamp (prevent replay attacks)
    if (timestamp) {
      const now = Date.now();
      const age = now - parseInt(timestamp);
      if (age > 300000) { // 5 minutes
        return NextResponse.json(
          { error: "Request timestamp too old" },
          { status: 400 }
        );
      }
    }

    // Verify signature if provided — uses rawBody read above
    if (signature) {
      if (!verifySignature(rawBody, signature, webhookSecret)) {
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 }
        );
      }
    }

    // Parse JSON from the raw body (after signature verification)
    let body: Record<string, any>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }
    
    // Parse payload
    let content: ZineContent;
    
    const result = WebhookSchema.safeParse(body);
    if (result.success) {
      content = {
        type: result.data.content.type,
        id: result.data.content.id || `webhook-${Date.now()}`,
        createdAt: result.data.content.createdAt || Date.now(),
        title: result.data.content.title,
        body: result.data.content.body,
        media: result.data.content.media,
        metadata: result.data.content.metadata,
        source: "webhook",
        expiresAt: result.data.content.expiresAt,
        priority: result.data.content.priority,
      };
    } else {
      // Try to parse as direct content
      const contentResult = ContentSchema.safeParse(body);
      if (contentResult.success) {
        content = {
          type: contentResult.data.type,
          id: contentResult.data.id || `webhook-${Date.now()}`,
          createdAt: contentResult.data.createdAt || Date.now(),
          title: contentResult.data.title,
          body: contentResult.data.body,
          media: contentResult.data.media,
          metadata: contentResult.data.metadata,
          source: "webhook",
          expiresAt: contentResult.data.expiresAt,
          priority: contentResult.data.priority,
        };
      } else {
        return NextResponse.json(
          { 
            error: "Invalid webhook payload", 
            details: result.error.flatten(),
            hint: "Send either { content: {...} } or direct content object"
          },
          { status: 400 }
        );
      }
    }
    
    // Store content
    contentStore.set(content.id, content);
    
    return NextResponse.json({ 
      success: true, 
      content,
      message: "Webhook processed successfully"
    });
  } catch (error) {
    console.error("Error handling webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/zine/webhook - Health check
// ============================================================================

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/zine/webhook",
    methods: ["POST"],
    authentication: "Optional HMAC-SHA256 signature via x-zine-signature header",
  });
}
