import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'

type GenerateBody = {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  guidance?: number
  seed?: number
  model?: string
  initImageUrl?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateBody
    const {
      prompt,
      negativePrompt = '',
      width = 768,
      height = 768,
      steps = 28,
      guidance = 4.5,
      seed,
      model = 'stability-ai/sdxl',
      initImageUrl,
    } = body

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const apiToken = process.env.REPLICATE_API_TOKEN
    if (!apiToken) {
      return NextResponse.json({ error: 'Missing REPLICATE_API_TOKEN' }, { status: 500 })
    }

    const replicate = new Replicate({ auth: apiToken })

    // Model aliases for convenience
    const modelAliases: Record<string, string> = {
      'sdxl': 'stability-ai/stable-diffusion-xl-base-1.0',
      'stability-ai/sdxl': 'stability-ai/stable-diffusion-xl-base-1.0',
      'flux-schnell': 'black-forest-labs/flux-schnell',
      'stable-diffusion-3.5': 'stability-ai/stable-diffusion-3.5-large',
    }

    const resolvedModel = modelAliases[model] || model

    // Build input based on common Replicate models
    const input: Record<string, any> = {
      prompt,
    }

    // Try common parameter names across models
    input['negative_prompt'] = negativePrompt
    input['width'] = width
    input['height'] = height
    input['num_inference_steps'] = steps
    input['guidance_scale'] = guidance
    if (typeof seed === 'number') input['seed'] = seed
    if (initImageUrl) input['image'] = initImageUrl

    const output = (await replicate.run(resolvedModel, { input })) as any

    // Normalize output into an array of image URLs
    let images: string[] = []
    if (Array.isArray(output)) {
      images = output.filter((u) => typeof u === 'string')
    } else if (output && typeof output === 'object') {
      if (Array.isArray(output.output)) images = output.output
      else if (typeof output.image === 'string') images = [output.image]
      else if (typeof output.url === 'string') images = [output.url]
    }

    if (!images.length) {
      return NextResponse.json({ error: 'No images generated' }, { status: 502 })
    }

    return NextResponse.json({ success: true, data: { images } })
  } catch (error: any) {
    console.error('Image generation error:', error)
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

















