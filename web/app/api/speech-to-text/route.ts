import { NextRequest, NextResponse } from 'next/server';

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const GLADIA_API_KEY = process.env.GLADIA_API_KEY;

const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? "voxtral-mini-transcribe-2405";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audioData, provider = 'mistral', language = 'en' } = body;

    if (!audioData) {
      return NextResponse.json({ error: 'Audio data is required' }, { status: 400 });
    }

    // Mistral transcription
    if (provider === 'mistral') {
      if (!MISTRAL_API_KEY) return NextResponse.json({ error: "MISTRAL_API_KEY not configured" }, { status: 500 });

      const response = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: TRANSCRIBE_MODEL, audio: audioData }),
      });

      if (!response.ok) throw new Error(`Mistral error: ${response.status}`);
      const data = await response.json();
      return NextResponse.json({ text: data.text || data.transcription || "" });
    }

    // Deepgram transcription
    if (provider === 'deepgram') {
      if (!DEEPGRAM_API_KEY) return NextResponse.json({ error: "DEEPGRAM_API_KEY not configured" }, { status: 500 });

      const response = await fetch("https://api.deepgram.com/v1/listen?smart_format=true&model=nova-2", {
        method: "POST",
        headers: { "Authorization": `Token ${DEEPGRAM_API_KEY}`, "Content-Type": "application/octet-stream" },
        body: Buffer.from(audioData, 'base64'),
      });

      if (!response.ok) throw new Error(`Deepgram error: ${response.status}`);
      const data = await response.json();
      return NextResponse.json({ text: data.results?.channels[0]?.alternatives[0]?.transcript || "" });
    }

    // AssemblyAI transcription
    if (provider === 'assemblyai') {
      if (!ASSEMBLYAI_API_KEY) return NextResponse.json({ error: "ASSEMBLYAI_API_KEY not configured" }, { status: 500 });

      // AssemblyAI requires a file upload first or a URL. For simplicity, we use the Leashed API or upload.
      // Here we assume a direct transcription call if supported or a quick upload flow.
      const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
        method: "POST",
        headers: { "Authorization": ASSEMBLYAI_API_KEY },
        body: Buffer.from(audioData, 'base64'),
      });
      const { upload_url } = await uploadResponse.json();

      const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: { "Authorization": ASSEMBLYAI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ audio_url: upload_url }),
      });
      const { id } = await transcriptResponse.json();

      // Poll for completion (simplified for this context)
      let text = "";
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
          headers: { "Authorization": ASSEMBLYAI_API_KEY },
        });
        const statusData = await statusResponse.json();
        if (statusData.status === 'completed') {
          text = statusData.text;
          break;
        }
      }

      return NextResponse.json({ text });
    }

    // Gladia transcription
    if (provider === 'gladia') {
      if (!GLADIA_API_KEY) return NextResponse.json({ error: "GLADIA_API_KEY not configured" }, { status: 500 });

      const response = await fetch("https://api.gladia.io/v2/transcription", {
        method: "POST",
        headers: { "x-gladia-key": GLADIA_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ audio_base64: audioData }),
      });

      if (!response.ok) throw new Error(`Gladia error: ${response.status}`);
      const data = await response.json();
      return NextResponse.json({ text: data.prediction || "" });
    }

    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });

  } catch (error: any) {
    console.error('[STT API] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    providers: ['browser', 'mistral', 'deepgram', 'assemblyai', 'gladia'],
    configured: {
      mistral: !!MISTRAL_API_KEY,
      deepgram: !!DEEPGRAM_API_KEY,
      assemblyai: !!ASSEMBLYAI_API_KEY,
      gladia: !!GLADIA_API_KEY,
    }
  });
}
