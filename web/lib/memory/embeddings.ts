/**
 * embeddings.ts — Embedding generation
 *
 * Server-side: calls the shared `lib/memory/embeddings-core.ts` directly to
 * avoid round-tripping through the HTTP route (which can be 401'd by the
 * proxy sidecar-token middleware in DESKTOP_MODE).
 *
 * Client-side: hits the /api/embed route via a relative URL.
 *
 * Add a cache layer to avoid re-embedding unchanged content.
 */

import { generateEmbedding } from './embeddings-core';

const EMBED_CACHE = new Map<string, number[]>();

// Export for health check monitoring
export { EMBED_CACHE };

/**
 * Embeds a text string.
 * - On the server, calls the shared generator directly.
 * - In the browser, hits /api/embed via a relative URL.
 */
export async function embed(text: string): Promise<number[]> {
  // Use full text as cache key — trimming alone could cause collisions
  // between semantically different strings that share the same trim.
  const key = text;

  if (EMBED_CACHE.has(key)) {
    return EMBED_CACHE.get(key)!;
  }

  let embedding: number[];

  if (typeof window === 'undefined') {
    // Server-side: call the shared generator directly. Skipping the HTTP
    // self-call avoids the proxy.ts sidecar-token 401 and the ~10ms
    // localhost round-trip per embed.
    try {
      embedding = await generateEmbedding(text);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      console.error('[Embeddings] ❌ Server-side embed error', {
        textLength: text.length,
        textPreview: text.slice(0, 200),
        error: errorMsg,
        stack: errorStack?.split('\n').slice(0, 5).join('\n'),
      });
      throw err;
    }
  } else {
    const baseUrl = '';
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'Unable to read error body');
      console.error('[Embeddings] ❌ Embedding API error', {
        status: res.status,
        statusText: res.statusText,
        textLength: text.length,
        textPreview: text.slice(0, 200),
        baseUrl,
        errorBody: errorBody.slice(0, 500),
        headers: Object.fromEntries(res.headers.entries()),
      });
      throw new Error(`Embedding failed: ${res.status} ${res.statusText}`);
    }

    embedding = await res.json();
  }

  EMBED_CACHE.set(key, embedding);

  return embedding;
}

/**
 * Batch embed multiple texts with concurrency control.
 * Avoids hammering the API with too many parallel requests.
 */
export async function embedBatch(
  texts: string[],
  concurrency = 5
): Promise<number[][]> {
  // Validate concurrency to prevent infinite loop when <= 0
  const effectiveConcurrency = Math.max(1, concurrency);
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += effectiveConcurrency) {
    const batch = texts.slice(i, i + effectiveConcurrency);
    const embeddings = await Promise.all(batch.map(embed));
    embeddings.forEach((e, j) => {
      results[i + j] = e;
    });
  }

  return results;
}

/**
 * Build an enriched embedding input for a code symbol.
 * Context-aware embeddings dramatically improve retrieval quality.
 */
export function buildSymbolEmbedInput(opts: {
  name: string;
  filePath: string;
  content: string;
  imports?: string[];
  kind?: string;
}): string {
  const { name, filePath, content, imports = [], kind = "function" } = opts;

  return `File: ${filePath}
Symbol: ${name} (${kind})
${imports.length > 0 ? `Imports:\n${imports.slice(0, 5).join("\n")}` : ""}

Code:
${content}`.trim();
}

/**
 * Clears the in-memory embedding cache.
 * Call this when switching projects.
 */
export function clearEmbedCache(): void {
  EMBED_CACHE.clear();
}
