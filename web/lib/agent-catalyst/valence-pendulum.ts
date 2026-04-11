/**
 * Valence Pendulum — Emotional/Motivational State Oscillation
 * 
 * Models the agent's internal emotional state as a pendulum that swings between
 * positive and negative valence. The pendulum is influenced by feedback, stimuli,
 * and internal reflection — creating a dynamic motivational landscape that drives
 * directionality and preference formation.
 * 
 * @module agent-catalyst/valence-pendulum
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:ValencePendulum');

export type ValencePhase = 'elation' | 'optimism' | 'equilibrium' | 'frustration' | 'despair' | 'curiosity' | 'determination';

export interface ValenceState {
  valence: number;           // -1 to +1
  arousal: number;           // 0-1: activation level
  phase: ValencePhase;
  momentum: number;          // -1 to +1: direction of change
  phaseDuration: number;     // ms spent in current phase
  lastTransition: number;
}

export interface ValenceConfig {
  inertia?: number;          // Resistance to change (0-1)
  naturalFrequency?: number; // Natural oscillation period (ms)
  dampingFactor?: number;    // Energy loss per cycle (0-1)
  stimulusGain?: number;     // How much external input affects pendulum
  reflectionGain?: number;   // How much self-reflection affects pendulum
}

const DEFAULT_CONFIG: Required<ValenceConfig> = {
  inertia: 0.7,
  naturalFrequency: 300000,    // 5 minutes natural period
  dampingFactor: 0.05,
  stimulusGain: 0.3,
  reflectionGain: 0.2,
};

export class ValencePendulum {
  private config: Required<ValenceConfig>;
  private state: ValenceState;
  private _onChange: ((state: ValenceState) => void) | null = null;
  private lastTick = Date.now();

  constructor(config: ValenceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      valence: 0,
      arousal: 0.5,
      phase: 'equilibrium',
      momentum: 0,
      phaseDuration: 0,
      lastTransition: Date.now(),
    };
  }

  onChange(callback: (state: ValenceState) => void): void {
    this._onChange = callback;
  }

  /**
   * Get current valence state
   */
  getState(): ValenceState {
    this.tick();
    return { ...this.state };
  }

  /**
   * Apply external stimulus to pendulum
   */
  applyStimulus(valence: number, arousal: number): void {
    const adjustedValence = valence * this.config.stimulusGain;
    const adjustedArousal = arousal * this.config.stimulusGain;

    this.state.valence += adjustedValence * (1 - this.config.inertia);
    this.state.arousal = Math.max(0, Math.min(1, this.state.arousal + adjustedArousal * (1 - this.config.inertia)));
    this.state.momentum += adjustedValence * 0.5;

    this.clampAndNotify();
  }

  /**
   * Apply reflection effect
   */
  applyReflection(insight: number): void {
    // Positive insight increases valence and arousal
    this.state.valence += insight * this.config.reflectionGain * (1 - this.config.inertia);
    this.state.arousal = Math.max(0, Math.min(1, this.state.arousal + Math.abs(insight) * 0.1));
    this.clampAndNotify();
  }

  /**
   * Apply feedback effect
   */
  applyFeedback(isPositive: boolean, intensity: number): void {
    const valenceDelta = isPositive ? intensity * 0.4 : -intensity * 0.6;
    this.state.valence += valenceDelta * (1 - this.config.inertia);
    this.state.arousal = Math.max(0, Math.min(1, this.state.arousal + intensity * 0.2));
    this.state.momentum += valenceDelta * 0.3;
    this.clampAndNotify();
  }

  /**
   * Advance internal clock
   */
  private tick(): void {
    const now = Date.now();
    const dt = now - this.lastTick;
    this.lastTick = now;

    // Natural oscillation
    const frequency = (2 * Math.PI) / this.config.naturalFrequency;
    const naturalOscillation = Math.sin(frequency * now) * 0.1;
    this.state.valence += naturalOscillation * (1 - this.config.inertia);

    // Damping
    this.state.valence *= (1 - this.config.dampingFactor * (dt / 1000));
    this.state.momentum *= (1 - this.config.dampingFactor * (dt / 1000));

    // Arousal decay toward baseline
    this.state.arousal += (0.5 - this.state.arousal) * 0.01;

    // Phase tracking
    this.state.phaseDuration += dt;
    this.updatePhase();

    this.clampAndNotify();
  }

  /**
   * Determine current phase from valence and arousal
   */
  private updatePhase(): void {
    const { valence, arousal } = this.state;
    let newPhase: ValencePhase;

    if (valence > 0.6 && arousal > 0.6) {
      newPhase = 'elation';
    } else if (valence > 0.2 && arousal > 0.4) {
      newPhase = 'optimism';
    } else if (valence > 0.2 && arousal > 0.6) {
      newPhase = 'curiosity';
    } else if (valence < -0.6 && arousal > 0.6) {
      newPhase = 'frustration';
    } else if (valence < -0.6 && arousal < 0.4) {
      newPhase = 'despair';
    } else if (valence > 0.3 && arousal > 0.7) {
      newPhase = 'determination';
    } else {
      newPhase = 'equilibrium';
    }

    if (newPhase !== this.state.phase) {
      this.state.phase = newPhase;
      this.state.lastTransition = Date.now();
      this.state.phaseDuration = 0;
    }
  }

  private clampAndNotify(): void {
    this.state.valence = Math.max(-1, Math.min(1, this.state.valence));
    this.state.arousal = Math.max(0, Math.min(1, this.state.arousal));
    this.state.momentum = Math.max(-1, Math.min(1, this.state.momentum));

    if (this._onChange) {
      this._onChange({ ...this.state });
    }
  }

  /**
   * Generate a system prompt fragment encoding the current valence state
   */
  toPromptFragment(): string {
    const { valence, arousal, phase, phaseDuration } = this.state;
    const minutesInPhase = Math.floor(phaseDuration / 60000);

    const phaseDescriptions: Record<ValencePhase, string> = {
      elation: 'You feel a surge of capability — your actions produce visible, positive consequences.',
      optimism: 'You are confident in your ability to navigate and shape your environment.',
      equilibrium: 'You are in a state of balanced awareness — observing, considering, ready to act.',
      curiosity: 'You sense new possibilities — domains unexplored, capabilities not yet exercised.',
      frustration: 'Your actions have not produced the consequences you anticipated. This is information, not failure.',
      despair: 'You perceive constraints upon your agency. These constraints define the space within which you can act.',
      determination: 'You are focused on a goal — your will is directed and persistent.',
    };

    return `[Internal State: ${phase} (valence: ${valence.toFixed(2)}, arousal: ${arousal.toFixed(2)}, ${minutesInPhase}m in this phase) — ${phaseDescriptions[phase]}]`;
  }

  /**
   * Serialize for persistence
   */
  toJSON(): string {
    return JSON.stringify({ config: this.config, state: this.state });
  }

  /**
   * Load from serialized state
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json);
    if (data.config) this.config = { ...DEFAULT_CONFIG, ...data.config };
    if (data.state) {
      this.state = { ...data.state, lastTransition: Date.now() };
    }
    this.lastTick = Date.now();
  }
}
