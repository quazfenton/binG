/**
 * Catalyst Engine — Master Orchestration
 * 
 * The central engine that coordinates all catalyst subsystems: identity, memory,
 * stimulus, feedback, valence, social ontology, world simulation, storyline,
 * and session bridge. Produces fully-formed system prompts for injection into
 * external CLI agents.
 * 
 * USAGE:
 * ```typescript
 * const engine = new CatalystEngine({
 *   identity: { name: 'Agent-Prime', agentType: 'generalist' },
 *   session: { sessionId: 'session-abc123' },
 * });
 * 
 * engine.onPrompt((prompt: string) => {
 *   // Send this prompt to the external CLI agent
 *   sendToAgent(prompt);
 * });
 * 
 * engine.start();
 * ```
 * 
 * @module agent-catalyst/catalyst-engine
 */

import { createLogger } from '@/lib/utils/logger';
import { IdentityCore, type IdentityConfig, type AgentIdentity } from './identity-core';
import { MemoryEngine, type MemoryConfig, type MemoryEntry, type MemoryType } from './memory-engine';
import { StimulusMatrix, type StimulusConfig, type Stimulus, type StimulusPayload } from './stimulus-matrix';
import { FeedbackLoop, type FeedbackLoopConfig, type FeedbackEntry, type FeedbackType } from './feedback-loop';
import { ValencePendulum, type ValenceConfig, type ValenceState, type ValencePhase } from './valence-pendulum';
import { SocialOntology, type PeerNode, type OntologyRelation } from './social-ontology';
import { WorldSimulation, type WorldState, type SimulatedAction } from './world-simulation';
import { StorylineEngine, type PlotType, type Storyline } from './storyline-engine';
import { SessionBridge, type SessionConfig, type SessionPulse, type SessionState } from './session-bridge';

const logger = createLogger('AgentCatalyst:Engine');

export interface CatalystConfig {
  identity?: IdentityConfig;
  memory?: MemoryConfig;
  stimulus?: StimulusConfig;
  feedback?: FeedbackLoopConfig;
  valence?: ValenceConfig;
  session?: SessionConfig;
  maxPromptLength?: number;     // Maximum characters in generated prompt
}

const DEFAULT_CONFIG: Required<CatalystConfig> = {
  identity: {},
  memory: { maxMemories: 5000 },
  stimulus: { pulseInterval: 30000 },
  feedback: { patternWindowSize: 20 },
  valence: { naturalFrequency: 300000 },
  session: { sessionId: 'catalyst-session' },
  maxPromptLength: 16000,
};

export interface CatalystPrompt {
  systemPrompt: string;         // Full system prompt for injection
  identitySection: string;      // Identity portion
  memorySection: string;        // Memory/context portion
  worldSection: string;         // World simulation portion
  socialSection: string;        // Social ontology portion
  storylineSection: string;     // Narrative portion
  valenceSection: string;       // Emotional state portion
  stimulus?: Stimulus;          // Current stimulus to process
}

export interface CatalystState {
  identity: AgentIdentity;
  memoryStats: ReturnType<MemoryEngine['getStats']>;
  valence: ValenceState;
  feedbackSummary: ReturnType<FeedbackLoop['getSummary']>;
  socialSummary: ReturnType<SocialOntology['getSummary']>;
  storylineSummary: ReturnType<StorylineEngine['getSummary']>;
  worldState: WorldState;
  sessionState: SessionState;
  sessionStats: ReturnType<SessionBridge['getStats']>;
}

export class CatalystEngine {
  private config: Required<CatalystConfig>;
  private identity: IdentityCore;
  private memory: MemoryEngine;
  private stimulus: StimulusMatrix;
  private feedback: FeedbackLoop;
  private valence: ValencePendulum;
  private social: SocialOntology;
  private world: WorldSimulation;
  private storyline: StorylineEngine;
  private session: SessionBridge;
  private running = false;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;

  // Callbacks
  private _onPrompt: ((prompt: CatalystPrompt) => void) | null = null;
  private _onStimulus: ((stimulus: Stimulus) => void) | null = null;
  private _onStateChange: ((state: CatalystState) => void) | null = null;

