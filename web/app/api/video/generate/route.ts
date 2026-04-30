/**
 * Video Generation API Route
 * Experimental endpoint for AI video generation
 * 
 * This endpoint is disabled by default and requires NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=true
 * to be active. When enabled, it provides video generation capabilities using Vercel AI models.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/security/jwt-auth'
import { RateLimiter } from '@/lib/utils/rate-limiter'
import { secureRandomSeed } from '@/lib/utils/crypto-random'
import { videoGenerationService } from '@/lib/video-generation'

interface GenerateBody {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  duration?: number
  quality?: 'low' | 'medium' | 'high' | 'ultra'
  seed?: number | 'random'
  model?: string
  initImageUrl?: string
  aspectRatio?: string
  style?: string
  motionStrength?: number
  cameraMovement?: string
  provider?: string
}

// Rate limiter for video generation: 5 requests per minute per user
const videoGenerationRateLimiter = new RateLimiter(
  5,  // max requests
  60000,  // 1 minute window
  300000  // 5 minute block duration
)

// Allowed models/providers (configurable via environment)
const ALLOWED_MODELS = process.env.VIDEO_GENERATION_ALLOWED_MODELS?.split(',') || [
  'vercel',
]

export async function POST(req: NextRequest) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 minute timeout

  try {
    // Check if video generation is enabled
    const isEnabled = process.env.NEXT_PUBLIC_VIDEO_GENERATION_ENABLED === 'true'
    
    if (!isEnabled) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        {
          error: 'Video generation is currently disabled. This feature is experimental and coming soon.',
          featureFlag: 'NEXT_PUBLIC_VIDEO_GENERATION_ENABLED',
          currentValue: process.env.NEXT_PUBLIC_VIDEO_GENERATION_ENABLED || 'false',
          documentation: 'Set NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=true in your .env to enable this experimental feature'
        },
        { status: 403 }
      )
    }

    // Authentication check — allow anonymous users (rate limited by IP below)
    const auth = await authenticateRequest(req, { allowAnonymous: true })
    if (!auth.authenticated) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        { error: auth.error || 'Authentication required' },
        { status: auth.statusCode || 401 }
      )
    }

    // Extract user identifier for rate limiting
    const userId = auth.payload?.userId || 'unknown'
    const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    const rateLimitKey = `video-gen:${userId}:${clientIP}`

    // Rate limit check
    const rateLimitResult = videoGenerationRateLimiter.check(rateLimitKey)
    if (!rateLimitResult.allowed) {
      clearTimeout(timeoutId)
      const retryAfter = rateLimitResult.retryAfter || 60
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Too many video generation requests.',
          retryAfter,
          blockedUntil: rateLimitResult.blockedUntil,
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(rateLimitResult.limit || 5),
            'X-RateLimit-Remaining': '0',
            'Retry-After': String(retryAfter),
          },
        }
      )
    }

    const body = (await req.json()) as GenerateBody
    const {
      prompt,
      negativePrompt,
      width,
      height,
      duration,
      quality = 'medium',
      seed,
      model,
      initImageUrl,
      aspectRatio,
      style,
      motionStrength,
      cameraMovement,
      provider: preferredProvider,
    } = body

    if (!prompt || !prompt.trim()) {
      clearTimeout(timeoutId)
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    // Model/provider validation
    const selectedProvider = preferredProvider || 'vercel'
    if (!ALLOWED_MODELS.includes(selectedProvider)) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        { error: `Provider '${selectedProvider}' is not allowed. Allowed: ${ALLOWED_MODELS.join(', ')}` },
        { status: 403 }
      )
    }

    // Validate duration
    const maxDuration = 16 // 16 seconds max for now
    if (duration && duration > maxDuration) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        { error: `Maximum duration is ${maxDuration} seconds` },
        { status: 400 }
      )
    }

    // Check if any video generation providers are configured
    const hasVercelKey = !!process.env.VERCEL_API_KEY
    
    if (!hasVercelKey) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        { 
          error: 'No video generation providers configured. Please set VERCEL_API_KEY in your environment variables.' 
        },
        { status: 503 }
      )
    }

    // Build video generation request
    const generationRequest = {
      prompt: prompt.trim(),
      negativePrompt,
      width,
      height,
      duration: duration || (quality === 'low' ? 2 : quality === 'medium' ? 4 : quality === 'high' ? 8 : 16),
      quality,
      seed: seed === 'random' ? secureRandomSeed() : seed,
      model,
      initImageUrl,
      aspectRatio,
      style,
      motionStrength,
      cameraMovement,
      provider: selectedProvider,
      apiKey: process.env.VERCEL_API_KEY,
    }

    try {
      // Generate video using the video generation service
      const result = await videoGenerationService.generateVideo(generationRequest)

      clearTimeout(timeoutId)

      // Telemetry logging for video generation
      console.log(`[VideoGeneration] Successfully generated video`, {
        provider: result.provider,
        model: result.model,
        duration: result.duration,
        resolution: `${result.width}x${result.height}`,
        videoUrl: result.videoUrl.length > 100 ? `${result.videoUrl.substring(0, 50)}...` : result.videoUrl,
      });

      return NextResponse.json({
        success: true,
        data: {
          video: {
            url: result.videoUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            duration: result.duration,
            seed: result.metadata?.seed,
            metadata: result.metadata,
          },
          provider: result.provider,
          model: result.model,
        },
      })
    } catch (error: any) {
      clearTimeout(timeoutId)

      console.error('Video generation error:', error)

      // Check for specific error types
      if (error?.message?.includes('not initialized') || error?.message?.includes('not configured')) {
        return NextResponse.json(
          { error: 'Video generation provider not configured. Please check your API keys.' },
          { status: 503 }
        )
      }

      if (error?.message?.includes('rate limit') || error?.message?.includes('429')) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please try again later.' },
          { status: 429 }
        )
      }

      if (error?.message?.includes('401') || error?.message?.includes('403') || error?.message?.includes('unauthorized')) {
        return NextResponse.json(
          { error: 'Authentication failed. Please check your API keys.' },
          { status: 401 }
        )
      }

      if (error?.message?.includes('timeout') || error?.message?.includes('timed out')) {
        return NextResponse.json(
          { error: 'Video generation timed out. Please try again with a simpler prompt or shorter duration.' },
          { status: 504 }
        )
      }

      return NextResponse.json(
        { error: error?.message || 'Failed to generate video' },
        { status: 500 }
      )
    }
  } catch (error: any) {
    clearTimeout(timeoutId)

    console.error('Video generation API error:', error)

    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'X-RateLimit-Limit': '5',
      'X-RateLimit-Remaining': '5',
    },
  })
}