/**
 * app/api/embed/route.ts — Embedding API route for Next.js App Router
 *
 * Thin HTTP wrapper around `lib/memory/embeddings-core.ts`. The shared
 * generator is also used by `lib/memory/embeddings.ts` for server-side
 * self-calls, so we don't go through this route (and its proxy/middleware
 * chain) on the same-origin server.
 *
 * Supports Mistral codestral-embed (default) and OpenAI text-embedding-3-small.
 * Default: Mistral codestral-embed (512-dim for quality/performance tradeoff)
 * Override: Set EMBED_PROVIDER=openai and OPENAI_API_KEY
 */

import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding, EmbeddingError, getEmbeddingProviderConfig } from "@/lib/memory/embeddings-core";

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
      const entry = rateLimitMap.get(ip);
      const retryAfter = entry ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 60;
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(RATE_LIMIT),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(entry?.resetAt ?? Date.now() + RATE_WINDOW_MS),
          },
        }
      );
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

    console.debug('[Embed API] Request received', {
      textLength: text.length,
      textPreview: text.slice(0, 100),
      ip,
      ...getEmbeddingProviderConfig(),
    });

    const embedding = await generateEmbedding(text);

    return NextResponse.json(embedding);
  } catch (err) {
    if (err instanceof EmbeddingError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status }
      );
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    console.error('[Embed API] ❌ Internal error', {
      error: errorMsg,
      stack: errorStack?.split('\n').slice(0, 5).join('\n'),
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      { error: "Internal error", details: process.env.NODE_ENV === 'development' ? errorMsg : undefined },
      { status: 500 }
    );
  }
}

// PUT /api/embed/batch — embeds multiple texts in one provider call (cheaper).
// We intentionally keep this on the inline code path (rather than a small
// loop over generateEmbedding) so the per-batch request sends a single
// provider call with `input: texts[]`, not N requests.
export async function PUT(req: NextRequest) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  const EMBED_PROVIDER = process.env.EMBED_PROVIDER ?? 'mistral';
  const EMBED_MODEL = process.env.EMBED_MODEL ?? 'codestral-embed';
  const EMBED_DIMENSION = parseInt(process.env.EMBED_DIMENSION ?? '512', 10);

  try {
    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { texts } = body as { texts?: unknown };

    if (!Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: 'Missing texts array' }, { status: 400 });
    }

    if (texts.length > 100) {
      return NextResponse.json({ error: 'Too many texts (max 100)' }, { status: 400 });
    }

    const sanitizedTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (typeof t !== 'string') {
        return NextResponse.json({ error: `Item ${i} is not a string` }, { status: 400 });
      }
      sanitizedTexts.push(t.length > 32000 ? t.slice(0, 32000) : t);
    }

    let embeddings: number[][];

    if (EMBED_PROVIDER === 'mistral') {
      if (!MISTRAL_API_KEY) {
        return NextResponse.json({ error: 'MISTRAL_API_KEY not set' }, { status: 500 });
      }
      const response = await fetch('https://api.mistral.ai/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: EMBED_MODEL,
          input: sanitizedTexts,
          output_dimension: EMBED_DIMENSION,
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        return NextResponse.json({ error: 'Mistral API error', details: errText.slice(0, 200) }, { status: 502 });
      }
      const data = await response.json();
      embeddings = data.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
    } else {
      if (!OPENAI_API_KEY) {
        return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 });
      }
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          input: sanitizedTexts,
          model: EMBED_MODEL,
        }),
      });
      if (!response.ok) {
        return NextResponse.json({ error: 'OpenAI API error' }, { status: 502 });
      }
      const data = await response.json();
      embeddings = data.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
    }

    return NextResponse.json(embeddings);
  } catch (err) {
    console.error('Embed batch route error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