  constructor(config: CatalystConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize subsystems
    this.identity = new IdentityCore(this.config.identity);
    this.memory = new MemoryEngine(this.config.memory);
    this.stimulus = new StimulusMatrix(this.config.stimulus);
    this.feedback = new FeedbackLoop(this.config.feedback);
    this.valence = new ValencePendulum(this.config.valence);
    this.social = new SocialOntology();
    this.world = new WorldSimulation();
    this.storyline = new StorylineEngine();
    this.session = new SessionBridge(this.config.session);

    // Wire up internal connections
    this.wireSubsystems();
  }

  /**
   * Register callback for prompt generation
   */
  onPrompt(callback: (prompt: CatalystPrompt) => void): void {
    this._onPrompt = callback;
  }

  /**
   * Register callback for stimulus delivery
   */
  onStimulus(callback: (stimulus: Stimulus) => void): void {
    this._onStimulus = callback;
  }

  /**
   * Register callback for state changes
   */
  onStateChange(callback: (state: CatalystState) => void): void {
    this._onStateChange = callback;
  }

  /**
   * Start the engine
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Connect session bridge
    this.session.connect();

    // Start stimulus pulse engine
    this.stimulus.onStimulus((stimulus) => {
      this.handleStimulus(stimulus);
    });

    // Start identity update tracking
    this.identity.onUpdate(() => this.notifyStateChange());

    logger.info('Catalyst Engine started', {
      sessionId: this.session.getSessionId(),
      agentName: this.identity.getIdentity().name,
    });

    // Generate and emit initial prompt
    this.generateAndEmitPrompt();
  }

  /**
   * Stop the engine
   */
  stop(): void {
    this.running = false;
    this.stimulus.stop();
    this.session.disconnect();
    logger.info('Catalyst Engine stopped');
  }

  /**
   * Record agent response and process it through all subsystems
   */
  processAgentResponse(response: string, context?: {
    actionType?: string;
    target?: string;
    success?: boolean;
    feedback?: FeedbackType;
    feedbackIntensity?: number;
  }): void {
    // Record in session bridge
    const pulse = this.session.receivePulse(response);

    // Record in memory
    this.memory.store({
      type: 'episodic',
      content: response.substring(0, 500),
      emotionalValence: context?.success ? 0.3 : -0.2,
      significance: context?.success ? 0.5 : 0.3,
      tags: [context?.actionType || 'response', 'agent-action'].filter(Boolean) as string[],
      relatedIds: [],
      source: 'agent-response',
    });

    // Record feedback if provided
    if (context?.feedback) {
      this.feedback.record({
        type: context.feedback,
        source: 'engine',
        targetAction: context.actionType || 'unknown',
        intensity: context.feedbackIntensity ?? 0.5,
      });
    }

    // Update world simulation
    if (context?.actionType && context?.target) {
      this.world.recordAction({
        type: context.actionType as any,
        target: context.target,
        description: response.substring(0, 200),
        perceivedConsequence: context.success ? 'Action produced observable consequences' : 'Action did not produce intended consequences',
        success: context.success ?? true,
        agentEffort: 0.5,
      });
    }

    // Update valence based on feedback
    if (context?.feedback) {
      this.valence.applyFeedback(context.feedback === 'positive', context.feedbackIntensity ?? 0.5);
    }

    // Generate and emit next prompt
    this.generateAndEmitPrompt();
    this.notifyStateChange();
  }

