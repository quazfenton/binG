import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';


/**
 * Validates HuggingFace model identifier format.
 * Prevents path traversal and SSRF attacks.
 * Format: [org/]model-name where org and model are alphanumeric with -_.
 */
const validateModelId = (model: string): boolean => {
  // Match: "model-name" or "org/model-name"
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(model);
};

export async function POST(req: NextRequest) {
  try {
    const { model, inputs, parameters } = await req.json();
    if (!model || inputs === undefined) {
      return NextResponse.json({ error: 'model and inputs are required' }, { status: 400 });
    }

    // SECURITY: Validate model identifier to prevent path traversal/SSRF
    if (typeof model !== 'string' || !validateModelId(model)) {
      return NextResponse.json(
        { error: 'Invalid model identifier format' },
        { status: 400 }
      );
    }

    const token = process.env.HUGGINGFACE_API_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'HUGGINGFACE_API_TOKEN is not configured' }, { status: 500 });
    }

    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs, parameters }),
    });

    const contentType = response.headers.get('content-type') || '';
    
    if (!response.ok) {
      // SECURITY: Log detailed error internally, return generic message to client
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      console.error('HuggingFace inference failed:', {
        status: response.status,
        model,
        details: payload,
      });
      return NextResponse.json(
        { error: 'HuggingFace inference failed' },
        { status: response.status }
      );
    }

    // Handle binary responses (audio, images, etc.) correctly
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      return NextResponse.json(payload);
    } else {
      // Stream binary data directly instead of buffering with blob()
      // This reduces memory usage and latency for large outputs
      const stream = response.body;
      if (!stream) {
        throw new Error('Response body is null');
      }
      return new NextResponse(stream, {
        headers: {
          'Content-Type': contentType || 'application/octet-stream',
        },
      });
    }
  } catch (error) {
    console.error('HuggingFace inference error:', error);
    return NextResponse.json({ error: 'Failed to run HuggingFace inference' }, { status: 500 });
  }
}
