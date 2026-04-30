import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

export async function POST(req: NextRequest) {
  try {
    if (!GOOGLE_API_KEY) {
      return NextResponse.json({ error: 'GOOGLE_API_KEY not configured' }, { status: 500 });
    }

    const { text, model = 'gemini-2.0-flash' } = await req.json();

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const modelInstance = genAI.getGenerativeModel({ model });
    
    // Using generative model with system instructions for TTS-like behavior
    // Requesting response in audio/wav format if supported or text-to-speech instructions
    const result = await modelInstance.generateContent([
      { text: `Read the following text exactly as written with a natural, professional voice: ${text}` }
    ]);

    const response = await result.response;
    
    // In Gemini 2.0, audio output can be part of the response parts.
    // We check for inlineData with audio mime types.
    let audioData = null;
    const parts = response.candidates?.[0]?.content?.parts || [];
    
    for (const part of parts) {
      if (part.inlineData && part.inlineData.mimeType.startsWith('audio/')) {
        audioData = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        break;
      }
    }

    if (!audioData) {
      // Fallback: If no direct audio part, we might use a secondary TTS model 
      // or return a specific error that triggers the frontend fallback chain
      return NextResponse.json({ 
        success: false, 
        error: 'Model did not return audio data. Ensure you are using a model that supports audio output (e.g., gemini-2.0-flash).' 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      audioData,
      text
    });
  } catch (error: any) {
    console.error('[Gemini TTS API] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
