import { NextRequest, NextResponse } from 'next/server';


import { generateSpeech, checkKittenTTSAvailability, KITTEN_VOICES, KITTEN_MODELS } from '@/lib/voice/kitten-tts-server';
import { voiceServerManager } from '@/lib/voice/server-control';
import { auth0 } from '@/lib/auth0';

const VALID_MODEL_IDS = KITTEN_MODELS.map(m => m.id);

export async function POST(req: NextRequest) {
  try {
    // Auto-start local service if needed
    await voiceServerManager.startKittenServer();

    // Authenticate user before allowing TTS generation
    const session = await auth0.getSession(req);
    if (!session?.user) {
      return NextResponse.json(
        { 
          error: 'Authentication required',
          requiresAuth: true,
        }, 
        { status: 401 }
      );
    }

    const body = await req.json();
    const { text, voice, model } = body;

    // Validate text is a non-empty string
    if (typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // Validate model against allowed IDs to prevent injection
    const selectedModel = model && VALID_MODEL_IDS.includes(model)
      ? model
      : 'KittenML/kitten-tts-mini-0.8';

    // Validate voice against allowed IDs
    const selectedVoice = voice && KITTEN_VOICES.includes(voice as any)
      ? voice
      : 'Bruno';

    const result = await generateSpeech({
      text,
      voice: selectedVoice,
      model: selectedModel
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
      voice: selectedVoice,
      model: selectedModel,
      userId: session.user.sub,
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
      name: m.name
    }))
  });
}
