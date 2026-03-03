import { NextRequest, NextResponse } from 'next/server'
import {
  getDefaultRegistry,
  type ImageGenerationParams,
  type AspectRatio,
} from '@/lib/image-generation'

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

export async function POST(req: NextRequest) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 180000) // 3 minute timeout

  try {
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
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
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
    const initializedRegistry = registry.initializeAll({
      mistral: {
        apiKey: process.env.MISTRAL_API_KEY,
        baseURL: process.env.MISTRAL_BASE_URL,
      },
      replicate: {
        apiKey: process.env.REPLICATE_API_TOKEN,
      },
    })

    if (!initializedRegistry) {
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
      result = await initializedRegistry.generateWithProvider(preferredProvider, params, controller.signal)
    } else {
      // Use fallback chain
      result = await initializedRegistry.generateWithFallback(params, undefined, controller.signal)
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
    },
  })
}
