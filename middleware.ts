import { NextRequest, NextResponse } from 'next/server'

// Simple Next.js Edge Middleware that logs incoming requests and responses
// - Logs method, url, truncated body (if available), headers (with sensitive headers redacted), and timing
// - Works on Next.js 12+ (Edge middleware)

const REDACT_HEADERS = ['authorization', 'cookie', 'set-cookie']
const BODY_MAX = 2000

function redactHeaders(headers: Record<string, string | string[] | undefined>) {
  const out: Record<string, string | string[] | undefined> = {}
  for (const key of Object.keys(headers || {})) {
    if (REDACT_HEADERS.includes(key.toLowerCase())) out[key] = '[REDACTED]'
    else out[key] = headers[key]
  }
  return out
}

async function readBody(req: NextRequest) {
  try {
    // Request body parsing in Edge middleware is limited; try to clone and read as text
    const clone = req.clone()
    const text = await clone.text()
    if (!text) return ''
    return text.length > BODY_MAX ? text.slice(0, BODY_MAX) + '...[truncated]' : text
  } catch (e) {
    return '[unavailable]'
  }
}

export async function middleware(req: NextRequest) {
  const start = Date.now()
  const method = req.method
  const url = req.nextUrl ? req.nextUrl.pathname + req.nextUrl.search : req.url
  const headers = Object.fromEntries(req.headers.entries())
  const redacted = redactHeaders(headers)
  const bodyPreview = await readBody(req)

  console.info(`[MW REQ] ${method} ${url} headers=${JSON.stringify(redacted)} body=${bodyPreview}`)

  // Let the request continue and capture response timing via Response wrapper
  const res = await NextResponse.next()

  const elapsed = Date.now() - start
  const status = (res && (res.status || (res.headers && res.headers.get('x-middleware-status')))) || 200
  console.info(`[MW RES] ${method} ${url} status=${status} elapsedMs=${elapsed}`)

  return res
}

export const config = {
  matcher: '/:path*', // apply to all routes; adjust if you want to restrict
};