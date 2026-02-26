import { NextRequest, NextResponse } from 'next/server';

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
    const token = process.env.HUGGINGFACE_API_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'HUGGINGFACE_API_TOKEN is not configured' }, { status: 500 });
    }

    const formData = await req.formData();
    const model = String(formData.get('model') || '');
    const text = String(formData.get('text') || '');
    const audio = formData.get('audio') as File | null;
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }

    // SECURITY: Validate model identifier to prevent path traversal/SSRF
    if (!validateModelId(model)) {
      return NextResponse.json(
        { error: 'Invalid model identifier format' },
        { status: 400 }
      );
    }

    let upstream: Response;
    if (audio) {
      upstream = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': audio.type || 'application/octet-stream',
        },
        body: audio,
      });
    } else {
      upstream = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: text }),
      });
    }

    if (!upstream.ok) {
      // SECURITY: Log detailed error internally, return generic message to client
      const errorContentType = upstream.headers.get('content-type') || '';
      const errorPayload = errorContentType.includes('application/json')
        ? await upstream.json()
        : await upstream.text();
      console.error('HuggingFace audio failed:', {
        status: upstream.status,
        model,
        details: errorPayload,
      });
      return NextResponse.json(
        { error: 'Audio inference failed' },
        { status: upstream.status }
      );
    }

    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    const blob = await upstream.blob();
    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    console.error('HuggingFace audio error:', error);
    return NextResponse.json({ error: 'Failed to run HuggingFace audio' }, { status: 500 });
  }
}
