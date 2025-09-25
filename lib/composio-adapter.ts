/**
 * Adapter wiring LLM prompts/outputs to Composio parsing and tool invocation.
 * - parsePromptForTools(prompt) => normalized toolcall array
 * - executeToolCall(call) => invokes registered tool handler (Composio or fallback)
 */

import { initComposio, parseToolsFromPrompt, registerComposioTool } from './composio-client'

export async function parsePromptForTools(prompt: string) {
  try {
    const parsed = await parseToolsFromPrompt(prompt)
    // Normalization helper: many parsers return different shapes; normalize to { tool, args }
    if (!parsed) return []
    if (Array.isArray(parsed)) {
      return parsed.map((p: any) =>
        typeof p === 'string' ? { tool: p, args: {} } : p.tool ? { tool: p.tool, args: p.args ?? {} } : { tool: p.name ?? p.id, args: p.args ?? {} }
      )
    }
    if (parsed.tool) return [{ tool: parsed.tool, args: parsed.args ?? {} }]
    return []
  } catch (e) {
    console.warn('[composio-adapter] parse error', e)
    return []
  }
}

export async function executeToolCall(toolCall: { tool: string; args?: any }) {
  try {
    const c = await initComposio().catch(() => null)
    if (c && typeof c.invoke === 'function') {
      return await c.invoke(toolCall.tool, toolCall.args ?? {})
    }
    // Fallback to registry on window
    const handler = (window as any).__COMPOSIO_TOOL_REG__?.[toolCall.tool]
    if (!handler) throw new Error(`Tool handler not found: ${toolCall.tool}`)
    return await handler(toolCall.args ?? {})
  } catch (e) {
    console.error('[composio-adapter] executeToolCall failed', e)
    throw e
  }
}

export async function registerDefaultTools() {
  // CPU-light default tools — more can be added by plugins
  await registerComposioTool(
    'puter.fs.write',
    { description: 'Write file to Puter FS', args: { path: 'string', content: 'string' } },
    async ({ path, content }: { path: string; content: string }) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
      if (puter?.fs?.write) return puter.fs.write(path, content)
      if (typeof (window as any).__COMPOSIO_CALL__ === 'function') return (window as any).__COMPOSIO_CALL__('cloud.fs.write', { path, content })
      throw new Error('No Puter FS or cloud plugin available')
    }
  )

  await registerComposioTool(
    'puter.fs.read',
    { description: 'Read file from Puter FS', args: { path: 'string' } },
    async ({ path }: { path: string }) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
      if (puter?.fs?.read) return puter.fs.read(path)
      if (typeof (window as any).__COMPOSIO_CALL__ === 'function') return (window as any).__COMPOSIO_CALL__('cloud.fs.read', { path })
      throw new Error('No Puter FS or cloud plugin available')
    }
  )

  await registerComposioTool(
    'puter.ai.txt2img',
    { description: 'Generate an image using Puter', args: { prompt: 'string', testMode: 'boolean' } },
    async ({ prompt, testMode }: { prompt: string; testMode?: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
      if (puter?.ai?.txt2img) return puter.ai.txt2img(prompt, testMode ?? true)
      // fallback: call window __COMPOSIO_CALL__ or throw
      if (typeof (window as any).__COMPOSIO_CALL__ === 'function') return (window as any).__COMPOSIO_CALL__('cloud.img.txt2img', { prompt, testMode })
      throw new Error('No Puter image generation available')
    }
  )
}