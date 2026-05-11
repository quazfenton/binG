/**
 * 9Router Chat API Route
 * 
 * Forwards chat requests to 9Router using the user's connected providers.
 * This goes in your app's /api/chat route.
 * 
 * Multi-tenancy: Extracts userId from headers and passes it to RouterClient
 * for user-scoped access to provider connections.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRouterClient } from '@/lib/storage/ipfs/client'
import { getUserRouterTokens } from '@/lib/providers/9router/token-store'
import type { ChatRequest } from '@/lib/voice/types'

export const runtime = 'edge'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Extract userId from header (set by your auth middleware)
    const userId = request.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 401 })
    }

    const routerClient = getRouterClient()
    
    // Set userId for multi-tenant API calls (x-user-id header)
    routerClient.setUserId(userId)

    // Try to get user's stored OAuth tokens from your database
    // Falls back to Authorization header API key if no stored tokens
    const modelParam = body.model || ''
    const provider = modelParam.split('/')[0] || 'claude-code'
    
    const storedTokens = await getUserRouterTokens(userId, provider)
    const apiKey = storedTokens?.accessToken || request.headers.get('Authorization')?.replace('Bearer ', '')
    
    if (!apiKey) {
      return NextResponse.json({ error: 'No API key available. Connect a provider first.' }, { status: 401 })
    }

    // Extract chat request
    const chatRequest: ChatRequest = {
      model: body.model,
      messages: body.messages,
      stream: body.stream ?? true,
      temperature: body.temperature,
      maxTokens: body.maxTokens
    }

    // Forward to 9Router with userId scoping
    if (chatRequest.stream) {
      // Handle streaming response
      const response = await routerClient.chat(apiKey, chatRequest)
      
      if (!response.ok) {
        const error = await response.text()
        return NextResponse.json({ error }, { status: response.status })
      }

      // Return the streaming response
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      })
    } else {
      // Handle non-streaming response
      const response = await routerClient.chat(apiKey, chatRequest)
      
      if (!response.ok) {
        const error = await response.text()
        return NextResponse.json({ error }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json(data)
    }

  } catch (err: any) {
    console.error('9Router chat error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}