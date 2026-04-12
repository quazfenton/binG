/**
 * Mistral Transcription Module
 * 
 * Provides both:
 * - Client-side: Server-sent events streaming transcription (web/desktop)
 * - Desktop CLI: Standalone CLI tool with audio capture (desktop-only)
 * 
 * Usage:
 * - API route: POST /api/transcribe with audio data → returns transcript
 * - CLI: node mistraltranscribe.js --model <model> (desktop only)
 */

import { isDesktopMode } from '../../platform/src/env';

// Types
export interface TranscriptionOptions {
  model?: string;
  language?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface TranscriptionResult {
  text: string;
  duration?: number;
  segments?: TranscriptionSegment[];
}

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

// Client-side: Stream transcription from audio blob via API
export async function transcribeAudio(
  audioBlob: Blob,
  options: TranscriptionOptions = {}
): Promise<TranscriptionResult> {
  const apiKey = options.apiKey ?? process.env.MISTRAL_API_KEY;
  
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY not configured');
  }

  // Convert blob to base64
  const arrayBuffer = await audioBlob.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  const response = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model ?? 'voxtral-mini-transcribe-2405',
      audio: base64,
      language: options.language,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Transcription failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  
  return {
    text: data.text ?? data.transcription ?? '',
    duration: data.duration,
    segments: data.segments,
  };
}

// Client-side: Streaming transcription via SSE
export async function* streamTranscribe(
  audioChunks: AsyncIterable<Uint8Array>,
  options: TranscriptionOptions = {}
): AsyncGenerator<TranscriptionSegment> {
  const apiKey = options.apiKey ?? process.env.MISTRAL_API_KEY;
  const model = options.model ?? 'voxtral-mini-transcribe-realtime-2602';
  const baseUrl = options.baseUrl ?? 'https://api.mistral.ai';

  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY not configured');
  }

  // For streaming, use the WebSocket API
  const ws = new WebSocket(`${baseUrl.replace('https', 'wss')}/v1/audio/transcriptions`);

  ws.onopen = () => {
    // Send audio chunks
  };

  // Note: Full implementation would use Mistral's realtime transcription SDK
  // This is a placeholder for the streaming interface
}

// Desktop-only: CLI functionality
let isDesktop = false;

try {
  isDesktop = isDesktopMode();
} catch {
  isDesktop = false;
}

// Only import Node.js modules when running on desktop
if (isDesktop || typeof window === 'undefined') {
  // Dynamic imports for desktop-only functionality
  let spawn: typeof import('node:child_process').spawn | null = null;
  let yargs: typeof import('yargs/yargs') | null = null;
  let hideBin: typeof import('yargs/helpers').hideBin | null = null;

  async function loadDesktopDeps() {
    if (!spawn) {
      const childProcess = await import('node:child_process');
      spawn = childProcess.spawn;
    }
    if (!yargs) {
      yargs = (await import('yargs/yargs')).default;
    }
    if (!hideBin) {
      const helpers = await import('yargs/helpers');
      hideBin = helpers.hideBin;
    }
  }

  // Desktop CLI entry point
  export async function runTranscribeCLI(args: string[]) {
    await loadDesktopDeps();
    
    const { AudioEncoding, RealtimeTranscription } = await import('@mistralai/mistralai/extra/realtime');
    
    const argv = yargs!(args)
      .usage('Usage: $0 [options]')
      .option('model', {
        type: 'string',
        default: 'voxtral-mini-transcribe-realtime-2602',
        describe: 'Model ID',
      })
      .option('encoding', {
        type: 'string',
        default: 'pcm_s16le',
        describe: 'Audio encoding',
      })
      .option('sample-rate', {
        type: 'number',
        default: 16000,
        describe: 'Sample rate in Hz',
      })
      .option('api-key', {
        type: 'string',
        default: process.env.MISTRAL_API_KEY,
        describe: 'Mistral API key',
      })
      .option('base-url', {
        type: 'string',
        default: process.env.MISTRAL_BASE_URL ?? 'wss://api.mistral.ai',
        describe: 'API base URL',
      })
      .help()
      .parseSync();

    const apiKey = argv['api-key'] ?? process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      console.error('Missing MISTRAL_API_KEY');
      process.exit(1);
    }

    const client = new RealtimeTranscription({
      apiKey,
      serverURL: argv['base-url'],
    });

    // Capture audio using SoX
    const captureAudio = async function* (sampleRate: number): AsyncGenerator<Uint8Array> {
      const recorder = spawn!(
        'rec',
        ['-q', '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-r', String(sampleRate), '-c', '1', '-'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );

      recorder.on('error', (err: any) => {
        if (err.code === 'ENOENT') {
          console.error("Error: 'rec' not found. Install SoX: brew install sox (macOS) or apt install sox (Linux)");
          process.exit(1);
        }
        throw err;
      });

      try {
        if (!recorder.stdout) throw new Error('Failed to create audio capture stream');
        for await (const chunk of recorder.stdout) {
          yield new Uint8Array(chunk as Buffer);
        }
      } finally {
        if (!recorder.killed) recorder.kill('SIGTERM');
      }
    };

    console.log('Listening... (Ctrl+C to stop)\n');

    for await (const event of client.transcribeStream(
      captureAudio(argv['sample-rate']),
      argv.model,
      {
        audioFormat: {
          encoding: (AudioEncoding as any)[argv.encoding.toUpperCase()] ?? AudioEncoding.PcmS16le,
          sampleRate: argv['sample-rate'],
        },
      }
    )) {
      if (event.type === 'transcription.text.delta') {
        process.stdout.write(event.text);
      } else if (event.type === 'transcription.done') {
        process.stdout.write('\n');
        break;
      } else if (event.type === 'error') {
        const msg = typeof event.error.message === 'string' ? event.error.message : JSON.stringify(event.error.message);
        console.error(`\nTranscription error: ${msg}`);
        process.exitCode = 1;
        break;
      }
    }
  }

  // Run CLI if executed directly
  if (typeof require !== 'undefined' && require.main === module) {
    runTranscribeCLI(process.argv.slice(2)).catch(console.error);
  }
}

export default {
  transcribeAudio,
  streamTranscribe,
};