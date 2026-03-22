import { NextRequest, NextResponse } from 'next/server';
import { generateSpeech, checkKittenTTSAvailability, KITTEN_VOICES, KITTEN_MODELS } from '@/lib/voice/kitten-tts-server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, voice, model } = body;

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    const result = await generateSpeech({
      text,
      voice: voice || 'Bruno',
      model: model || 'KittenML/kitten-tts-mini-0.8'
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'TTS generation failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      audioData: result.audioData,
      voice: voice || 'Bruno',
      model: model || 'KittenML/kitten-tts-mini-0.8'
    });
  } catch (error: any) {
    console.error('[TTS API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return available voices and models
  const isAvailable = await checkKittenTTSAvailability();
  
  return NextResponse.json({
    available: isAvailable,
    voices: KITTEN_VOICES,
    models: KITTEN_MODELS.map(m => ({
      id: m.id,
      name: m.name,
      description: m.description
    }))
  });
}