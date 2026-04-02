import { NextRequest, NextResponse } from 'next/server';

/**
 * Speech-to-Text API
 * 
 * Uses LiveKit's integrated Whisper transcription for real-time voice chat.
 * Also supports direct audio file transcription.
 * 
 * POST /api/speech-to-text
 * {
 *   "audioData": "base64-encoded-audio" // Optional: for direct transcription
 * }
 * 
 * For real-time transcription during LiveKit calls, use the LiveKit room events
 * which automatically transcribe audio from participants.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audioData } = body;

    // If no audio data provided, just return status
    // Real-time transcription happens via LiveKit room events
    if (!audioData) {
      return NextResponse.json({
        status: 'ready',
        message: 'Speech-to-text service ready. Use LiveKit for real-time transcription.',
        providers: ['livekit-whisper', 'web-speech-api']
      });
    }

    // For direct audio transcription, we'd use a service like:
    // - OpenAI Whisper API
    // - LiveKit's Whisper (if in a room)
    // For now, return unimplemented error as direct transcription requires additional setup

    return NextResponse.json({
      error: 'Direct audio transcription not implemented. Use LiveKit room transcription.',
      suggestion: 'Connect to a LiveKit room for real-time transcription'
    }, { status: 501 }); // 501 Not Implemented

  } catch (error: any) {
    console.error('[Speech-to-Text API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return available speech-to-text options
  return NextResponse.json({
    providers: [
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
    livekitConfigured: !!(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)
  });
}