import { NextRequest, NextResponse } from 'next/server'
import {
  getDefaultRegistry,
  type ImageGenerationParams,
  type AspectRatio,
} from '@/lib/image-generation'
import { RateLimiter } from '@/lib/utils/rate-limiter'
import { authenticateRequest } from '@/lib/security/jwt-auth'

export interface GenerateBody {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  guidance?: number
  seed?: number | 'random'
  model?: string
  initImageUrl?: string
  numImages?: number
  aspectRatio?: AspectRatio
  quality?: 'low' | 'medium' | 'high' | 'ultra'
  style?: string
  sampler?: string
  provider?: string
  imageStrength?: number
}

// Rate limiter for image generation: 10 requests per minute per user
const imageGenerationRateLimiter = new RateLimiter(
  10,  // max requests
  60000,  // 1 minute window
  300000  // 5 minute block duration
)

// Allowed models/providers (configurable via environment)
const ALLOWED_MODELS = process.env.IMAGE_GENERATION_ALLOWED_MODELS?.split(',') || [
  'mistral',
  'replicate',
]

export async function POST(req: NextRequest) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 180000) // 3 minute timeout

  try {
    // Authentication check
    const auth = await authenticateRequest(req, { allowAnonymous: false })
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
    const rateLimitKey = `image-gen:${userId}:${clientIP}`

    // Rate limit check
    const rateLimitResult = imageGenerationRateLimiter.check(rateLimitKey)
    if (!rateLimitResult.allowed) {
      clearTimeout(timeoutId)
      const retryAfter = rateLimitResult.retryAfter || 60
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Too many image generation requests.',
          retryAfter,
          blockedUntil: rateLimitResult.blockedUntil,
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(rateLimitResult.limit || 10),
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
      steps,
      guidance,
      seed,
      model,
      initImageUrl,
      numImages = 1,
      aspectRatio,
      quality = 'high',
      style,
      sampler,
      provider: preferredProvider,
      imageStrength,
    } = body

    if (!prompt || !prompt.trim()) {
      clearTimeout(timeoutId)
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    // Model/provider validation
    const selectedProvider = preferredProvider || 'mistral'
    if (!ALLOWED_MODELS.includes(selectedProvider)) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        { error: `Provider '${selectedProvider}' is not allowed. Allowed: ${ALLOWED_MODELS.join(', ')}` },
        { status: 403 }
      )
    }

    // Usage quota check (optional - can be enhanced with per-user quotas)
    const maxImagesPerRequest = 4
    if (numImages > maxImagesPerRequest) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        { error: `Maximum ${maxImagesPerRequest} images per request allowed` },
        { status: 400 }
      )
    }

    // ✅ FIX 1: Early API key validation - check if ANY provider is configured
    const hasMistralKey = !!process.env.MISTRAL_API_KEY
    const hasReplicateKey = !!process.env.REPLICATE_API_TOKEN
    
    if (!hasMistralKey && !hasReplicateKey) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        { 
          error: 'No image generation providers configured. Please set MISTRAL_API_KEY or REPLICATE_API_TOKEN in your environment variables.' 
        },
        { status: 503 }
      )
    }

    // Get the registry with all providers
    const registry = getDefaultRegistry()

    // Initialize providers with environment variables
    registry.initializeAll({
      mistral: {
        apiKey: process.env.MISTRAL_API_KEY,
        baseURL: process.env.MISTRAL_BASE_URL,
      },
      replicate: {
        apiKey: process.env.REPLICATE_API_TOKEN,
      },
    })

    const availableProviders = await registry.getAvailableProviders();
    const hasInitializedProvider = availableProviders.length > 0;

    if (!hasInitializedProvider) {
      clearTimeout(timeoutId)
      return NextResponse.json(
        { error: 'Image generation service unavailable. Please try again later.' },
        { status: 503 }
      )
    }

    // Build unified parameters
    const params: ImageGenerationParams = {
      prompt: prompt.trim(),
      negativePrompt,
      width,
      height,
      steps,
      guidance,
      seed: seed === 'random' ? Math.floor(Math.random() * 2147483647) : seed,
      numImages,
      aspectRatio,
      quality,
      style,
      sampler,
      initImage: initImageUrl,
      imageStrength,
      extra: model ? { model } : {},
    }

    let result

    if (preferredProvider) {
      // Use specific provider
      result = await registry.generateWithProvider(preferredProvider, params, controller.signal)
    } else {
      // Use fallback chain
      result = await registry.generateWithFallback(params, undefined, controller.signal)
    }

    clearTimeout(timeoutId)

    return NextResponse.json({
      success: true,
      data: {
        images: result.images?.map((img) => ({
          url: img.url,
          width: img.width,
          height: img.height,
          seed: img.seed,
          metadata: img.metadata,
        })),
        provider: result.provider,
        model: result.model,
        fallbackChain: result.fallbackChain,
      },
    })
  } catch (error: any) {
    clearTimeout(timeoutId)

    console.error('Image generation error:', error)

    // Check for specific error types
    if (error?.type === 'NOT_CONFIGURED') {
      return NextResponse.json(
        { error: 'No image generation providers configured. Please check your API keys.' },
        { status: 503 }
      )
    }

    if (error?.type === 'AUTH_FAILED') {
      return NextResponse.json(
        { error: 'Authentication failed. Please check your API keys.' },
        { status: 401 }
      )
    }

    if (error?.type === 'RATE_LIMITED') {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    if (error?.type === 'TIMEOUT') {
      return NextResponse.json(
        { error: 'Image generation timed out. Please try again with a simpler prompt.' },
        { status: 504 }
      )
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to generate image' },
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
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '10',
    },
  })
}
