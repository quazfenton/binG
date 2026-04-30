/**
 * Image Generation Tools — Extracted from binG image API
 *
 * Supports Mistral FLUX, Replicate, and other providers.
 * Returns base64 image data or URLs for generated images.
 */

import { z } from 'zod';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ALLOWED_PROVIDERS = ['mistral', 'replicate', 'pollinations', 'local'] as const;
type ImageProvider = typeof ALLOWED_PROVIDERS[number];

const VALID_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;

interface ImageGenerationResult {
  success: boolean;
  url?: string;
  base64?: string;
  prompt: string;
  provider: string;
  error?: string;
}

/**
 * generate_image — Generate images using various providers
 *
 * Supports Mistral FLUX, Replicate, Pollinations (free), and local generation.
 * Returns URL or base64-encoded image data.
 */
export function generateImageTool() {
  return {
    name: 'generate_image',
    description: 'Generate images from text prompts using FLUX, SDXL, or other AI models. Returns URL or base64 data.',
    inputSchema: z.object({
      prompt: z.string().describe('Image generation prompt'),
      negativePrompt: z.string().optional().describe('Negative prompt (what to exclude)'),
      // MED-1 fix: Clamp dimensions to prevent memory exhaustion (max 4096px)
      width: z.number().int().min(64).max(4096).optional().describe('Image width (64-4096, default: 1024)'),
      height: z.number().int().min(64).max(4096).optional().describe('Image height (64-4096, default: 1024)'),
      model: z.string().optional().describe('Model name (flux, sdxl, etc.)'),
      provider: z.enum(ALLOWED_PROVIDERS).optional().describe('Image generation provider'),
      aspectRatio: z.enum(VALID_ASPECT_RATIOS).optional().describe('Aspect ratio'),
      // MED-1 fix: Limit number of images per request
      numImages: z.number().int().min(1).max(4).optional().describe('Number of images to generate (1-4)'),
      seed: z.number().optional().describe('Random seed for reproducibility'),
    }),
    execute: async ({
      prompt,
      negativePrompt,
      width,
      height,
      model,
      provider,
      aspectRatio,
      numImages = 1,
      seed,
    }: {
      prompt: string;
      negativePrompt?: string;
      width?: number;
      height?: number;
      model?: string;
      provider?: ImageProvider;
      aspectRatio?: typeof VALID_ASPECT_RATIOS[number];
      numImages?: number;
      seed?: number;
    }) => {
      if (!prompt || prompt.trim().length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Prompt is required' }],
          isError: true,
        };
      }

      const selectedProvider = provider || 'pollinations'; // Free by default
      // Dimensions already validated by zod schema (64-4096)
      const imgWidth = width || 1024;
      const imgHeight = height || 1024;
      const count = numImages || 1; // Already clamped by zod schema (1-4)

      // Try each provider in order of preference
      const results: ImageGenerationResult[] = [];

      for (let i = 0; i < count; i++) {
        const result = await generateSingleImage({
          prompt,
          negativePrompt,
          width: imgWidth,
          height: imgHeight,
          model,
          provider: selectedProvider,
          seed: seed ? seed + i : undefined,
        });
        results.push(result);
      }

      // Format results
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      const output: string[] = [];
      output.push(`Image Generation Results:`);
      output.push(`Prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
      output.push(`Provider: ${selectedProvider}`);
      output.push(`Generated: ${successCount}/${count} images`);
      output.push('');

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.success) {
          output.push(`✅ Image ${i + 1}:`);
          if (r.url) output.push(`   URL: ${r.url}`);
          if (r.base64) output.push(`   Base64: ${r.base64.slice(0, 80)}...`);
        } else {
          output.push(`❌ Image ${i + 1}: ${r.error}`);
        }
      }

      if (failCount > 0) {
        output.push('');
        output.push('Troubleshooting:');
        output.push('- Pollinations (free, no API key) should always work');
        output.push('- Mistral requires MISTRAL_API_KEY');
        output.push('- Replicate requires REPLICATE_API_TOKEN');
      }

      return {
        content: [{
          type: 'text' as const,
          text: output.join('\n'),
        }],
      };
    },
  };
}

interface ImageParams {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  model?: string;
  provider: ImageProvider;
  seed?: number;
}

async function generateSingleImage(params: ImageParams): Promise<ImageGenerationResult> {
  const { prompt, negativePrompt, width, height, model, provider, seed } = params;

  try {
    switch (provider) {
      case 'pollinations':
        return await generateWithPollinations(prompt, width, height, seed);
      case 'mistral':
        return await generateWithMistral(prompt, width, height, model, seed);
      case 'replicate':
        return await generateWithReplicate(prompt, width, height, model, negativePrompt, seed);
      case 'local':
        return await generatePlaceholderImage(prompt, width, height);
      default:
        return await generateWithPollinations(prompt, width, height, seed);
    }
  } catch (error: any) {
    return {
      success: false,
      prompt,
      provider,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Pollinations.AI — Free, no API key required
 */
async function generateWithPollinations(prompt: string, width: number, height: number, seed?: number): Promise<ImageGenerationResult> {
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=flux${seedParam}&nologo=true`;

  // Download the image and convert to base64
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });

  if (!response.ok) {
    throw new Error(`Pollinations HTTP ${response.status}: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const base64 = buffer.toString('base64');

  return {
    success: true,
    url,
    base64,
    prompt,
    provider: 'pollinations',
  };
}

/**
 * Mistral FLUX image generation (requires MISTRAL_API_KEY)
 */
async function generateWithMistral(prompt: string, width: number, height: number, model?: string, seed?: number): Promise<ImageGenerationResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY not set. Use provider="pollinations" for free generation.');
  }

  const response = await fetch('https://api.mistral.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      model: model || 'mistral-imagery-v1',
      size: `${width}x${height}`,
      ...(seed ? { random_seed: seed } : {}),
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mistral API error: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as { data?: Array<{ url?: string }> };
  const imageUrl = data.data?.[0]?.url;

  if (!imageUrl) {
    throw new Error('No image URL returned from Mistral API');
  }

  return {
    success: true,
    url: imageUrl,
    prompt,
    provider: 'mistral',
  };
}

/**
 * Replicate image generation (requires REPLICATE_API_TOKEN)
 */
async function generateWithReplicate(prompt: string, width: number, height: number, model?: string, negativePrompt?: string, seed?: number): Promise<ImageGenerationResult> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    throw new Error('REPLICATE_API_TOKEN not set. Use provider="pollinations" for free generation.');
  }

  const modelName = model || 'black-forest-labs/flux-schnel';

  // Start prediction
  const response = await fetch('https://api.replicate.com/v1/models/' + modelName + '/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      input: {
        prompt,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        width,
        height,
        ...(seed ? { seed } : {}),
      },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Replicate API error: ${response.status} ${text.slice(0, 200)}`);
  }

  const prediction = (await response.json()) as { urls?: { get?: string }; status?: string; error?: string; output?: string | string[] };
  const predictionUrl = prediction.urls?.get;

  if (!predictionUrl) {
    throw new Error('No prediction URL returned');
  }

  // Poll for completion with exponential backoff
  for (let i = 0; i < 30; i++) {
    const delay = Math.min(2000 * Math.pow(1.5, i), 15000);
    await new Promise(r => setTimeout(r, delay));

    try {
      const statusResponse = await fetch(predictionUrl, {
        headers: { Authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(30000),
      });

      const status = (await statusResponse.json()) as { status?: string; error?: string; output?: string | string[] };
      if (status.status === 'succeeded') {
        // Return all images if multiple were generated, otherwise the single URL
        const imageUrls = Array.isArray(status.output) ? status.output : [status.output as string];
        const imageUrl = imageUrls[0]; // Use the first one for the single-image result structure

        // Validate image URL is present and non-empty before returning
        if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
          throw new Error('No valid image URL returned from Replicate prediction');
        }

        return {
          success: true,
          url: imageUrl,
          prompt,
          provider: 'replicate',
        };
      }

      if (status.status === 'failed' || status.status === 'canceled') {
        throw new Error(`Replicate prediction ${status.status}: ${status.error || 'Unknown error'}`);
      }
    } catch (err) {
      // On network errors, log and continue to next polling iteration
      console.error(`Network error polling prediction (attempt ${i + 1}/30):`, err);
      if (i === 29) {
        // If this is the last attempt and we have a network error, throw it
        throw new Error(`Failed to poll Replicate prediction after 30 attempts: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      // Otherwise continue to next iteration
    }
  }

  throw new Error('Replicate prediction timed out');
}

/**
 * Generate a placeholder SVG image when no provider is available
 */
async function generatePlaceholderImage(prompt: string, width: number, height: number): Promise<ImageGenerationResult> {
  const encodedPrompt = encodeURIComponent(prompt.slice(0, 50));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#1a1a2e"/>
    <text x="50%" y="45%" fill="#eee" font-size="16" text-anchor="middle" font-family="sans-serif">
      ${encodedPrompt}
    </text>
    <text x="50%" y="55%" fill="#888" font-size="12" text-anchor="middle" font-family="sans-serif">
      Placeholder (${width}x${height})
    </text>
  </svg>`;

  const base64 = Buffer.from(svg).toString('base64');
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  return {
    success: true,
    url: dataUrl,
    base64,
    prompt,
    provider: 'local',
  };
}
