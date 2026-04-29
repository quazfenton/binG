/**
 * Voice / TTS Tools — Extracted from binG voice service
 *
 * Uses KittenTTS (local) or web Speech API for text-to-synthesis.
 */

import { z } from 'zod';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const KITTEN_MODELS = [
  'KittenML/kitten-tts-mini-0.8',
  'KittenML/kitten-tts-micro-0.8',
  'KittenML/kitten-tts-nano-0.8',
] as const;

const KITTEN_VOICES = ['Bruno', 'Sarah', 'Default'] as const;

const MAX_TEXT_LENGTH = 5000;

/**
 * voice_speech — Generate speech from text using TTS
 *
 * Supports KittenTTS (local Python) and browser SpeechSynthesis fallback.
 * Returns base64-encoded WAV audio or a text description when TTS unavailable.
 */
export function voiceSpeechTool() {
  return {
    name: 'voice_speech',
    description: 'Generate speech audio from text using neural TTS (KittenTTS) or web speech synthesis. Returns base64 WAV or description.',
    inputSchema: z.object({
      text: z.string().describe('Text to synthesize into speech'),
      voice: z.string().optional().describe('Voice name (Bruno, Sarah, Default)'),
      model: z.string().optional().describe('TTS model: KittenML/kitten-tts-mini-0.8, micro, or nano'),
    }),
    execute: async ({ text, voice, model }: { text: string; voice?: string; model?: string }) => {
      if (!text || text.trim().length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Text is required' }],
          isError: true,
        };
      }

      if (text.length > MAX_TEXT_LENGTH) {
        return {
          content: [{ type: 'text' as const, text: `Error: Text too long. Maximum ${MAX_TEXT_LENGTH} characters.` }],
          isError: true,
        };
      }

      const selectedVoice = voice || 'Bruno';
      const selectedModel = model || 'KittenML/kitten-tts-mini-0.8';

      // Try KittenTTS first (requires Python + kittentts package)
      const kittenAvailable = await checkKittenTTSAvailability();

      if (kittenAvailable) {
        return await generateKittenTTS(text, selectedVoice, selectedModel);
      }

      // Fallback: Return text description since we can't generate audio in stdio mode
      return {
        content: [{
          type: 'text' as const,
          text: `TTS requested:\n- Text: "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"\n- Voice: ${selectedVoice}\n- Model: ${selectedModel}\n\nNote: KittenTTS (Python) not available. In a browser context, this would use SpeechSynthesis. Install KittenTTS: pip install kittentts`,
        }],
      };
    },
  };
}

async function generateKittenTTS(text: string, voice: string, model: string) {
  const tempDir = tmpdir();
  const tempId = `${Date.now()}-${randomUUID()}`;
  const outputPath = join(tempDir, `kittentts-${tempId}.wav`);

  // HIGH-6 fix: Write text to a temp file and pass filename to Python,
  // instead of embedding text inline in a shell command. This prevents
  // shell/Python injection via crafted text containing ''' or other escapes.
  const textFilePath = join(tempDir, `kittentts-text-${tempId}.txt`);
  await fs.writeFile(textFilePath, text, 'utf-8');

  // Validate model and voice names to prevent injection via those params
  const safeModel = /^[a-zA-Z0-9\/._-]+$/.test(model) ? model : 'KittenML/kitten-tts-mini-0.8';
  const safeVoice = /^[a-zA-Z0-9]+$/.test(voice) ? voice : 'Bruno';

  const pythonScript = [
    'import sys, os',
    'try:',
    '    from kittentts import KittenTTS',
    '    import soundfile as sf',
    `    m = KittenTTS('${safeModel}')`,
    `    with open('${textFilePath.replace(/'/g, "'\\''")}', 'r', encoding='utf-8') as f:`,
    '        text_content = f.read()',
    `    audio = m.generate(text=text_content, voice='${safeVoice}')`,
    `    sf.write('${outputPath.replace(/'/g, "'\\''")}', audio, 24000)`,
    '    print("SUCCESS")',
    '    os.unlink("' + textFilePath.replace(/'/g, "'\\''") + '")',
    'except Exception as e:',
    '    print(f"ERROR: {str(e)}", file=sys.stderr)',
    '    try: os.unlink("' + textFilePath.replace(/'/g, "'\\''") + '")',
    '    except: pass',
    '    sys.exit(1)',
  ].join('; ');

  return new Promise((resolve) => {
    const pythonProcess = spawn('python3', ['-c', pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    pythonProcess.on('close', async (code) => {
      if (code !== 0) {
        // Cleanup temp text file on error (HIGH-6: prevent temp file leaks)
        await fs.unlink(textFilePath).catch(() => {});
        resolve({
          content: [{ type: 'text' as const, text: `KittenTTS error: ${stderr || 'exit code ' + code}` }],
          isError: true,
        });
        return;
      }

      try {
        const audioBuffer = await fs.readFile(outputPath);
        const base64Audio = audioBuffer.toString('base64');
        const sizeKB = (audioBuffer.length / 1024).toFixed(1);

        // Clean up temp file
        await fs.unlink(outputPath).catch(() => {});

        resolve({
          content: [{
            type: 'text' as const,
            text: `Audio generated successfully (${sizeKB} KB)\nModel: ${model}\nVoice: ${voice}\nFormat: WAV 24kHz\nBase64: [${base64Audio.slice(0, 100)}...${base64Audio.length} bytes total]\n\n(Use the base64 data to play or save as .wav file)`,
          }],
        });
      } catch (err: any) {
        resolve({
          content: [{ type: 'text' as const, text: `Failed to read audio file: ${err.message}` }],
          isError: true,
        });
      }
    });
  });
}

async function checkKittenTTSAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', 'from kittentts import KittenTTS; print("OK")'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
