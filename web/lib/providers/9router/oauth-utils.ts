/**
 * OAuth Utilities
 * PKCE code generation and callback handling
 * 
 * Uses HMAC-signed tokens for OAuth state (works across serverless instances)
 */

export function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return encodeBase64URL(Buffer.from(array))
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return encodeBase64URL(new Uint8Array(digest))
}

export function encodeBase64URL(buffer: BufferSource): string {
  let bytes: Uint8Array
  if (buffer instanceof Uint8Array) {
    bytes = buffer
  } else {
    bytes = new Uint8Array(buffer as ArrayBuffer)
  }
  let str = ''
  for (const byte of bytes) {
    str += String.fromCharCode(byte)
  }
  return btoa(str)
    .replace(/\//g, '_')
    .replace(/\n/g, '')
    .replace(/=/g, '')
}

export function generateState(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return encodeBase64URL(Buffer.from(array))
}

export interface OAuthState {
  provider: string
  userId: string
  redirectUri?: string
  codeVerifier: string
  createdAt: number
}

async function createSignature(data: string): Promise<string> {
  const secret = process.env.OAUTH_SECRET || '9router-oauth-default-secret-change-in-production'
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  return encodeBase64URL(new Uint8Array(signature))
}

async function verifySignature(data: string, signature: string): Promise<boolean> {
  const expectedSig = await createSignature(data)
  // Use timing-safe comparison
  if (expectedSig.length !== signature.length) return false
  let result = 0
  for (let i = 0; i < expectedSig.length; i++) {
    result |= expectedSig.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}

export async function createOAuthState(data: Omit<OAuthState, 'createdAt'>): Promise<string> {
  const state = generateState()
  const stateData: OAuthState = {
    ...data,
    createdAt: Date.now()
  }
  
  const payload = JSON.stringify([
    stateData.provider,
    stateData.userId,
    stateData.codeVerifier,
    stateData.redirectUri || '',
    stateData.createdAt
  ])
  
  const signature = await createSignature(payload)
  const token = `${encodeBase64URL(Buffer.from(payload))}.${signature}`
  
  // Use cookies from next/headers
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  cookieStore.set(`oauth_state_${state}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/'
  })
  
  return state
}

export async function consumeOAuthState(state: string): Promise<OAuthState | null> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  const token = cookieStore.get(`oauth_state_${state}`)?.value
  
  if (!token) return null
  
  try {
    const [encodedPayload, signature] = token.split('.')
    if (!encodedPayload || !signature) return null
    
    const isValid = await verifySignature(encodedPayload, signature)
    if (!isValid) return null
    
    const payloadStr = Buffer.from(encodedPayload, 'base64').toString('utf-8')
    const [provider, userId, codeVerifier, redirectUri, createdAt] = JSON.parse(payloadStr)
    
    cookieStore.delete(`oauth_state_${state}`)
    
    if (Date.now() - createdAt > 10 * 60 * 1000) return null
    
    return { provider, userId, codeVerifier, redirectUri: redirectUri || undefined, createdAt }
  } catch {
    return null
  }
}

export function buildCallbackUrl(baseUrl: string, provider: string, state: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/9router/callback?provider=${provider}&state=${state}`
}