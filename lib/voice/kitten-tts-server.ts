/**
 * KittenTTS Server Integration
 * 
 * This module provides a server-side interface to KittenTTS for generating
 * high-quality speech from text. It spawns a Python process to run the model.
 * 
 * KittenTTS models:
 * - kitten-tts-mini-0.8: 80M version (highest quality)
 * - kitten-tts-micro-0.8: 40M version (balances speed and quality)
 * - kitten-tts-nano-0.8: 15M version (tiny and fastest)
 * 
 * Available voices: Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo
 */

import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { promisify } from 'util';

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

// Default configuration
const DEFAULT_MODEL = 'KittenML/kitten-tts-mini-0.8';
const DEFAULT_VOICE = 'Bruno';
const SAMPLE_RATE = 24000;

// Input validation limits
const MAX_TEXT_LENGTH = 2000;
const MIN_TEXT_LENGTH = 1;

// Model caching - singleton pattern for performance
let cachedModel: any = null;
let cachedModelName: string | null = null;

export interface TTSRequest {
  text: string;
  voice?: string;
  model?: string;
  speed?: number;
}

export interface TTSResponse {
  success: boolean;
  audioData?: string; // Base64 encoded audio
  audioPath?: string;
  error?: string;
}

// Voice options
export const KITTEN_VOICES = [
  'Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'
] as const;

export type KittenVoice = typeof KITTEN_VOICES[number];

// Model options
export const KITTEN_MODELS = [
  { id: 'KittenML/kitten-tts-mini-0.8', name: 'Mini (80M)', description: 'Highest quality' },
  { id: 'KittenML/kitten-tts-micro-0.8', name: 'Micro (40M)', description: 'Balanced' },
  { id: 'KittenML/kitten-tts-nano-0.8', name: 'Nano (15M)', description: 'Fastest' },
] as const;

/**
 * Generate speech using KittenTTS
 * 
 * @param request - TTS request with text and optional voice/model
 * @returns Promise<TTSResponse> - Base64 encoded audio or error
 */
export async function generateSpeech(request: TTSRequest): Promise<TTSResponse> {
  const { text, voice = DEFAULT_VOICE, model = DEFAULT_MODEL } = request;
  
  // Input validation
  if (!text || text.trim().length === 0) {
    return { success: false, error: 'Text is required' };
  }
  
  if (text.length > MAX_TEXT_LENGTH) {
    return { success: false, error: `Text too long. Maximum ${MAX_TEXT_LENGTH} characters allowed.` };
  }
  
  if (text.length < MIN_TEXT_LENGTH) {
    return { success: false, error: 'Text too short.' };
  }
  
  if (!KITTEN_VOICES.includes(voice as KittenVoice)) {
    return { success: false, error: `Invalid voice. Choose from: ${KITTEN_VOICES.join(', ')}` };
  }

  // Validate model
  const validModels = KITTEN_MODELS.map(m => m.id) as string[];
  if (!validModels.includes(model)) {
    return { success: false, error: `Invalid model. Choose from: ${validModels.join(', ')}` };
  }

  // Create a unique temp file for this request
  const tempDir = os.tmpdir();
  const tempOutputPath = path.join(tempDir, `kittentts-${Date.now()}.wav`);
  
  // Escape text for Python string literal - use single quotes with proper escaping
  const escapedText = text.replace(/'/g, "'\\''").replace(/\n/g, '\\n');
  
  // Create Python script that uses sys.argv for safe parameter passing
  const pythonScript = `
import sys
import os

# Add current directory to path for imports
sys.path.insert(0, os.getcwd())

try:
    from kittentts import KittenTTS
    import soundfile as sf
    
    # Get parameters from command line arguments (safer than string interpolation)
    model = sys.argv[1] if len(sys.argv) > 1 else 'KittenML/kitten-tts-mini-0.8'
    voice = sys.argv[2] if len(sys.argv) > 2 else 'Bruno'
    text = sys.argv[3] if len(sys.argv) > 3 else ''
    output_path = sys.argv[4] if len(sys.argv) > 4 else '/tmp/output.wav'
    
    # Generate audio
    m = KittenTTS(model)
    audio = m.generate(text=text, voice=voice)
    
    # Save to temp file
    sf.write(output_path, audio, 24000)
    
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {str(e)}", file=sys.stderr)
    sys.exit(1)
`.replace(/\n/g, '; ');  // Single line for argument passing

  return new Promise((resolve) => {
    const pythonProcess = spawn('python3', [
      '-c', pythonScript,
      model,           // sys.argv[1]
      voice,           // sys.argv[2]
      escapedText,     // sys.argv[3]
      tempOutputPath   // sys.argv[4]
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH || '',
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', async (code) => {
      if (code !== 0) {
        console.error('[KittenTTS] Error:', stderr);
        resolve({ success: false, error: stderr || 'Generation failed' });
        return;
      }

      // Read the generated audio file
      try {
        if (fs.existsSync(tempOutputPath)) {
          const audioBuffer = fs.readFileSync(tempOutputPath);
          const base64Audio = audioBuffer.toString('base64');
          
          // Clean up temp file
          try {
            await unlinkAsync(tempOutputPath);
          } catch (e) {
            // Ignore cleanup errors
          }
          
          resolve({
            success: true,
            audioData: `data:audio/wav;base64,${base64Audio}`
          });
        } else {
          resolve({ success: false, error: 'Audio file not generated' });
        }
      } catch (error) {
        console.error('[KittenTTS] File error:', error);
        resolve({ success: false, error: 'Failed to read audio output' });
      }
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      pythonProcess.kill();
      resolve({ success: false, error: 'Generation timed out' });
    }, 60000);
  });
}

/**
 * Check if KittenTTS is available on the system
 */
export async function checkKittenTTSAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    const pythonProcess = spawn('python3', ['-c', 'from kittentts import KittenTTS; print("OK")'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    pythonProcess.on('close', (code) => {
      resolve(code === 0);
    });

    pythonProcess.on('error', () => {
      resolve(false);
    });

    setTimeout(() => {
      pythonProcess.kill();
      resolve(false);
    }, 5000);
  });
}