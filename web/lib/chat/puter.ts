/**
 * Puter adapter for binG
 * - fetchPuterModels(): returns list of models from api.puter
 * - getPuterAdapter(modelId, options): returns { responses(payload), stream(payload) } adapter
 */

import { createNDJSONParser } from '@/lib/utils/ndjson-parser';

type PuterModelRaw = {
  id?: string
  model?: string
  name?: string
  release_date?: string
  reasoning?: boolean
  tool_call?: boolean
  attachment?: boolean
  cost?: any
  options?: Record<string, any>
}

const DEFAULT_BASE = 'https://api.puter.com/puterai/chat'

export async function fetchPuterModels(baseURL: string = DEFAULT_BASE): Promise<PuterModelRaw[]> {
  try {
    const r = await fetch(`${baseURL}/models`)
    if (!r.ok) {
      throw new Error(`failed fetching puter models ${r.status}`)
    }
    const json = await r.json().catch(() => [])
    return Array.isArray(json) ? json : []
  } catch (err) {
    console.warn('[puter] fetchModels error', (err as Error).message)
    return []
  }
}

function makeHeaders(defaultOptions: Record<string, any> = {}) {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'binG-puter-adapter/1',
    ...(defaultOptions.headers || {}),
  }
}

export function getPuterAdapter(
  modelId: string,
  opts: { baseURL?: string; apiKey?: string; options?: Record<string, any> } = {}
) {
  const base = opts.baseURL ?? DEFAULT_BASE
  const headersBase: Record<string, string> = makeHeaders(opts.options ?? {})
  if (opts.apiKey) {
    headersBase['Authorization'] = `Bearer ${opts.apiKey}`
  }

  async function nonStreamResponses(payload?: any) {
    const url = `${base}?model=${encodeURIComponent(modelId)}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: headersBase,
      body: JSON.stringify(payload ?? {}),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Puter API error ${resp.status} ${text}`)
    }
    try {
      return await resp.json()
    } catch {
      return { message: { role: 'assistant', content: await resp.text() } }
    }
  }

  async function* streamResponses(payload?: any) {
    const url = `${base}?model=${encodeURIComponent(modelId)}&stream=1`
    const resp = await fetch(url, {
      method: 'POST',
      headers: headersBase,
      body: JSON.stringify(payload ?? {}),
    })
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      throw new Error(`Puter stream error ${resp.status} ${txt}`)
    }
    if (!resp.body) return

    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    
    // Use robust NDJSON parser to handle partial chunks
    const parser = createNDJSONParser({
      maxBufferSize: 10 * 1024 * 1024, // 10MB
      maxLineLength: 1024 * 1024, // 1MB
      verbose: false,
    })

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = dec.decode(value, { stream: true })

        // Parse NDJSON with robust error handling
        const parsedObjects = parser.parse(chunk)

        for (const json of parsedObjects) {
          let part: any = {}
          if (typeof json === 'string') {
            part.text = json
          } else if (json.text) {
            part.text = json.text
          } else if (json.delta?.content) {
            part.text = json.delta.content
          } else {
            part = json
          }
          yield part
        }

        // Handle non-JSON chunks (plain text, errors, etc.)
        // If parser found nothing but chunk has content, emit as text
        if (parsedObjects.length === 0 && chunk.trim()) {
          // Check if it's not an SSE data line (those are handled by parser)
          const trimmed = chunk.trim()
          if (!trimmed.startsWith('data:') && !trimmed.startsWith('event:')) {
            yield { text: trimmed }
          }
        }
      }

      // Finalize to process any remaining buffered data
      const final = parser.finalize()
      for (const json of final) {
        let part: any = {}
        if (typeof json === 'string') {
          part.text = json
        } else if (json.text) {
          part.text = json.text
        } else if (json.delta?.content) {
          part.text = json.delta.content
        } else {
          part = json
        }
        yield part
      }
    } finally {
      reader.releaseLock()
    }
  }

  return {
    responses: nonStreamResponses,
    stream: streamResponses,
  }
}
