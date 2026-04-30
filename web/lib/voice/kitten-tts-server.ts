/**
 * KittenTTS Server Integration (Optimized)
 * 
 * This module prefers connecting to a long-running KittenTTS FastAPI server
 * on port 8005 for low-latency synthesis. If the server is not available,
 * it falls back to spawning a Python process.
 */

import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { voiceServerManager } from './server-control';

const PORT = process.env.KITTEN_TTS_PORT || 8005;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

export interface TTSRequest {
  text: string;
  voice?: string;
  model?: string;
  speed?: number;
}

export interface TTSResponse {
  success: boolean;
  audioData?: string; // Base64 encoded data URI
  error?: string;
}

export const KITTEN_VOICES = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'] as const;

export const KITTEN_MODELS = [
  { id: 'KittenML/kitten-tts-mini-0.8', name: 'Mini (80M)' },
  { id: 'KittenML/kitten-tts-micro-0.8', name: 'Micro (40M)' },
  { id: 'KittenML/kitten-tts-nano-0.8', name: 'Nano (15M)' },
] as const;

/**
 * Generate speech using KittenTTS
 */
export async function generateSpeech(request: TTSRequest): Promise<TTSResponse> {
  // 1. Try hitting the long-running FastAPI server first (Latency: ~50-200ms)
  try {
    const response = await fetch(`${SERVER_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: request.text,
        voice: request.voice || 'Bruno',
        model_id: request.model || 'KittenML/kitten-tts-mini-0.8',
        speed: request.speed || 1.0,
      }),
      // Set a short timeout. If server isn't up, we fallback immediately.
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        audioData: `data:audio/wav;base64,${data.audioData}`
      };
    }
  } catch (err) {
    console.debug('[KittenTTS] FastAPI server not available, falling back to process spawn');
  }

  // 2. Fallback: Spawn-per-request (Latency: ~2-5s due to imports)
  // Ensure we try to start the server in the background for next time
  void voiceServerManager.startKittenServer();

  return performLegacySpawn(request);
}

async function performLegacySpawn(request: TTSRequest): Promise<TTSResponse> {
  const { text, voice = 'Bruno', model = 'KittenML/kitten-tts-mini-0.8' } = request;
  const tempDir = os.tmpdir();
  const tempId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const tempOutputPath = path.join(tempDir, `kittentts-${tempId}.wav`);
  
  const escapedText = text.replace(/'/g, "'\\''").replace(/\n/g, '\\n');
  
  const pythonScript = `
import sys, os
from kittentts import KittenTTS
import soundfile as sf
try:
    m = KittenTTS('${model}')
    audio = m.generate(text='''${escapedText}''', voice='${voice}')
    sf.write('${tempOutputPath.replace(/\\/g, '/')}', audio, 24000)
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {str(e)}", file=sys.stderr)
    sys.exit(1)
`;

  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', pythonScript], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => stderr += d.toString());
    proc.on('close', (code) => {
      if (code !== 0) return resolve({ success: false, error: stderr || 'Spawn failed' });
      try {
        const buffer = fs.readFileSync(tempOutputPath);
        fs.unlinkSync(tempOutputPath);
        resolve({ success: true, audioData: `data:audio/wav;base64,${buffer.toString('base64')}` });
      } catch (e) {
        resolve({ success: false, error: 'Failed to read output' });
      }
    });
  });
}

export async function checkKittenTTSAvailability(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) return true;
  } catch {}
  
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', 'import kittentts'], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
  });
}
