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

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
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
    const { texts } = await req.json();

    if (!Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: "Missing texts array" }, { status: 400 });
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
        input: texts.map((t: string) => t.slice(0, 8000)),
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
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
