/**
 * app/api/embed/route.ts — Embedding API route for Next.js App Router
 *
 * Proxies embedding requests to OpenAI (or swap for local model).
 * Called by lib/memory/embeddings.ts → embed()
 *
 * Supports: text-embedding-3-small (1536-dim, fast, cheap)
 */

import { NextRequest, NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBED_MODEL = process.env.EMBED_MODEL ?? "text-embedding-3-small";

// Rate limiting: track requests per IP in memory (reset on server restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

export async function POST(req: NextRequest) {
  try {
    // Rate limiting — normalize to a single client IP to prevent bypass
    // via varied header values (e.g., different casing or extra spaces)
    const rawIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
    const ip = rawIp.split(",")[0].trim().toLowerCase();
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { text } = body as { text?: unknown };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    // Input length validation — reject extremely long inputs before processing
    if (text.length > 50_000) {
      return NextResponse.json({ error: "Text too long (max 50,000 chars)" }, { status: 400 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not set" },
        { status: 500 }
      );
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text.slice(0, 8000), // safety trim
        model: EMBED_MODEL,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenAI embed error:", err);
      return NextResponse.json({ error: "OpenAI API error" }, { status: 502 });
    }

    const data = await response.json();
    const embedding: number[] = data.data[0].embedding;

    return NextResponse.json(embedding);
  } catch (err) {
    console.error("Embed route error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── Batch endpoint (optional) ────────────────────────────────────────────────
// POST /api/embed/batch — embeds multiple texts in one OpenAI call (cheaper)
export async function PUT(req: NextRequest) {
  try {
    // Rate limiting
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { texts } = body as { texts?: unknown };

    if (!Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: "Missing texts array" }, { status: 400 });
    }

    // Limit batch size to avoid OOM
    if (texts.length > 100) {
      return NextResponse.json({ error: "Too many texts (max 100)" }, { status: 400 });
    }

    // Validate and sanitize all texts
    const sanitizedTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (typeof t !== "string") {
        return NextResponse.json({ error: `Item ${i} is not a string` }, { status: 400 });
      }
      sanitizedTexts.push(t.length > 8000 ? t.slice(0, 8000) : t);
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: sanitizedTexts,
        model: EMBED_MODEL,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "OpenAI API error" }, { status: 502 });
    }

    const data = await response.json();
    const embeddings: number[][] = data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding);

    return NextResponse.json(embeddings);
  } catch (err) {
    console.error("Embed batch route error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}
