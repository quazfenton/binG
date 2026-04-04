/**
 * Session Bridge — Remote CLI Agent Connection via Intermittent Pulses
 * 
 * Manages the connection between the catalyst engine and an external CLI agent
 * running in a persistent remote session. Communication occurs through intermittent
 * input pulses — each pulse contains the agent's response and the engine processes
 * it, updates internal state, and prepares the next stimulus package.
 * 
 * @module agent-catalyst/session-bridge
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:SessionBridge');

export type SessionState = 'disconnected' | 'connecting' | 'connected' | 'awaiting-response' | 'error';

export interface SessionConfig {
  sessionId: string;
  maxPulseInterval?: number;     // ms — max time between pulses
  minPulseInterval?: number;     // ms — min time between pulses
  contextWindowSize?: number;     // How much context to include per pulse
  maxRetries?: number;
  retryDelay?: number;           // ms
}

export interface SessionPulse {
  id: string;
  timestamp: number;
  direction: 'to-agent' | 'from-agent';
  content: string;
  processingTime?: number;       // ms
  success: boolean;
  error?: string;
}

const DEFAULT_CONFIG: Required<SessionConfig> = {
  sessionId: 'catalyst-session',
  maxPulseInterval: 120000,      // 2 minutes
  minPulseInterval: 5000,        // 5 seconds
  contextWindowSize: 8000,       // ~2000 tokens
  maxRetries: 3,
  retryDelay: 2000,
};

export class SessionBridge {
  private config: Required<SessionConfig>;
  private state: SessionState = 'disconnected';
  private pulses: SessionPulse[] = [];
  private lastPulseAt = 0;
  private onPulse: ((pulse: SessionPulse) => void) | null = null;
  private onStateChange: ((state: SessionState) => void) | null = null;

  constructor(config: SessionConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onPulse(callback: (pulse: SessionPulse) => void): void {
    this.onPulse = callback;
  }

  onStateChange(callback: (state: SessionState) => void): void {
    this.onStateChange = callback;
  }

  /**
   * Get current session state
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Simulate connection to external agent
   */
  connect(): void {
    if (this.state === 'connected') return;
    this.state = 'connecting';
    this.notifyStateChange();

    // Simulate connection delay
    setTimeout(() => {
      this.state = 'connected';
      this.notifyStateChange();
      logger.info('Session bridge connected', { sessionId: this.config.sessionId });
    }, 500);
  }

  /**
   * Disconnect from external agent
   */
  disconnect(): void {
    this.state = 'disconnected';
    this.notifyStateChange();
    logger.info('Session bridge disconnected');
  }

  /**
   * Send a pulse to the agent
   */
  async sendPulse(content: string): Promise<SessionPulse> {
    const now = Date.now();

    // Enforce minimum pulse interval
    if (now - this.lastPulseAt < this.config.minPulseInterval) {
      const delay = this.config.minPulseInterval - (now - this.lastPulseAt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (this.state !== 'connected') {
      const pulse: SessionPulse = {
        id: `pulse-${Date.now()}`,
        timestamp: Date.now(),
        direction: 'to-agent',
        content,
        success: false,
        error: `Session not connected (state: ${this.state})`,
      };
      this.pulses.push(pulse);
      return pulse;
    }

    const pulse: SessionPulse = {
      id: `pulse-${Date.now()}`,
      timestamp: Date.now(),
      direction: 'to-agent',
      content,
      success: true,
    };

    this.pulses.push(pulse);
    this.lastPulseAt = Date.now();
    this.state = 'awaiting-response';
    this.notifyStateChange();

    if (this.onPulse) this.onPulse(pulse);
    logger.debug('Pulse sent to agent', { pulseId: pulse.id, contentLength: content.length });

    return pulse;
  }

  /**
   * Record agent's response pulse
   */
  receivePulse(content: string): SessionPulse {
    const now = Date.now();

    const pulse: SessionPulse = {
      id: `pulse-${Date.now()}`,
      timestamp: now,
      direction: 'from-agent',
      content,
      processingTime: this.state === 'awaiting-response' ? now - this.lastPulseAt : undefined,
      success: true,
    };

    this.pulses.push(pulse);
    this.lastPulseAt = now;
    this.state = 'connected';
    this.notifyStateChange();

    if (this.onPulse) this.onPulse(pulse);
    logger.debug('Pulse received from agent', {
      pulseId: pulse.id,
      contentLength: content.length,
      processingTime: pulse.processingTime,
    });

    return pulse;
  }

  /**
   * Get recent pulses
   */
  getRecentPulses(limit = 20, direction?: 'to-agent' | 'from-agent'): SessionPulse[] {
    let pulses = this.pulses
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit * 2);

    if (direction) {
      pulses = pulses.filter(p => p.direction === direction);
    }

    return pulses.slice(0, limit);
  }

  /**
   * Get pulse statistics
   */
  getStats(): {
    totalPulses: number;
    toAgent: number;
    fromAgent: number;
    avgProcessingTime: number;
    lastPulseAt: number;
    state: SessionState;
  } {
    const toAgent = this.pulses.filter(p => p.direction === 'to-agent').length;
    const fromAgent = this.pulses.filter(p => p.direction === 'from-agent').length;
    const processingTimes = this.pulses.filter(p => p.processingTime !== undefined).map(p => p.processingTime!);
    const avgProcessingTime = processingTimes.length > 0 ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length : 0;

    return {
      totalPulses: this.pulses.length,
      toAgent,
      fromAgent,
      avgProcessingTime,
      lastPulseAt: this.lastPulseAt,
      state: this.state,
    };
  }

  /**
   * Serialize for persistence
   */
  toJSON(): string {
    return JSON.stringify({
      config: this.config,
      state: this.state,
      pulses: this.pulses.slice(-100),
    });
  }

  /**
   * Load from serialized state
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json);
    if (data.config) this.config = { ...DEFAULT_CONFIG, ...data.config };
    if (data.state) this.state = data.state;
    if (data.pulses) this.pulses = data.pulses;
    if (data.pulses?.length > 0) {
      this.lastPulseAt = data.pulses[data.pulses.length - 1].timestamp;
    }
    logger.info('Session bridge loaded', { state: this.state, pulses: this.pulses.length });
  }

  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.state);
    }
  }
}
