import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side Text-to-Speech API
 * 
 * Supports multiple TTS providers:
 * - ElevenLabs (high quality, requires API key)
 * - Cartesia (ultra-low latency, requires API key)
 * - Web (browser SpeechSynthesis, default fallback)
 * 
 * Usage:
 * POST /api/tts
 * {
 *   "text": "Hello world",
 *   "provider": "elevenlabs" | "cartesia" | "web",
 *   "voiceId": "optional-voice-id"
 * }
 */

export async function POST(req: NextRequest) {
  try {
    const { text, provider = 'web', voiceId } = await req.json();

    // Validate text is a string
    if (typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text must be a string' },
        { status: 400 }
      );
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // Try ElevenLabs if configured
    if (provider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
      return await synthesizeElevenLabs(text, voiceId);
    }

    // Try Cartesia if configured
    if (provider === 'cartesia' && process.env.CARTESIA_API_KEY) {
      return await synthesizeCartesia(text, voiceId);
    }

    // Fallback: Return text for client-side synthesis
    return NextResponse.json({
      text,
      provider: 'web',
      message: 'Using client-side speech synthesis'
    });
  } catch (error: any) {
    console.error('[TTS] Error:', error);
    return NextResponse.json(
      { error: error.message || 'TTS synthesis failed' },
      { status: 500 }
    );
  }
}

async function synthesizeElevenLabs(text: string, voiceId?: string) {
  const defaultVoiceId = 'EXAVITQu4vr4xnSDxMaL'; // Default ElevenLabs voice
  
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId || defaultVoiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error('ElevenLabs synthesis failed');
  }

  const audioBuffer = await response.arrayBuffer();
  
  return new NextResponse(audioBuffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength.toString(),
    },
  });
}

async function synthesizeCartesia(text: string, voiceId?: string) {
  const defaultVoiceId = '692530db-220c-4789-9917-79a844212011'; // Default Cartesia voice
  
  const response = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.CARTESIA_API_KEY!,
    },
    body: JSON.stringify({
      model_id: 'sonic-english',
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId || defaultVoiceId,
      },
      output_format: {
        container: 'mp3',
        encoding: 'mp3',
        sample_rate: 44100,
      },
    }),
  });

  if (!response.ok) {
    throw new Error('Cartesia synthesis failed');
  }

  const audioBuffer = await response.arrayBuffer();
  
  return new NextResponse(audioBuffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength.toString(),
    },
  });
}

export async function GET() {
  return NextResponse.json({
    providers: ['elevenlabs', 'cartesia', 'web'],
    elevenlabsConfigured: !!process.env.ELEVENLABS_API_KEY,
    cartesiaConfigured: !!process.env.CARTESIA_API_KEY,
  });
}