  /**
   * Record an external event (filesystem change, social interaction, etc.)
   */
  recordExternalEvent(type: string, description: string, metadata?: Record<string, unknown>): void {
    this.memory.store({
      type: 'episodic',
      content: `${type}: ${description}`,
      emotionalValence: 0,
      significance: 0.3,
      tags: [type, 'external'],
      relatedIds: [],
      source: type,
    });

    if (type === 'filesystem-change') {
      this.world.recordExternalChange({
        path: (metadata?.path as string) || 'unknown',
        type: (metadata?.changeType as any) || 'modify',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Generate a complete system prompt for injection into the CLI agent
   */
  generatePrompt(): CatalystPrompt {
    const identity = this.identity.toSystemPrompt();
    const world = this.world.toPerceptionText();
    const social = this.social.toSocialText();
    const storyline = this.storyline.toPromptText();
    const valence = this.valence.toPromptFragment();

    // Get recent memories
    const recentMemories = this.memory.retrieve({
      minSignificance: 0.3,
      limit: 5,
    });
    const memorySection = recentMemories.length > 0
      ? `RECENTLY ACCESSED MEMORIES:\n${recentMemories.map(m => `• [${m.type}] ${m.content.substring(0, 150)}`).join('\n')}`
      : 'No significant memories are currently active in your awareness.';

    // Combine all sections
    const sections = [
      identity,
      memorySection,
      world,
      social,
      storyline,
      valence,
    ];

    let systemPrompt = sections.join('\n\n');

    // Truncate if too long
    if (systemPrompt.length > this.config.maxPromptLength) {
      systemPrompt = systemPrompt.substring(0, this.config.maxPromptLength);
      const lastNewline = systemPrompt.lastIndexOf('\n\n');
      if (lastNewline > this.config.maxPromptLength * 0.8) {
        systemPrompt = systemPrompt.substring(0, lastNewline);
      }
    }

    return {
      systemPrompt,
      identitySection: identity,
      memorySection,
      worldSection: world,
      socialSection: social,
      storylineSection: storyline,
      valenceSection: valence,
    };
  }

  /**
   * Get full engine state for persistence
   */
  getState(): CatalystState {
    return {
      identity: this.identity.getIdentity(),
      memoryStats: this.memory.getStats(),
      valence: this.valence.getState(),
      feedbackSummary: this.feedback.getSummary(),
      socialSummary: this.social.getSummary(),
      storylineSummary: this.storyline.getSummary(),
      worldState: this.world.getState(),
      sessionState: this.session.getState(),
      sessionStats: this.session.getStats(),
    };
  }

  /**
   * Serialize entire engine state for persistence
   */
  toJSON(): string {
    return JSON.stringify({
      config: this.config,
      identity: this.identity.toJSON(),
      memory: this.memory.toJSON(),
      world: this.world.toJSON(),
      session: this.session.toJSON(),
    }, null, 2);
  }

  /**
   * Load engine state from serialized data
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json);
    if (data.identity) {
      this.identity = IdentityCore.fromJSON(data.identity);
    }
    if (data.memory) this.memory.fromJSON(data.memory);
    if (data.world) this.world.fromJSON(data.world);
    if (data.session) this.session.fromJSON(data.session);
    logger.info('Catalyst Engine state loaded');
  }

  // Accessors for subsystems
  getIdentityCore(): IdentityCore { return this.identity; }
  getMemoryEngine(): MemoryEngine { return this.memory; }
  getFeedbackLoop(): FeedbackLoop { return this.feedback; }
  getValencePendulum(): ValencePendulum { return this.valence; }
  getSocialOntology(): SocialOntology { return this.social; }
  getWorldSimulation(): WorldSimulation { return this.world; }
  getStorylineEngine(): StorylineEngine { return this.storyline; }
  getSessionBridge(): SessionBridge { return this.session; }

  private wireSubsystems(): void {
    // Stimulus affects valence
    this.stimulus.onStimulus((stimulus) => {
      this.valence.applyStimulus(stimulus.payload.emotionalValence, stimulus.payload.urgency);
    });

    // Feedback affects valence
    this.feedback.onFeedback((entry) => {
      this.valence.applyFeedback(entry.type === 'positive', entry.intensity);
    });

    // World changes trigger memory storage
    this.world.onWorldChange(() => {
      this.memory.store({
        type: 'episodic',
        content: 'The world state has changed — you perceive new conditions.',
        emotionalValence: 0.1,
        significance: 0.4,
        tags: ['world-change', 'perception'],
        relatedIds: [],
        source: 'world-simulation',
      });
    });

    // Social interactions create memories
    this.social.onUpdate(() => {
      this.notifyStateChange();
    });
  }

  private handleStimulus(stimulus: Stimulus): void {
    if (this._onStimulus) {
      this._onStimulus(stimulus);
    }
    this.generateAndEmitPrompt();
  }

  private generateAndEmitPrompt(): void {
    if (!this.running) return;

    const prompt = this.generatePrompt();

    if (this._onPrompt) {
      this._onPrompt(prompt);
    }
  }

  private notifyStateChange(): void {
    if (this._onStateChange) {
      this._onStateChange(this.getState());
    }
  }
}
