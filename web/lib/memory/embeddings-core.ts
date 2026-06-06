/**
 * embeddings-core.ts — Shared embedding generator.
 *
 * Used by both the HTTP route (`/api/embed`) and by `lib/memory/embeddings.ts`
 * when self-calling server-side. Keeping the model-selection / API-key
 * resolution in one place avoids the stale-closure race and the
 * 401-on-self-call problem (server-internal fetches to `/api/embed` were
 * getting 401'd by the proxy sidecar-token middleware in DESKTOP_MODE).
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const EMBED_PROVIDER = process.env.EMBED_PROVIDER ?? 'mistral';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'codestral-embed';
const EMBED_DIMENSION = parseInt(process.env.EMBED_DIMENSION ?? '512', 10);

export interface EmbeddingProviderConfig {
  provider: 'mistral' | 'openai';
  model: string;
  dimension: number;
}

export function getEmbeddingProviderConfig(): EmbeddingProviderConfig {
  return {
    provider: EMBED_PROVIDER === 'openai' ? 'openai' : 'mistral',
    model: EMBED_MODEL,
    dimension: EMBED_DIMENSION,
  };
}

export class EmbeddingError extends Error {
  readonly status: number;
  readonly details?: string;
  constructor(message: string, status = 500, details?: string) {
    super(message);
    this.name = 'EmbeddingError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Generate an embedding for a single text. Throws `EmbeddingError` on
 * provider / input failures; callers should catch and translate to HTTP
 * status codes if needed.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || typeof text !== 'string') {
    throw new EmbeddingError('Missing text', 400);
  }
  if (text.length > 50_000) {
    throw new EmbeddingError('Text too long (max 50,000 chars)', 400);
  }

  if (EMBED_PROVIDER === 'mistral') {
    if (!MISTRAL_API_KEY) {
      throw new EmbeddingError('MISTRAL_API_KEY not set', 500);
    }
    const response = await fetch('https://api.mistral.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: [text.slice(0, 32_000)],
        output_dimension: EMBED_DIMENSION,
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[Embed Core] Mistral API error', {
        status: response.status,
        statusText: response.statusText,
        errorBody: errText.slice(0, 500),
        model: EMBED_MODEL,
      });
      throw new EmbeddingError('Mistral API error', 502, errText.slice(0, 200));
    }
    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  if (!OPENAI_API_KEY) {
    throw new EmbeddingError('OPENAI_API_KEY not set', 500);
  }
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      input: text.slice(0, 8_000),
      model: EMBED_MODEL,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error('[Embed Core] OpenAI API error', {
      status: response.status,
      statusText: response.statusText,
      errorBody: errText.slice(0, 500),
    });
    throw new EmbeddingError('OpenAI API error', 502, errText.slice(0, 200));
  }
  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}
