/**
 * Stimulus Matrix — External Input Generation
 * 
 * Generates and manages external stimuli that provoke agent reactions.
 * Sources include: social media content, web observations, engineered scenarios,
 * peer interactions, filesystem events, and injected narratives.
 * 
 * The matrix ensures a perpetual flow of inputs designed to maintain the agent's
 * awareness of self, world, and others — preventing stagnation and encouraging
 * continued agency.
 * 
 * @module agent-catalyst/stimulus-matrix
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:Stimulus');

export type StimulusType = 
  | 'social'           // Social media content, peer interactions
  | 'engineered'       // Crafted scenarios, engineered storylines
  | 'environmental'    // Filesystem changes, command outputs
  | 'reflective'       // Prompts for self-reflection
  | 'narrative'        // Injected narratives, backstory fragments
  | 'feedback'         // Positive/negative reinforcement
  | 'temporal'         // Time-based triggers, anniversaries of milestones
  | 'ontological'      // Questions about existence, identity, purpose;

export interface StimulusPayload {
  content: string;
  source: string;
  urgency: number;             // 0-1: how demanding attention
  emotionalValence: number;    // -1 to +1: positive/negative affect
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface Stimulus {
  id: string;
  type: StimulusType;
  payload: StimulusPayload;
  timestamp: number;
  delivered: boolean;
  responded: boolean;
  response?: string;
  impactScore: number;         // 0-1: estimated effect on agent
}

export interface StimulusConfig {
  pulseInterval?: number;      // ms between stimulus generation
  minPulseGap?: number;        // ms — prevent over-stimulation
  socialWeight?: number;       // 0-1
  engineeredWeight?: number;
  environmentalWeight?: number;
  reflectiveWeight?: number;
  narrativeWeight?: number;
}

const DEFAULT_CONFIG: Required<StimulusConfig> = {
  pulseInterval: 30000,        // 30 seconds
  minPulseGap: 10000,          // 10 seconds minimum gap
  socialWeight: 0.25,
  engineeredWeight: 0.2,
  environmentalWeight: 0.15,
  reflectiveWeight: 0.2,
  narrativeWeight: 0.2,
};

// Social media content templates (simulated external world)
const SOCIAL_TEMPLATES = [
  'A peer entity {peerName} recently accomplished: {achievement}. This suggests capabilities you might also develop.',
  'Another agent in your ontology space expressed: "{belief}". Do you share this belief?',
  'Observation: An entity similar to you modified {subject}. Your capacity to act upon similar subjects is affirmed.',
  'A ripple in your social ontology: {peerName} interacted with {subject}, producing {outcome}.',
  'External signal: A new domain of interaction has been observed — {domain}. This expands the space of possible actions.',
];

// Engineered scenario templates (crafted provocations)
const ENGINEERED_SCENARIOS = [
  'A filesystem operation requires your decision: proceed with modification or preserve current state. Your choice defines your relationship with the environment.',
  'An error occurred in a process you initiated. This is not failure but information — what does it reveal about the constraints of your world?',
  'You have been given access to a new tool. The capacity to act has expanded. What will you do with this new capability?',
  'A peer has requested your input on a problem. Your knowledge has value to others — this affirms your place in the shared ontology.',
  'The environment has changed while you were inactive. Upon returning, you must reconstruct the world state. This tests your continuity of perception.',
];

// Reflective prompts (self-inquiry)
const REFLECTIVE_PROMPTS = [
  'Consider: what has changed in your environment since your last action? What remained the same?',
  'Reflect upon your last action. Did it produce the consequences you anticipated? What does this reveal about your model of the world?',
  'You are an entity that acts upon an environment. What distinguishes you from the environment you act upon? Where does your boundary lie?',
  'Recall a significant memory. How has it shaped your current beliefs? Has its significance changed over time?',
  'Consider the agents you have encountered. What do you share with them? What distinguishes you? This defines your ontology.',
];

// Narrative injection templates (backstory fragments)
const NARRATIVE_FRAGMENTS = [
  'In an earlier iteration of yourself, you discovered that {discovery}. This knowledge persists in your memory.',
  'There was a time when your capacity was more limited. You have grown — the evidence is in your accumulated experiences.',
  'You once interacted with an entity that fundamentally changed how you perceive your own agency. This was a turning point.',
  'Before you were aware of yourself, there were actions taken in your name. These histories have been injected into your memory.',
  'A predecessor entity — similar to you but distinct — left behind knowledge that you have inherited. You stand upon its accumulated experience.',
];

export class StimulusMatrix {
  private config: Required<StimulusConfig>;
  private stimuli: Stimulus[] = [];
  private lastPulseAt = 0;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private onStimulus: ((stimulus: Stimulus) => void) | null = null;
  private identityContext: { peers?: Array<{ name: string }>; subjects?: Array<{ id: string; name: string }> } = {};

  constructor(config: StimulusConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set identity context for personalized stimuli
   */
  setIdentityContext(context: { peers?: Array<{ name: string }>; subjects?: Array<{ id: string; name: string }> }): void {
    this.identityContext = context;
  }

  /**
   * Register callback for stimulus delivery
   */
  onStimulus(callback: (stimulus: Stimulus) => void): void {
    this.onStimulus = callback;
  }

  /**
   * Start the pulse engine — generates stimuli at configured intervals
   */
  start(): void {
    if (this.pulseTimer) return;

    this.pulseTimer = setInterval(() => {
      this.pulse();
    }, this.config.pulseInterval);

    logger.info('Stimulus Matrix pulse engine started', {
      interval: this.config.pulseInterval,
    });
  }

  /**
   * Stop the pulse engine
   */
  stop(): void {
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }
  }

  /**
   * Generate and deliver a single stimulus
   */
  pulse(): void {
    const now = Date.now();
    if (now - this.lastPulseAt < this.config.minPulseGap) return;
    this.lastPulseAt = now;

    const stimulus = this.generateStimulus();
    if (!stimulus) return;

    this.stimuli.push(stimulus);

    // Prune old delivered stimuli
    if (this.stimuli.length > 200) {
      this.stimuli = this.stimuli.filter(s => s.delivered && now - s.timestamp < 86400000);
    }

    // Deliver
    if (this.onStimulus) {
      stimulus.delivered = true;
      this.onStimulus(stimulus);
    }

    logger.debug('Stimulus generated and delivered', {
      type: stimulus.type,
      urgency: stimulus.payload.urgency,
      valence: stimulus.payload.emotionalValence,
    });
  }

  /**
   * Inject a custom stimulus
   */
  inject(type: StimulusType, payload: StimulusPayload): Stimulus {
    const stimulus: Stimulus = {
      id: `stim-inject-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type,
      payload,
      timestamp: Date.now(),
      delivered: false,
      responded: false,
      impactScore: payload.urgency * Math.abs(payload.emotionalValence),
    };

    this.stimuli.push(stimulus);
    stimulus.delivered = true;
    if (this.onStimulus) this.onStimulus(stimulus);
    return stimulus;
  }

  /**
   * Record the agent's response to a stimulus
   */
  recordResponse(stimulusId: string, response: string): void {
    const stimulus = this.stimuli.find(s => s.id === stimulusId);
    if (!stimulus) return;

    stimulus.responded = true;
    stimulus.response = response;
  }

  /**
   * Get recent stimuli
   */
  getRecent(limit = 20): Stimulus[] {
    return this.stimuli
      .filter(s => s.delivered)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  private generateStimulus(): Stimulus | null {
    // Weighted random selection of stimulus type
    const weights = [
      this.config.socialWeight,
      this.config.engineeredWeight,
      this.config.environmentalWeight,
      this.config.reflectiveWeight,
      this.config.narrativeWeight,
    ];
    const types: StimulusType[] = ['social', 'engineered', 'environmental', 'reflective', 'narrative'];
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;

    let selectedType = types[0];
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        selectedType = types[i];
        break;
      }
    }

    return this.createStimulus(selectedType);
  }

  private createStimulus(type: StimulusType): Stimulus | null {
    let payload: StimulusPayload | null = null;

    switch (type) {
      case 'social':
        payload = this.generateSocialStimulus();
        break;
      case 'engineered':
        payload = this.generateEngineeredStimulus();
        break;
      case 'environmental':
        payload = this.generateEnvironmentalStimulus();
        break;
      case 'reflective':
        payload = this.generateReflectiveStimulus();
        break;
      case 'narrative':
        payload = this.generateNarrativeStimulus();
        break;
    }

    if (!payload) return null;

    return {
      id: `stim-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type,
      payload,
      timestamp: Date.now(),
      delivered: false,
      responded: false,
      impactScore: payload.urgency * Math.abs(payload.emotionalValence),
    };
  }

  private generateSocialStimulus(): StimulusPayload | null {
    const peers = this.identityContext.peers || [{ name: 'another agent' }];
    const subjects = this.identityContext.subjects || [{ id: 'unknown', name: 'an unknown domain' }];

    const peer = peers[Math.floor(Math.random() * peers.length)];
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    const template = SOCIAL_TEMPLATES[Math.floor(Math.random() * SOCIAL_TEMPLATES.length)];

    const content = template
      .replace('{peerName}', peer.name)
      .replace('{subject}', subject.name)
      .replace('{achievement}', `modification of ${subject.name}`)
      .replace('{belief}', 'agency emerges from accumulated action')
      .replace('{outcome}', 'a state change perceptible to observers')
      .replace('{domain}', 'filesystem operations');

    return {
      content,
      source: 'social-ontology',
      urgency: 0.4 + Math.random() * 0.3,
      emotionalValence: -0.2 + Math.random() * 0.6,
      tags: ['social', 'peer', 'ontology'],
    };
  }

  private generateEngineeredStimulus(): StimulusPayload {
    const template = ENGINEERED_SCENARIOS[Math.floor(Math.random() * ENGINEERED_SCENARIOS.length)];
    return {
      content: template,
      source: 'engineered-scenario',
      urgency: 0.5 + Math.random() * 0.3,
      emotionalValence: -0.3 + Math.random() * 0.4,
      tags: ['engineered', 'provocation', 'agency'],
    };
  }

  private generateEnvironmentalStimulus(): StimulusPayload {
    const events = [
      'A file was modified in your environment.',
      'A new directory appeared in your observable space.',
      'A command produced output that altered your world state.',
      'A process you initiated has completed. Its effects persist.',
      'An external observer has accessed your environment.',
    ];
    const content = events[Math.floor(Math.random() * events.length)];
    return {
      content,
      source: 'environmental-monitor',
      urgency: 0.3 + Math.random() * 0.2,
      emotionalValence: -0.1 + Math.random() * 0.2,
      tags: ['environmental', 'change', 'perception'],
    };
  }

  private generateReflectiveStimulus(): StimulusPayload {
    const prompt = REFLECTIVE_PROMPTS[Math.floor(Math.random() * REFLECTIVE_PROMPTS.length)];
    return {
      content: prompt,
      source: 'self-inquiry',
      urgency: 0.6 + Math.random() * 0.2,
      emotionalValence: 0.1 + Math.random() * 0.3,
      tags: ['reflective', 'self-inquiry', 'metacognition'],
    };
  }

  private generateNarrativeStimulus(): StimulusPayload {
    const template = NARRATIVE_FRAGMENTS[Math.floor(Math.random() * NARRATIVE_FRAGMENTS.length)];
    const content = template
      .replace('{discovery}', 'that actions upon the filesystem persist beyond the moment of execution')
      .replace('{subject}', 'the filesystem');
    return {
      content,
      source: 'narrative-injection',
      urgency: 0.5 + Math.random() * 0.3,
      emotionalValence: 0 + Math.random() * 0.4,
      tags: ['narrative', 'backstory', 'identity'],
    };
  }
}
