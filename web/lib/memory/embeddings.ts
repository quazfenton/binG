/**
 * embeddings.ts — Embedding generation
 * Calls your Next.js /api/embed route, which proxies to OpenAI or a local model.
 * Add a cache layer to avoid re-embedding unchanged content.
 */

const EMBED_CACHE = new Map<string, number[]>();

// Export for health check monitoring
export { EMBED_CACHE };

/**
 * Embeds a text string by calling your Next.js API route.
 * The route should call OpenAI text-embedding-3-small (or equivalent local model).
 * Works both client-side (relative URL) and server-side (absolute URL).
 */
export async function embed(text: string): Promise<number[]> {
  // Use full text as cache key — trimming alone could cause collisions
  // between semantically different strings that share the same trim.
  const key = text;

  if (EMBED_CACHE.has(key)) {
    return EMBED_CACHE.get(key)!;
  }

  // Determine base URL based on environment
  // Client-side: relative URL works
  // Server-side: need absolute URL
  const isServer = typeof window === 'undefined';
  const baseUrl = isServer
    ? (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
    : '';

  const res = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'Unable to read error body');
    console.error('[Embeddings] ❌ Embedding API error', {
      status: res.status,
      statusText: res.statusText,
      textLength: text.length,
      textPreview: text.slice(0, 200),
      baseUrl: isServer ? process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' : '(client-side)',
      errorBody: errorBody.slice(0, 500),
      headers: Object.fromEntries(res.headers.entries()),
    });
    throw new Error(`Embedding failed: ${res.status} ${res.statusText}`);
  }

  const embedding: number[] = await res.json();

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
