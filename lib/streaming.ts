/* Central streaming helpers to normalize different providers' stream shapes */

export type StreamPart = { text?: string; [k: string]: any }

export async function* normalizeStream(iterator: AsyncIterable<any> | Promise<AsyncIterable<any>>): AsyncIterable<StreamPart> {
  const it = (await iterator) as AsyncIterable<any>
  for await (const chunk of it) {
    if (!chunk) continue
    if (typeof chunk === 'string') {
      yield { text: chunk }
      continue
    }
    if (chunk.message && chunk.message.content) {
      yield { text: chunk.message.content }
      continue
    }
    if (chunk.delta && chunk.delta.content) {
      yield { text: chunk.delta.content }
      continue
    }
    if (chunk.text) {
      yield { text: chunk.text, ...chunk }
      continue
    }
    try {
      yield { text: JSON.stringify(chunk) }
    } catch {
      yield { text: String(chunk) }
    }
  }
}

export async function collectNonStream(resp: any) {
  if (!resp) return ''
  if (typeof resp === 'string') return resp
  if (resp.output?.text) return resp.output.text
  if (resp.choices && resp.choices.length) {
    return resp.choices.map((c: any) => c.text ?? c.message?.content ?? '').join('')
  }
  if (resp.message?.content) return resp.message.content
  if (resp.content) return resp.content
  return JSON.stringify(resp)
}