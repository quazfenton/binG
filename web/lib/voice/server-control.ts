/**
 * Voice Server Control
 * 
 * Manages local voice services (KittenTTS, LiveKit local)
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { createLogger } from '@/lib/utils/logger';
import path from 'path';

const logger = createLogger('Voice:Server');

class VoiceServerManager {
  private processes: Map<string, ChildProcess> = new Map();
  private isShuttingDown = false;

  constructor() {
    if (typeof process !== 'undefined') {
      process.on('exit', () => this.shutdownAll());
      process.on('SIGINT', () => this.shutdownAll());
      process.on('SIGTERM', () => this.shutdownAll());
    }
  }

  /**
   * Start local KittenTTS server (if not already running)
   */
  async startKittenServer(): Promise<void> {
    if (this.processes.has('kittentts')) return;

    // First check if something is already on the port
    const port = parseInt(process.env.KITTEN_TTS_PORT || '8005');
    const isActive = await this.checkPortActive(port);
    if (isActive) return;

    logger.info(`Starting local KittenTTS FastAPI server on port ${port}...`);
    
    // Check requirements
    try {
      execSync('python3 -c "import fastapi, uvicorn, kittentts"', { stdio: 'ignore' });
    } catch {
      logger.warn('KittenTTS requirements missing. Run: pip install kittentts fastapi uvicorn soundfile');
      return;
    }

    const scriptPath = path.join(process.cwd(), 'web/lib/voice/kitten_server.py');
    const child = spawn('python3', [scriptPath], {
      env: { ...process.env, KITTEN_TTS_PORT: port.toString() },
      stdio: 'inherit',
    });

    child.on('error', (err) => logger.error('Failed to start Kitten server:', err));
    child.on('exit', (code) => {
      logger.info(`Kitten server exited with code ${code}`);
      this.processes.delete('kittentts');
    });

    this.processes.set('kittentts', child);
  }

  /**
   * Start local LiveKit server (if configured as local)
   */
  async startLiveKitServer(): Promise<void> {
    const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || '';
    const isLocal = lkUrl.includes('localhost') || lkUrl.includes('127.0.0.1');

    if (!isLocal || this.processes.has('livekit')) return;

    const port = parseInt(new URL(lkUrl).port) || 7800;
    const isRunning = await this.checkPortActive(port);
    if (isRunning) return;

    logger.info(`Starting local LiveKit server on port ${port}...`);
    
    try {
      const binary = this.findLiveKitBinary();
      if (!binary) {
        logger.warn('LiveKit binary not found. Install via: brew install livekit-server');
        return;
      }

      const child = spawn(binary, ['--dev'], { stdio: 'inherit', shell: true });
      child.on('error', (err) => logger.error('LiveKit spawn error:', err));
      this.processes.set('livekit', child);
    } catch (error) {
      logger.error('Error launching LiveKit:', error);
    }
  }

  private checkPortActive(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const conn = net.createConnection(port, '127.0.0.1')
        .on('connect', () => { conn.destroy(); resolve(true); })
        .on('error', () => resolve(false));
    });
  }

  private findLiveKitBinary(): string | null {
    const paths = ['livekit-server', '/usr/local/bin/livekit-server', './livekit-server'];
    for (const p of paths) {
      try {
        execSync(`which ${p}`, { stdio: 'ignore' });
        return p;
      } catch {}
    }
    return null;
  }

  private shutdownAll() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    for (const [name, proc] of this.processes) {
      logger.info(`Stopping ${name}...`);
      proc.kill();
    }
    this.processes.clear();
  }
}

export const voiceServerManager = new VoiceServerManager();
