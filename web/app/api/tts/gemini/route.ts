import { NextRequest, NextResponse } from 'next/server';


import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export async function POST(req: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY or GOOGLE_API_KEY not configured' }, { status: 500 });
    }

    const { text, model = 'gemini-3.1-flash-tts-preview' } = await req.json();

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const modelInstance = genAI.getGenerativeModel({ 
      model,
      generationConfig: {
        // Configuration for speech synthesis
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            presetVoice: 'Narrator',
          },
        },
      } as any,
    });
    
    // Use generateContent to create audio
    const result = await modelInstance.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: text,
            },
          ],
        },
      ],
    });

    const response = await result.response;
    
    // Extract audio data from response
    let audioData = null;
    const parts = response.candidates?.[0]?.content?.parts || [];
    
    for (const part of parts) {
      // Check for inline audio data
      if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
        audioData = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        break;
      }
    }

    if (!audioData) {
      return NextResponse.json({ 
        success: false, 
        error: 'Model did not return audio data. Ensure you are using the gemini-3.1-flash-tts-preview model with proper configuration.' 
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
