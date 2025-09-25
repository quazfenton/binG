/**
 * Initialize Composio client and helper wrappers.
 * - Lazy-loads the Composio SDK (npm package or window global)
 * - Exposes initComposio, registerComposioTool, parseToolsFromPrompt
 */

type ComposioLib = any
let composioClient: ComposioLib | null = null

export async function initComposio(opts: { apiKey?: string; host?: string } = {}) {
  if (composioClient) return composioClient
  try {
    let lib: any = null
    try {
      // Try dynamic import (if npm package installed)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      lib = (await import('composio')).default ?? (await import('composio'))
    } catch {
      // fallback to global (script tag)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      lib = typeof window !== 'undefined' ? (window as any).Composio : undefined
    }
    if (!lib) throw new Error('Composio SDK not found')
    // Initialize according to whichever API shape is available.
    composioClient =
      (typeof lib.init === 'function' && lib.init({ host: opts.host })) ||
      (typeof lib.createClient === 'function' && lib.createClient({ apiKey: opts.apiKey, host: opts.host })) ||
      lib
    return composioClient
  } catch (e) {
    console.warn('[composio] init failed', e)
    throw e
  }
}

export async function registerComposioTool(name: string, descriptor: any, handler: (...args: any[]) => Promise<any>) {
  const c = await initComposio().catch(() => null)
  if (!c) {
    // fallback: register in simple window registry
    ;(window as any).__COMPOSIO_TOOL_REG__ = (window as any).__COMPOSIO_TOOL_REG__ || {}
    ;(window as any).__COMPOSIO_TOOL_REG__[name] = handler
    return
  }
  if (typeof c.registerTool === 'function') {
    c.registerTool(name, descriptor, handler)
    return
  }
  if (c.tools && typeof c.tools.register === 'function') {
    c.tools.register(name, descriptor, handler)
    return
  }
  // fallback registry
  ;(window as any).__COMPOSIO_TOOL_REG__ = (window as any).__COMPOSIO_TOOL_REG__ || {}
  ;(window as any).__COMPOSIO_TOOL_REG__[name] = handler
}

export async function parseToolsFromPrompt(prompt: string) {
  const c = await initComposio().catch(() => null)
  if (!c) return null
  if (typeof c.parse === 'function') return c.parse(prompt)
  if (typeof c.discern === 'function') return c.discern(prompt)
  return null
}