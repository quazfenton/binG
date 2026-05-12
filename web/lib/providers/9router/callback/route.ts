/**
 * 9Router OAuth Callback Handler
 * 
 * Route: /api/9router/callback
 * Handles OAuth redirect from 9Router and stores tokens in your app's DB
 * using the existing OAuthService with AES-256-GCM encryption.
 */

import { NextRequest, NextResponse } from 'next/server'
import { consumeOAuthState } from '@/lib/providers/9router/oauth-utils'
import { getRouterClient } from '@/lib/providers/9router/client'
import type { OAuthProvider } from '@/lib/voice/types'
import { oauthService } from '@/lib/auth/oauth-service'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const providerParam = searchParams.get('provider')

    if (error) {
      const errorDescription = searchParams.get('error_description') || error
      return NextResponse.redirect(
        new URL(`/settings/providers?error=${encodeURIComponent(errorDescription)}`, request.url)
      )
    }

    if (!state || !code) {
      return NextResponse.redirect(
        new URL('/settings/providers?error=Missing OAuth parameters', request.url)
      )
    }

    if (!providerParam) {
      return NextResponse.redirect(
        new URL('/settings/providers?error=Missing provider parameter', request.url)
      )
    }

    // Validate state and get stored info
    const stateData = await consumeOAuthState(state)
    if (!stateData) {
      return NextResponse.redirect(
        new URL('/settings/providers?error=Invalid or expired OAuth state', request.url)
      )
    }

    // Verify provider matches
    if (stateData.provider !== providerParam) {
      return NextResponse.redirect(
        new URL('/settings/providers?error=Provider mismatch', request.url)
      )
    }

    // Complete OAuth with 9Router to get tokens
    const client = getRouterClient()
    const callbackUrl = `${new URL(request.url).origin}/api/9router/callback`
    
    const result = await client.completeOAuth(
      providerParam as OAuthProvider,
      code,
      callbackUrl,
      stateData.codeVerifier
    )

    if (!result.success || !result.connection) {
      return NextResponse.redirect(
        new URL(`/settings/providers?error=${encodeURIComponent(result.error || 'OAuth failed')}`, request.url)
      )
    }

    const { connection } = result

    // Store the connection in your app's database using OAuthService
    // The OAuthService handles AES-256-GCM encryption for tokens at rest
    try {
      await oauthService.saveConnection({
        userId: stateData.userId,
        provider: providerParam,
        providerAccountId: connection.id, // 9Router's connection ID as the account identifier
        providerDisplayName: connection.displayName || connection.email || `${providerParam} account`,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        expiresIn: connection.expiresIn,
        scopes: [], // 9Router doesn't expose scopes in the response, can be extended
      })

      // Verify the connection was actually stored (prevents silent failures)
      const storedConnections = await oauthService.getUserConnections(stateData.userId, providerParam)
      if (!storedConnections || storedConnections.length === 0) {
        throw new Error('Connection save verification failed')
      }

      console.log(`[9Router Callback] Stored ${providerParam} connection for user ${stateData.userId}`)
    } catch (storageError) {
      console.error('[9Router Callback] Failed to store connection:', storageError)
      return NextResponse.redirect(
        new URL(`/settings/providers?error=${encodeURIComponent('Failed to store credentials')}`, request.url)
      )
    }

    // Redirect to settings with success
    return NextResponse.redirect(
      new URL(`/settings/providers?success=${providerParam}&connected=true`, request.url)
    )

  } catch (err) {
    console.error('9Router OAuth callback error:', err)
    return NextResponse.redirect(
      new URL('/settings/providers?error=Internal error', request.url)
    )
  }
}