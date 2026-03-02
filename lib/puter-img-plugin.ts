/**
 * Image generation helper for Puter. Prefers SDK; falls back to proxy call to your API route.
 */

import { PUTER_PROXY_BASE } from '../src/config'

export async function generateImage(prompt: string, testMode = true): Promise<HTMLImageElement | string> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
  if (puter?.ai?.txt2img) {
    const img = await puter.ai.txt2img(prompt, testMode)
    return img
  }

  // fallback to proxy route: expects endpoint to support action=txt2img
  const resp = await fetch(`${PUTER_PROXY_BASE}?action=txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, testMode }),
  })
  if (!resp.ok) throw new Error(`Image generation failed: ${resp.status}`)
  const contentType = resp.headers.get('content-type') || ''
  if (contentType.startsWith('image/') || contentType === 'application/octet-stream') {
    const blob = await resp.blob()
    return URL.createObjectURL(blob)
  }
  const json = await resp.json().catch(() => ({}))
  if (json?.data) {
    const img = new Image()
    img.src = `data:image/png;base64,${json.data}`
    return img
  }
  throw new Error('Unexpected image response')
}