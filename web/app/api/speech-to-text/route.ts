import { NextRequest, NextResponse } from 'next/server';

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? "voxtral-mini-transcribe-2405";

/**
 * Speech-to-Text API
 * 
 * Uses LiveKit's integrated Whisper transcription for real-time voice chat.
 * Also supports direct audio file transcription via Mistral.
 * 
 * POST /api/speech-to-text
 * {
 *   "audioData": "base64-encoded-audio",
 *   "provider": "mistral" | "livekit" | "browser"
 * }
 * 
 * For real-time transcription during LiveKit calls, use the LiveKit room events
 * which automatically transcribe audio from participants.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audioData, provider } = body;

    // If no audio data provided, return status
    if (!audioData) {
      return NextResponse.json({
        status: 'ready',
        message: 'Speech-to-text service ready',
        providers: ['livekit-whisper', 'web-speech-api', 'mistral']
      });
    }

    // Mistral transcription
    if (provider === 'mistral' || (!provider && MISTRAL_API_KEY)) {
      if (!MISTRAL_API_KEY) {
        return NextResponse.json({ error: "MISTRAL_API_KEY not configured" }, { status: 500 });
      }

      const response = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
          model: TRANSCRIBE_MODEL,
          audio: audioData,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json({ error: "Mistral transcription failed", details: errorText.slice(0, 200) }, { status: 502 });
      }

      const data = await response.json();
      return NextResponse.json({
        text: data.text ?? data.transcription ?? "",
        provider: 'mistral',
        duration: data.duration,
      });
    }

    // LiveKit transcription (requires being in a room)
    if (provider === 'livekit') {
      return NextResponse.json({
        error: 'LiveKit transcription requires joining a room',
        suggestion: 'Use /api/livekit/token to join a room for real-time transcription'
      }, { status: 501 });
    }

    // Browser (Web Speech API) - handled client-side
    return NextResponse.json({
      error: 'Browser transcription is handled client-side',
      suggestion: 'Use voiceService.startListening() for browser-based STT'
    }, { status: 501 });

  } catch (error: any) {
    console.error('[Speech-to-Text API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    providers: [
      {
        id: 'mistral',
        name: 'Mistral Voxtral',
        description: 'Direct audio transcription via Mistral API',
        requiresApiKey: true,
        envVar: 'MISTRAL_API_KEY'
      },
      {
        id: 'livekit-whisper',
        name: 'LiveKit Whisper',
        description: 'Real-time transcription via LiveKit rooms',
        requiresLiveKit: true
      },
      {
        id: 'web-speech-api',
        name: 'Web Speech API',
        description: 'Browser-native speech recognition',
        requiresLiveKit: false,
        clientSide: true
      }
    ],
    livekitConfigured: !!(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    mistralConfigured: !!MISTRAL_API_KEY,
    defaultModel: TRANSCRIBE_MODEL
  });
}
