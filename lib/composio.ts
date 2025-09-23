/**
 * Minimal Composio plugin surface for registering tools and invoking them.
 * Plugins can register tools which can be invoked from parsing/tool-calls.
 */

type ToolHandler = (payload: any) => Promise<any>

const tools: Record<string, ToolHandler> = {}

export function registerTool(name: string, handler: ToolHandler) {
  tools[name] = handler
}

export async function callTool(name: string, payload: any) {
  const h = tools[name]
  if (!h) throw new Error(`tool not found: ${name}`)
  return h(payload)
}

export function listTools() {
  return Object.keys(tools)
}