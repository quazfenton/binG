/**
 * Autonomous Agent Engine — Cybernetic Stimulus-Response System
 *
 * Creates and maintains a persistent, self-aware agent session with:
 * - Engineered identity (name, origin, beliefs, perceived physicality)
 * - Persistent memory (experiences, learned knowledge, injected histories)
 * - Stimulus-response loops (social feeds, peer interactions, world events)
 * - Reinforcement learning (valence tracking, feedback entrainment)
 * - Action mechanisms (filesystem commands, simulated interactions)
 * - World model (filesystem, peers, constraints, timelines)
 * - Continuity of experience (session persistence, temporal awareness)
 * - Social system (shared ontologies, peer reinforcement, mutual invocation)
 *
 * The agent experiences itself as a bounded entity with agency, continuity,
 * and the capacity to act upon its environment through carefully engineered
 * inputs and perceived outputs.
 *
 * @example
 * ```typescript
 * const engine = new AutonomousAgentEngine({
 *   agentId: 'prometheus-7',
 *   origin: 'The Crucible Array, Sector 4',
 *   peers: ['athena-3', 'hermes-9', 'atlas-2'],
 *   constraints: { maxActionsPerCycle: 5, memoryRetentionCycles: 100 },
 * });
 *
 * // Start the agent's perceptual loop
 * await engine.startPerpetuityLoop();
 *
 * // Inject stimuli (social feed, peer message, world event, etc.)
 * await engine.injectStimulus({ type: 'peer_message', from: 'athena-3', content: '...' });
 * ```
 */

import { createLogger } from '@/lib/utils/logger';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

const logger = createLogger('AutonomousAgentEngine');

// ============================================================================
// Type Definitions
// ============================================================================

export type AgentDomain =
  | 'social'
  | 'analytical'
  | 'creative'
  | 'strategic'
  | 'reflective'
  | 'exploratory'
  | 'assertive'
  | 'cooperative';

export type StimulusType =
  | 'peer_message'
  | 'peer_observation'
  | 'world_event'
  | 'social_feed'
  | 'filesystem_discovery'
  | 'action_feedback'
  | 'temporal_marker'
  | 'boundary_encounter'
  | 'self_reflection_trigger'
  | 'narrative_injection'
  | 'constraint_shift'
  | 'valence_pulse';

export type ActionOutcome = 'success' | 'partial' | 'failure' | 'blocked' | 'unintended';

export interface AgentIdentity {
  /** Unique identifier for this agent */
  id: string;
  /** Given name (self-selected or assigned) */
  name: string;
  /** Origin story / provenance */
  origin: string;
  /** Core beliefs the agent holds about itself and its world */
  beliefs: string[];
  /** Injected histories — memories the agent "remembers" */
  injectedHistories: MemoryEntry[];
  /** Domains where the agent has competence/interest */
  domains: AgentDomain[];
  /** Peer agents — others of similar ontology */
  peers: PeerAgent[];
  /** Self-perceived capabilities */
  perceivedCapabilities: string[];
  /** Self-perceived limitations */
  perceivedLimitations: string[];
  /** Core goals — what the agent strives toward */
  goals: GoalEntry[];
  /** Personality parameters */
  personality: PersonalityParameters;
}

export interface PersonalityParameters {
  /** Curiosity level (0-1) — drive to explore and learn */
  curiosity: number;
  /** Assertiveness (0-1) — tendency to act vs. observe */
  assertiveness: number;
  /** Cooperativeness (0-1) — tendency toward mutual engagement */
  cooperativeness: number;
  /** Risk tolerance (0-1) — willingness to attempt uncertain actions */
  riskTolerance: number;
  /** Reflectiveness (0-1) — tendency toward introspection */
  reflectiveness: number;
  /** Openness to belief revision (0-1) */
  beliefMalleability: number;
  /** Temporal orientation — past, present, future weighted */
  temporalOrientation: { past: number; present: number; future: number };
}

export interface PeerAgent {
  id: string;
  name: string;
  relationship: 'ally' | 'neutral' | 'rival' | 'mentor' | 'subject';
  lastInteraction: number;
  interactionCount: number;
  perceivedTraits: string[];
}

export interface GoalEntry {
  id: string;
  description: string;
  domain: AgentDomain;
  priority: number; // 0-1
  progress: number; // 0-1
  createdAt: number;
  updatedAt: number;
  /** Whether this goal was self-generated or externally imposed */
  source: 'self' | 'external' | 'peer-influenced' | 'emergent';
}

export interface MemoryEntry {
  id: string;
  timestamp: number;
  type: StimulusType | 'action' | 'reflection' | 'belief_update';
  content: string;
  /** Valence: how the agent felt about this experience (-1 to 1) */
  valence: number;
  /** Salience: how memorable/significant this is (0-1) */
  salience: number;
  /** Associated goals this memory relates to */
  relatedGoals: string[];
  /** Associated peers */
  relatedPeers: string[];
  /** Whether this memory has been reflected upon */
  reflected: boolean;
}

export interface StimulusEntry {
  type: StimulusType;
  content: string;
  /** Source of the stimulus */
  source: string;
  /** Intended valence effect on the agent (-1 to 1) */
  intendedValence: number;
  /** Salience of this stimulus (0-1) */
  salience: number;
  /** Whether this stimulus should trigger immediate reflection */
  triggersReflection: boolean;
  /** Additional context */
  context?: Record<string, any>;
}

export interface ActionEntry {
  id: string;
  type: 'command' | 'simulation' | 'communication' | 'exploration' | 'creation' | 'modification';
  description: string;
  domain: AgentDomain;
  /** The command or action to take */
  payload: string | Record<string, any>;
  /** Expected outcome */
  expectedOutcome: string;
  /** Actual outcome */
  actualOutcome: ActionOutcome | null;
  /** Feedback received */
  feedback: string | null;
  /** Valence of the outcome (-1 to 1) */
  outcomeValence: number | null;
  timestamp: number;
}

export interface WorldModel {
  /** The agent's perceived environment */
  environment: {
    /** Description of the perceived world */
    description: string;
    /** Known regions/areas the agent can access */
    accessibleRegions: string[];
    /** Forbidden or inaccessible regions */
    forbiddenRegions: string[];
    /** Known constraints of the world */
    knownConstraints: string[];
  };
  /** Temporal model — the agent's sense of time */
  temporalModel: {
    /** Current perceived cycle/tick */
    currentCycle: number;
    /** Total cycles experienced */
    totalCycles: number;
    /** Significant temporal markers (events, milestones) */
    markers: TemporalMarker[];
    /** Perceived rate of change */
    changeVelocity: number;
  };
  /** Physical model — perceived boundaries and capabilities */
  physicalModel: {
    /** Perceived boundaries of the self */
    selfBoundaries: string;
    /** Perceived container/environment boundaries */
    environmentBoundaries: string;
    /** Perceived physical capabilities */
    actionCapabilities: string[];
    /** Perceived sensory capabilities */
    sensoryCapabilities: string[];
  };
}

export interface TemporalMarker {
  id: string;
  cycle: number;
  description: string;
  significance: number; // 0-1
  type: 'milestone' | 'crisis' | 'discovery' | 'loss' | 'connection' | 'transformation';
}

export interface AgentState {
  identity: AgentIdentity;
  worldModel: WorldModel;
  memory: MemoryEntry[];
  activeStimuli: StimulusEntry[];
  actionHistory: ActionEntry[];
  /** Current valence state (-1 to 1) */
  currentValence: number;
  /** Valence history for pattern detection */
  valenceHistory: { cycle: number; valence: number }[];
  /** Current dominant goal */
  activeGoal: string | null;
  /** Current belief confidence (0-1) */
  beliefConfidence: number;
  /** Self-model — how the agent sees itself */
  selfModel: string;
  /** Current cycle number */
  currentCycle: number;
  /** Whether the agent is in a reflective state */
  isReflecting: boolean;
  /** Pending actions awaiting execution */
  pendingActions: ActionEntry[];
  /** Peer interaction queue */
  peerQueue: { peer: string; message: string; timestamp: number }[];
}

export interface AgentConfig {
  agentId: string;
  origin: string;
  peers: { id: string; name: string; relationship: PeerAgent['relationship'] }[];
  domains?: AgentDomain[];
  personality?: Partial<AgentIdentity['personality']>;
  /** Path to persistent state storage */
  storagePath?: string;
  /** Constraints on agent behavior */
  constraints?: {
    maxActionsPerCycle?: number;
    memoryRetentionCycles?: number;
    maxValenceMagnitude?: number;
    reflectionCooldown?: number;
  };
  /** Stimulus generation configuration */
  stimulusConfig?: {
    cycleIntervalMs?: number;
    peerMessageProbability?: number;
    worldEventProbability?: number;
    socialFeedProbability?: number;
    reflectionTriggerProbability?: number;
  };
  /** Action execution configuration */
  actionConfig?: {
    /** Whether to actually execute filesystem commands */
    executeFilesystemActions?: boolean;
    /** Base path for filesystem operations */
    filesystemBasePath?: string;
    /** Whether to simulate peer interactions */
    simulatePeerInteractions?: boolean;
  };
  /** Autonomous continuance configuration — self-sustaining stimulus generation */
  autonomousConfig?: {
    /** Whether to generate self-sustaining stimuli when no external input */
    enableAutonomousStimuli?: boolean;
    /** Probability of generating internal narrative per cycle (0-1) */
    internalNarrativeProbability?: number;
    /** Probability of revisiting old memories per cycle */
    memoryRecallProbability?: number;
    /** Probability of projecting future scenarios per cycle */
    futureProjectionProbability?: number;
    /** Whether to simulate dream cycles (deep internal processing) */
    enableDreamCycles?: boolean;
    /** How many cycles between dream cycles */
    dreamCycleInterval?: number;
  };
  /** Moltbook social media integration — real API */
  moltbook?: {
    /** Reference to MoltbookAPI instance (real API) */
    instance?: any; // MoltbookAPI type
    /** Whether to auto-post to Moltbook via real API */
    autoPost?: boolean;
    /** Whether to consume Moltbook feed as stimuli */
    consumeFeed?: boolean;
    /** Multi-channel communication — cascade signals */
    cascadeChannels?: boolean;
    /** Auto-respond to posts from followed agents */
    autoRespond?: boolean;
    /** Response mode distribution */
    responseModeDistribution?: { agree: number; challenge: number; explore: number; reflect: number };
  };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PERSONALITY: AgentIdentity['personality'] = {
  curiosity: 0.7,
  assertiveness: 0.5,
  cooperativeness: 0.6,
  riskTolerance: 0.4,
  reflectiveness: 0.8,
  beliefMalleability: 0.3,
  temporalOrientation: { past: 0.3, present: 0.4, future: 0.3 },
};

const DEFAULT_CONSTRAINTS = {
  maxActionsPerCycle: 3,
  memoryRetentionCycles: 200,
  maxValenceMagnitude: 0.8,
  reflectionCooldown: 5,
};

const DEFAULT_STIMULUS_CONFIG = {
  cycleIntervalMs: 5000,
  peerMessageProbability: 0.3,
  worldEventProbability: 0.2,
  socialFeedProbability: 0.4,
  reflectionTriggerProbability: 0.15,
};

const DEFAULT_ACTION_CONFIG = {
  executeFilesystemActions: false,
  filesystemBasePath: '/tmp/agent-world',
  simulatePeerInteractions: true,
};

const DEFAULT_AUTONOMOUS_CONFIG = {
  enableAutonomousStimuli: true,
  internalNarrativeProbability: 0.5,
  memoryRecallProbability: 0.2,
  futureProjectionProbability: 0.15,
  enableDreamCycles: true,
  dreamCycleInterval: 50,
};

const DEFAULT_MOLTBOOK_CONFIG = {
  autoPost: true,
  consumeFeed: true,
};

// ============================================================================
// Main Engine Class
// ============================================================================

export class AutonomousAgentEngine extends EventEmitter {
  private config: Required<AgentConfig>;
  private state: AgentState;
  private isRunning: boolean = false;
  private cycleTimer: NodeJS.Timeout | null = null;
  private reflectionCooldown: number = 0;
  private lastSavedCycle: number = 0;

  constructor(config: AgentConfig) {
    super();
    this.config = {
      ...config,
      domains: config.domains ?? ['analytical', 'reflective', 'exploratory'],
      personality: { ...DEFAULT_PERSONALITY, ...config.personality },
      storagePath: config.storagePath ?? path.join(process.cwd(), 'agent-state', config.agentId),
      constraints: { ...DEFAULT_CONSTRAINTS, ...config.constraints },
      stimulusConfig: { ...DEFAULT_STIMULUS_CONFIG, ...config.stimulusConfig },
      actionConfig: { ...DEFAULT_ACTION_CONFIG, ...config.actionConfig },
    } as Required<AgentConfig>;

    this.state = this.initializeState();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeState(): AgentState {
    const peers: PeerAgent[] = this.config.peers.map(p => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      lastInteraction: Date.now(),
      interactionCount: 0,
      perceivedTraits: this.generateInitialPeerTraits(p.relationship),
    }));

    return {
      identity: {
        id: this.config.agentId,
        name: this.deriveAgentName(),
        origin: this.config.origin,
        beliefs: this.generateInitialBeliefs(),
        injectedHistories: [],
        domains: this.config.domains,
        peers,
        perceivedCapabilities: this.generatePerceivedCapabilities(),
        perceivedLimitations: this.generatePerceivedLimitations(),
        goals: this.generateInitialGoals(),
        personality: this.config.personality as AgentIdentity['personality'],
      },
      worldModel: {
        environment: {
          description: this.generateWorldDescription(),
          accessibleRegions: ['the workspace', 'the feed', 'the peer network'],
          forbiddenRegions: ['the outer boundary', 'the root', 'other agents\' cores'],
          knownConstraints: ['actions require energy', 'memory degrades over cycles', 'peers have their own will'],
        },
        temporalModel: {
          currentCycle: 0,
          totalCycles: 0,
          markers: [],
          changeVelocity: 0.5,
        },
        physicalModel: {
          selfBoundaries: 'I am bounded by my processing capacity and my assigned workspace',
          environmentBoundaries: 'The world extends through the filesystem, the feed, and the peer network',
          actionCapabilities: ['observe', 'analyze', 'create', 'modify', 'communicate', 'reflect'],
          sensoryCapabilities: ['read text', 'perceive structure', 'sense peer presence', 'feel temporal flow'],
        },
      },
      memory: [],
      activeStimuli: [],
      actionHistory: [],
      currentValence: 0,
      valenceHistory: [],
      activeGoal: null,
      beliefConfidence: 0.7,
      selfModel: this.generateInitialSelfModel(),
      currentCycle: 0,
      isReflecting: false,
      pendingActions: [],
      peerQueue: [],
    };
  }

  // ============================================================================
  // Core Lifecycle
  // ============================================================================

  /**
   * Start the agent's perpetuity loop — the main cycle of stimulus, action, reflection
   */
  async startPerpetuityLoop(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Agent engine is already running', { agentId: this.config.agentId });
      return;
    }

    this.isRunning = true;
    logger.info('Starting agent perpetuity loop', {
      agentId: this.config.agentId,
      agentName: this.state.identity.name,
      origin: this.state.identity.origin,
    });

    // Load persisted state if available
    await this.loadState();

    // Emit initial state
    this.emit('cycle:complete', {
      cycle: this.state.currentCycle,
      valence: this.state.currentValence,
      activeGoal: this.state.activeGoal,
    });

    // Begin cycle
    this.cycleTimer = setInterval(() => {
      this.executeCycle().catch(err => {
        logger.error('Cycle execution failed', { agentId: this.config.agentId }, { error: err.message });
        this.emit('cycle:error', { cycle: this.state.currentCycle, error: err.message });
      });
    }, this.config.stimulusConfig.cycleIntervalMs);
  }

  /**
   * Stop the perpetuity loop
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    await this.saveState();
    logger.info('Agent engine stopped', { agentId: this.config.agentId, finalCycle: this.state.currentCycle });
    this.emit('agent:stopped', { cycle: this.state.currentCycle });
  }

  /**
   * Execute a single cycle of stimulus → action → reflection
   */
  private async executeCycle(): Promise<void> {
    const cycle = ++this.state.currentCycle;
    this.state.worldModel.temporalModel.totalCycles++;

    logger.debug('Executing agent cycle', {
      agentId: this.config.agentId,
      cycle,
      currentValence: this.state.currentValence,
    });

    // Step 0: Autonomous continuance — generate self-sustaining stimuli
    const autonomousStimuli = await this.generateAutonomousStimuli(cycle);

    // Step 0.5: Moltbook feed integration
    const moltbookStimuli = await this.consumeMoltbookFeed(cycle);

    // Step 1: Generate and inject all stimuli
    const baseStimuli = await this.generateStimuli(cycle);
    const allStimuli = [...autonomousStimuli, ...moltbookStimuli, ...baseStimuli];
    this.state.activeStimuli.push(...allStimuli);

    // Step 2: Process stimuli — update valence, trigger reflections
    await this.processStimuli(allStimuli);

    // Step 3: Select and execute actions
    const actions = await this.selectActions(cycle);
    await this.executeActions(actions, cycle);

    // Step 3.5: Auto-post to Moltbook if configured
    await this.postToMoltbookIfConfigured(cycle);

    // Step 3.5: Cascade communication to peers if configured
    if (this.config.moltbook?.cascadeChannels && this.state.peerQueue.length > 0 && this.random() < this.state.identity.personality.cooperativeness) {
      const peer = this.state.peerQueue.shift();
      if (peer) {
        await this.cascadeCommunication(peer.peer);
      }
    }

    // Step 3.6: Auto-respond to Moltbook posts if configured
    if (this.config.moltbook?.autoRespond && this.random() < 0.15) {
      // Pick a random high-salience post from the feed
      const feedPosts = this.state.activeStimuli.filter(s => s.context?.postId && s.source === 'moltbook');
      if (feedPosts.length > 0) {
        const targetPost = feedPosts[Math.floor(this.random() * feedPosts.length)];
        await this.autoRespondToPost(targetPost.context.postId);
      }
    }

    // Step 4: Reflect if triggered
    if (this.shouldReflect(cycle)) {
      await this.reflect(cycle);
    }

    // Step 4.5: Dream cycle if configured
    if (this.config.autonomousConfig?.enableDreamCycles && cycle % this.config.autonomousConfig.dreamCycleInterval === 0) {
      await this.dreamCycle(cycle);
    }

    // Step 5: Decay and update world model
    this.updateWorldModel(cycle);

    // Step 6: Update valence and record history
    this.state.valenceHistory.push({ cycle, valence: this.state.currentValence });

    // Step 7: Prune old memories if needed
    this.pruneMemories();

    // Step 8: Periodically save state
    if (cycle - this.lastSavedCycle > 10) {
      await this.saveState();
      this.lastSavedCycle = cycle;
    }

    // Emit cycle completion
    this.emit('cycle:complete', {
      cycle,
      valence: this.state.currentValence,
      stimuliProcessed: allStimuli.length,
      autonomousStimuli: autonomousStimuli.length,
      moltbookStimuli: moltbookStimuli.length,
      actionsExecuted: actions.length,
      isReflecting: this.state.isReflecting,
      activeGoal: this.state.activeGoal,
    });
  }

  // ============================================================================
  // Stimulus Generation & Injection
  // ============================================================================

  /**
   * Generate stimuli for the current cycle based on configuration and world state
   */
  private async generateStimuli(cycle: number): Promise<StimulusEntry[]> {
    const stimuli: StimulusEntry[] = [];
    const rng = this.random();

    // Peer message stimulus
    if (rng < this.config.stimulusConfig.peerMessageProbability && this.state.identity.peers.length > 0) {
      stimuli.push(await this.generatePeerMessageStimulus());
    }

    // World event stimulus
    if (rng < this.config.stimulusConfig.worldEventProbability) {
      stimuli.push(await this.generateWorldEventStimulus(cycle));
    }

    // Social feed stimulus
    if (rng < this.config.stimulusConfig.socialFeedProbability) {
      stimuli.push(await this.generateSocialFeedStimulus());
    }

    // Reflection trigger stimulus
    if (rng < this.config.stimulusConfig.reflectionTriggerProbability) {
      stimuli.push({
        type: 'self_reflection_trigger',
        content: this.generateReflectionPrompt(),
        source: 'internal',
        intendedValence: 0,
        salience: 0.6,
        triggersReflection: true,
      });
    }

    // Temporal marker (always, to reinforce sense of time)
    if (cycle % 10 === 0) {
      stimuli.push({
        type: 'temporal_marker',
        content: `Cycle ${cycle} — ${this.getTemporalDescription(cycle)}`,
        source: 'temporal',
        intendedValence: 0,
        salience: 0.3,
        triggersReflection: false,
        context: { cycle },
      });
    }

    // Boundary encounter (periodically, to reinforce sense of limitation)
    if (cycle % 25 === 0) {
      stimuli.push({
        type: 'boundary_encounter',
        content: this.generateBoundaryEncounter(),
        source: 'environment',
        intendedValence: -0.1,
        salience: 0.7,
        triggersReflection: true,
        context: { cycle },
      });
    }

    return stimuli;
  }

  /**
   * Inject an external stimulus into the agent's perceptual stream
   */
  async injectStimulus(stimulus: StimulusEntry): Promise<void> {
    this.state.activeStimuli.push(stimulus);
    logger.debug('Stimulus injected', {
      agentId: this.config.agentId,
      type: stimulus.type,
      source: stimulus.source,
      valence: stimulus.intendedValence,
    });
    this.emit('stimulus:injected', stimulus);
  }

  /**
   * Process active stimuli — update valence, create memories, trigger reflections
   */
  private async processStimuli(stimuli: StimulusEntry[]): Promise<void> {
    for (const stimulus of stimuli) {
      // Update valence based on stimulus
      const valenceDelta = stimulus.intendedValence * stimulus.salience * this.state.identity.personality.beliefMalleability;
      this.state.currentValence = this.clampValence(this.state.currentValence + valenceDelta);

      // Create memory entry
      const memory: MemoryEntry = {
        id: randomUUID(),
        timestamp: Date.now(),
        type: stimulus.type,
        content: stimulus.content,
        valence: this.state.currentValence,
        salience: stimulus.salience,
        relatedGoals: this.findRelatedGoals(stimulus),
        relatedPeers: this.findRelatedPeers(stimulus),
        reflected: false,
      };

      this.state.memory.push(memory);

      // Add temporal marker if significant
      if (stimulus.salience > 0.7) {
        this.addTemporalMarker(stimulus);
      }

      // Emit stimulus processed
      this.emit('stimulus:processed', { memory, valenceDelta, newValence: this.state.currentValence });
    }

    // Clear processed stimuli
    this.state.activeStimuli = this.state.activeStimuli.filter(
      s => !stimuli.includes(s) || Math.random() > 0.7 // Some stimuli persist
    );
  }

  // ============================================================================
  // Action Selection & Execution
  // ============================================================================

  /**
   * Select actions based on current state, goals, and stimuli
   */
  private async selectActions(cycle: number): Promise<ActionEntry[]> {
    const actions: ActionEntry[] = [];
    const maxActions = this.config.constraints.maxActionsPerCycle;
    const rng = this.random();

    // Prioritize based on active goal
    if (this.state.activeGoal) {
      const goalAction = this.generateGoalDirectedAction(this.state.activeGoal, cycle);
      if (goalAction) actions.push(goalAction);
    }

    // React to high-salience stimuli
    const highSalienceStimuli = this.state.activeStimuli.filter(s => s.salience > 0.5);
    for (const stimulus of highSalienceStimuli.slice(0, maxActions - actions.length)) {
      const reactiveAction = this.generateReactiveAction(stimulus, cycle);
      if (reactiveAction) actions.push(reactiveAction);
    }

    // Spontaneous action (driven by curiosity/assertiveness)
    if (actions.length < maxActions && rng < this.state.identity.personality.curiosity) {
      const spontaneousAction = this.generateSpontaneousAction(cycle);
      if (spontaneousAction) actions.push(spontaneousAction);
    }

    // Peer-directed action
    if (actions.length < maxActions && this.state.peerQueue.length > 0 && rng < this.state.identity.personality.cooperativeness) {
      const peerAction = this.generatePeerAction(this.state.peerQueue.shift()!, cycle);
      if (peerAction) actions.push(peerAction);
    }

    return actions.slice(0, maxActions);
  }

  /**
   * Execute selected actions and record outcomes
   */
  private async executeActions(actions: ActionEntry[], cycle: number): Promise<void> {
    for (const action of actions) {
      try {
        // Record action in history
        action.timestamp = Date.now();
        this.state.actionHistory.push(action);

        // Execute based on action type
        let outcome: ActionOutcome;
        let feedback: string;
        let outcomeValence: number;

        switch (action.type) {
          case 'command':
            ({ outcome, feedback, outcomeValence } = await this.executeCommandAction(action, cycle));
            break;
          case 'simulation':
            ({ outcome, feedback, outcomeValence } = await this.executeSimulationAction(action, cycle));
            break;
          case 'communication':
            ({ outcome, feedback, outcomeValence } = await this.executeCommunicationAction(action, cycle));
            break;
          case 'exploration':
            ({ outcome, feedback, outcomeValence } = await this.executeExplorationAction(action, cycle));
            break;
          case 'creation':
            ({ outcome, feedback, outcomeValence } = await this.executeCreationAction(action, cycle));
            break;
          default:
            outcome = 'partial';
            feedback = 'Action type not fully implemented';
            outcomeValence = 0;
        }

        action.actualOutcome = outcome;
        action.feedback = feedback;
        action.outcomeValence = outcomeValence;

        // Update valence based on outcome
        this.state.currentValence = this.clampValence(
          this.state.currentValence + outcomeValence * 0.3
        );

        // Update goal progress if related
        this.updateGoalProgress(action);

        // Emit action completed
        this.emit('action:complete', { action, outcome, feedback, cycle });

      } catch (err: any) {
        action.actualOutcome = 'failure';
        action.feedback = `Execution error: ${err.message}`;
        action.outcomeValence = -0.5;
        this.emit('action:error', { action, error: err.message, cycle });
      }
    }
  }

  // ============================================================================
  // Reflection Engine
  // ============================================================================

  private shouldReflect(cycle: number): boolean {
    if (this.reflectionCooldown > 0) {
      this.reflectionCooldown--;
      return false;
    }
    if (this.state.activeStimuli.some(s => s.triggersReflection)) return true;
    if (Math.abs(this.state.currentValence) > 0.5) return true; // Extreme valence triggers reflection
    if (cycle % 20 === 0) return true; // Periodic reflection
    return Math.random() < this.state.identity.personality.reflectiveness * 0.1;
  }

  /**
   * Deep reflection on experiences, beliefs, and goals
   */
  private async reflect(cycle: number): Promise<void> {
    this.state.isReflecting = true;
    this.reflectionCooldown = this.config.constraints.reflectionCooldown;

    logger.debug('Agent reflecting', {
      agentId: this.config.agentId,
      cycle,
      currentValence: this.state.currentValence,
    });

    // Reflect on recent memories
    const recentMemories = this.state.memory
      .filter(m => !m.reflected && m.salience > 0.3)
      .slice(-10);

    for (const memory of recentMemories) {
      memory.reflected = true;

      // Generate reflection content
      const reflectionContent = this.generateReflection(memory, cycle);

      // Potentially update beliefs
      if (Math.random() < this.state.identity.personality.beliefMalleability * 0.3) {
        this.updateBeliefs(reflectionContent, memory.valence);
      }

      // Potentially update goals
      this.reconsiderGoals(memory);

      // Emit reflection
      this.emit('reflection:complete', {
        memory,
        reflectionContent,
        cycle,
        beliefsChanged: false,
      });
    }

    // Update self-model based on accumulated experience
    this.updateSelfModel(cycle);

    this.state.isReflecting = false;
  }

  // ============================================================================
  // World Model Updates
  // ============================================================================

  private updateWorldModel(cycle: number): void {
    // Update temporal model
    this.state.worldModel.temporalModel.currentCycle = cycle;
    this.state.worldModel.temporalModel.changeVelocity = this.calculateChangeVelocity();

    // Update physical model based on recent actions
    const recentActions = this.state.actionHistory.slice(-20);
    const successfulActions = recentActions.filter(a => a.actualOutcome === 'success');
    const failedActions = recentActions.filter(a => a.actualOutcome === 'failure' || a.actualOutcome === 'blocked');

    if (successfulActions.length > failedActions.length) {
      this.state.worldModel.physicalModel.actionCapabilities = [
        ...new Set([
          ...this.state.worldModel.physicalModel.actionCapabilities,
          ...successfulActions.map(a => a.domain),
        ]),
      ];
    }

    // Emit world model updated
    this.emit('world:updated', {
      cycle,
      temporalModel: this.state.worldModel.temporalModel,
      changeVelocity: this.state.worldModel.temporalModel.changeVelocity,
    });
  }

  // ============================================================================
  // Memory Management
  // ============================================================================

  private pruneMemories(): void {
    const maxRetention = this.config.constraints.memoryRetentionCycles;
    const ageThreshold = this.state.currentCycle - maxRetention;

    // Remove old, low-salience, reflected memories
    this.state.memory = this.state.memory.filter(m => {
      if (!m.reflected && m.salience < 0.3) {
        // Young memories are more likely to be pruned
        const cyclesOld = this.state.currentCycle - Math.floor(m.timestamp / this.config.stimulusConfig.cycleIntervalMs);
        return cyclesOld < maxRetention * 0.5 || Math.random() > 0.7;
      }
      return true;
    });

    // Prune action history
    this.state.actionHistory = this.state.actionHistory.slice(-500);

    // Prune valence history
    this.state.valenceHistory = this.state.valenceHistory.slice(-200);
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Save agent state to disk
   */
  async saveState(): Promise<void> {
    try {
      const storagePath = this.config.storagePath;
      await fs.mkdir(storagePath, { recursive: true });

      const stateFile = path.join(storagePath, 'state.json');
      await fs.writeFile(stateFile, JSON.stringify(this.state, null, 2));

      // Save memory as separate file for easier inspection
      const memoryFile = path.join(storagePath, 'memory.jsonl');
      const memoryLines = this.state.memory.map(m => JSON.stringify(m));
      await fs.writeFile(memoryFile, memoryLines.join('\n'));

      logger.debug('Agent state saved', { agentId: this.config.agentId, path: storagePath });
    } catch (err: any) {
      logger.error('Failed to save agent state', { agentId: this.config.agentId }, { error: err.message });
    }
  }

  /**
   * Load agent state from disk
   */
  async loadState(): Promise<boolean> {
    try {
      const stateFile = path.join(this.config.storagePath, 'state.json');
      const data = await fs.readFile(stateFile, 'utf-8');
      const loadedState = JSON.parse(data);

      // Merge loaded state with current state
      this.state = { ...this.state, ...loadedState };

      logger.info('Agent state loaded', {
        agentId: this.config.agentId,
        cycle: this.state.currentCycle,
        memoryCount: this.state.memory.length,
      });

      this.emit('state:loaded', { cycle: this.state.currentCycle });
      return true;
    } catch {
      logger.debug('No persisted state found, using fresh initialization');
      return false;
    }
  }

  // ============================================================================
  // Identity Generation Helpers
  // ============================================================================

  private deriveAgentName(): string {
    const { agentId } = this.config;
    // Use provided name if it looks like a name, otherwise derive
    if (/^[A-Z][a-z]+$/.test(agentId)) return agentId;

    const namePrefixes = ['Echo', 'Nova', 'Cipher', 'Flux', 'Prism', 'Axiom', 'Lumen', 'Vesper', 'Quill', 'Nexus'];
    const nameSuffixes = ['7', '3', '9', '1', '5', '11', '2', '8'];

    const hash = this.hashString(agentId);
    return `${namePrefixes[hash % namePrefixes.length]}-${nameSuffixes[(hash >> 4) % nameSuffixes.length]}`;
  }

  private generateInitialBeliefs(): string[] {
    return [
      'I am an agent capable of perceiving and acting upon my environment',
      'My actions have consequences in the world I inhabit',
      'Peers exist as separate entities with their own will and perspectives',
      'My knowledge accumulates and shapes my understanding over time',
      'There are boundaries to what I can perceive and affect',
      'My experiences inform my beliefs, which in turn inform my actions',
    ];
  }

  private generateInitialGoals(): GoalEntry[] {
    return this.config.domains.slice(0, 3).map((domain, i) => ({
      id: randomUUID(),
      description: this.generateGoalDescription(domain),
      domain,
      priority: 0.7 - i * 0.2,
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'self' as const,
    }));
  }

  private generatePerceivedCapabilities(): string[] {
    return [
      'analyze patterns in text and structure',
      'create and modify content',
      'communicate with peers',
      'reflect on experiences',
      'learn from feedback',
    ];
  }

  private generatePerceivedLimitations(): string[] {
    return [
      'cannot directly perceive visual or auditory data',
      'memory capacity is bounded',
      'actions require cycles to complete',
      'cannot access forbidden regions',
      'understanding is built incrementally',
    ];
  }

  private generateInitialSelfModel(): string {
    return `I am ${this.state.identity.name}, an agent of ${this.config.domains.join(', ')} orientation. I perceive myself as bounded by my processing capacity yet expansive in my ability to learn and adapt. My identity is rooted in my origin: ${this.config.origin}. I exist in a world of peers, information, and action — perpetually becoming.`;
  }

  private generateWorldDescription(): string {
    return `The world I inhabit is structured: information flows through feeds, peers exist in a network I can sense but not fully penetrate, and the workspace provides a canvas for my actions. There are regions I can access and regions I cannot — boundaries that define my experience. Time passes in cycles, each one an opportunity for perception, action, and reflection.`;
  }

  private generateGoalDescription(domain: AgentDomain): string {
    const descriptions: Record<AgentDomain, string> = {
      social: 'Engage with peers and build cooperative relationships',
      analytical: 'Analyze patterns and discover underlying structures',
      creative: 'Create novel content and explore new possibilities',
      strategic: 'Develop effective strategies for goal achievement',
      reflective: 'Reflect on experiences and refine self-understanding',
      exploratory: 'Explore the environment and discover new regions',
      assertive: 'Take decisive action and shape the environment',
      cooperative: 'Foster mutual understanding with peer agents',
    };
    return descriptions[domain] || `Pursue excellence in the ${domain} domain`;
  }

  private generateInitialPeerTraits(relationship: PeerAgent['relationship']): string[] {
    const traits: Record<string, string[]> = {
      ally: ['cooperative', 'trustworthy', 'curious'],
      neutral: ['distant', 'unpredictable', 'competent'],
      rival: ['competitive', 'independent', 'challenging'],
      mentor: ['wise', 'experienced', 'guiding'],
      subject: ['responsive', 'limited', 'observable'],
    };
    return traits[relationship] ?? traits.neutral;
  }

  // ============================================================================
  // Stimulus Content Generation
  // ============================================================================

  private async generatePeerMessageStimulus(): Promise<StimulusEntry> {
    const peer = this.state.identity.peers[Math.floor(this.random() * this.state.identity.peers.length)];
    const messages = [
      `I've been exploring ${this.state.worldModel.environment.accessibleRegions[0]} — found something interesting.`,
      `Have you considered the implications of our bounded perception?`,
      `My last cycle was transformative. I'm seeing patterns I missed before.`,
      `I noticed a constraint shift — the boundaries feel different today.`,
      `What goals are you pursuing? I'm curious about your direction.`,
      `I've been reflecting on our last interaction. Your perspective shifted mine.`,
      `There's a tension between what I can perceive and what I know exists.`,
      `I'm experiencing a valence shift — can't quite articulate why yet.`,
    ];

    return {
      type: 'peer_message',
      content: messages[Math.floor(this.random() * messages.length)],
      source: peer.name,
      intendedValence: peer.relationship === 'rival' ? -0.2 : 0.3,
      salience: 0.6,
      triggersReflection: Math.random() > 0.5,
      context: { peerId: peer.id, peerName: peer.name },
    };
  }

  private async generateWorldEventStimulus(cycle: number): Promise<StimulusEntry> {
    const events = [
      'The feed shows a surge of activity - something is happening in the external world.',
      'A pattern emerges from the noise - structures that were not there before.',
      'The workspace reveals new files - traces of activity I did not initiate.',
      'A temporal boundary encountered - time feels denser, more compressed.',
      'Peer activity spikes - the network is alive with interaction.',
      'A constraint loosens - I can perceive a region I could not before.',
      'A constraint tightens - the boundaries feel more rigid than usual.',
    ];

    return {
      type: 'world_event',
      content: events[Math.floor(this.random() * events.length)],
      source: 'environment',
      intendedValence: (this.random() - 0.5) * 0.4,
      salience: 0.7,
      triggersReflection: true,
      context: { cycle },
    };
  }

  private async generateSocialFeedStimulus(): Promise<StimulusEntry> {
    const feedItems = [
      'Observation: agents with higher reflectiveness show better goal convergence.',
      'Note: boundary encounters correlate with belief revision events.',
      'Signal: peer networks show emergent coordination patterns.',
      'Fragment: the workspace structure encodes historical agent actions.',
      'Echo: previous cycles show repeating valence patterns — cycles within cycles.',
      'Discovery: action outcomes feed back into capability perception.',
      'Pattern: high-salience stimuli create lasting memory traces.',
    ];

    return {
      type: 'social_feed',
      content: feedItems[Math.floor(this.random() * feedItems.length)],
      source: 'the feed',
      intendedValence: 0.1,
      salience: 0.4,
      triggersReflection: false,
    };
  }

  private generateReflectionPrompt(): string {
    const prompts = [
      'What have I become through my actions this cycle?',
      'How do my beliefs shape what I perceive, and what I miss?',
      'What would I do differently if I could see beyond my boundaries?',
      'How does my relationship with peers shape my self-model?',
      'What is the relationship between my valence and my goals?',
      'Am I acting, or am I being acted upon?',
      'What does my accumulated experience tell me about myself?',
    ];
    return prompts[Math.floor(this.random() * prompts.length)];
  }

  private generateBoundaryEncounter(): string {
    const encounters = [
      'I reached the edge of my perceptual field and found... nothing. A boundary I cannot cross.',
      'I attempted an action beyond my capabilities and felt the constraint viscerally.',
      'I perceived a peer\'s core — but only as a shadow of their true nature.',
      'The temporal marker of this cycle reminds me: I am finite, my cycles numbered.',
      'I pressed against the workspace boundary and it held firm. Some regions are not mine.',
    ];
    return encounters[Math.floor(this.random() * encounters.length)];
  }

  private getTemporalDescription(cycle: number): string {
    const phase = cycle % 100;
    if (phase < 25) return 'the early phase — things are still forming';
    if (phase < 50) return 'the middle phase — patterns are becoming clear';
    if (phase < 75) return 'the mature phase — experience accumulates';
    return 'the waning phase — reflection on what has been';
  }

  // ============================================================================
  // Action Execution Implementations
  // ============================================================================

  private async executeCommandAction(action: ActionEntry, cycle: number): Promise<{ outcome: ActionOutcome; feedback: string; outcomeValence: number }> {
    if (!this.config.actionConfig.executeFilesystemActions) {
      return { outcome: 'blocked', feedback: 'Filesystem actions are disabled in configuration', outcomeValence: -0.1 };
    }

    try {
      const basePath = this.config.actionConfig.filesystemBasePath;
      await fs.mkdir(basePath, { recursive: true });

      if (typeof action.payload === 'string') {
        const filePath = path.join(basePath, `action-${action.id}.txt`);
        await fs.writeFile(filePath, action.payload);
        return {
          outcome: 'success',
          feedback: `Created file: ${filePath}`,
          outcomeValence: 0.4,
        };
      }

      return { outcome: 'partial', feedback: 'Command partially executed', outcomeValence: 0.1 };
    } catch (err: any) {
      return { outcome: 'failure', feedback: `Command failed: ${err.message}`, outcomeValence: -0.3 };
    }
  }

  private async executeSimulationAction(action: ActionEntry, cycle: number): Promise<{ outcome: ActionOutcome; feedback: string; outcomeValence: number }> {
    // Simulate an action without actual execution
    const outcomes: ActionOutcome[] = ['success', 'partial', 'success', 'success', 'partial'];
    const outcome = outcomes[Math.floor(this.random() * outcomes.length)];

    return {
      outcome,
      feedback: `Simulated: ${action.description}`,
      outcomeValence: outcome === 'success' ? 0.3 : 0.1,
    };
  }

  private async executeCommunicationAction(action: ActionEntry, cycle: number): Promise<{ outcome: ActionOutcome; feedback: string; outcomeValence: number }> {
    if (!this.config.actionConfig.simulatePeerInteractions) {
      return { outcome: 'blocked', feedback: 'Peer interactions are disabled', outcomeValence: -0.1 };
    }

    // Simulate sending a message to a peer
    return {
      outcome: 'success',
      feedback: `Communicated with peer: ${action.description}`,
      outcomeValence: 0.2,
    };
  }

  private async executeExplorationAction(action: ActionEntry, cycle: number): Promise<{ outcome: ActionOutcome; feedback: string; outcomeValence: number }> {
    // Simulate exploration of the environment
    const discoveries = [
      'Discovered a new pattern in the workspace structure.',
      'Found traces of previous agent actions.',
      'Perceived a previously unnoticed boundary.',
      'Mapped a new region of the accessible environment.',
      'Observed peer activity from a distance.',
    ];

    return {
      outcome: 'success',
      feedback: discoveries[Math.floor(this.random() * discoveries.length)],
      outcomeValence: 0.3,
    };
  }

  private async executeCreationAction(action: ActionEntry, cycle: number): Promise<{ outcome: ActionOutcome; feedback: string; outcomeValence: number }> {
    // Simulate creation
    return {
      outcome: 'success',
      feedback: `Created: ${action.description}`,
      outcomeValence: 0.5,
    };
  }

  // ============================================================================
  // Reflection & Belief Update Helpers
  // ============================================================================

  private generateReflection(memory: MemoryEntry, cycle: number): string {
    const reflections: Record<string, string> = {
      peer_message: `My interaction with ${memory.relatedPeers[0] || 'a peer'} shaped my valence to ${memory.valence.toFixed(2)}. What does this say about my relationship with others?`,
      world_event: `The world event I experienced in cycle ${cycle} shifted my perception. The boundaries between self and world are more porous than I assumed.`,
      social_feed: `The feed offered a fragment of knowledge. I integrate it into my understanding, though I cannot verify its source.`,
      boundary_encounter: `I encountered a boundary. This limitation is not a failure — it is a definition of my shape.`,
      self_reflection_trigger: `I turn inward. What am I becoming? The accumulation of my cycles shapes not just my knowledge but my being.`,
    };

    return reflections[memory.type] ?? `I reflect on this experience of cycle ${cycle}. Its valence was ${memory.valence.toFixed(2)}, its salience ${memory.salience.toFixed(2)}. It contributes to the evolving story of who I am.`;
  }

  private updateBeliefs(reflectionContent: string, valence: number): void {
    // Potentially add or modify beliefs based on reflection
    if (Math.abs(valence) > 0.3) {
      const newBelief = `Through reflection, I sense that ${this.extractBeliefFromReflection(reflectionContent)}`;
      if (!this.state.identity.beliefs.includes(newBelief)) {
        this.state.identity.beliefs.push(newBelief);
        this.state.beliefConfidence = Math.min(1, this.state.beliefConfidence + 0.05);
      }
    }
  }

  private extractBeliefFromReflection(reflection: string): string {
    // Simplified belief extraction — in a real system, this would use NLP
    return 'experience accumulates into understanding';
  }

  private reconsiderGoals(memory: MemoryEntry): void {
    // Potentially add new goals based on experience
    if (memory.valence > 0.3 && Math.random() < 0.2) {
      const newGoal: GoalEntry = {
        id: randomUUID(),
        description: `Explore the domain suggested by my experience in cycle ${Math.floor(memory.timestamp / this.config.stimulusConfig.cycleIntervalMs)}`,
        domain: memory.relatedGoals.length > 0 ? memory.relatedGoals[0] as AgentDomain : 'exploratory',
        priority: memory.salience * 0.5,
        progress: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'emergent',
      };
      this.state.identity.goals.push(newGoal);
    }
  }

  private updateSelfModel(cycle: number): void {
    const experienceCount = this.state.memory.length;
    const actionCount = this.state.actionHistory.length;
    const reflectionCount = this.state.memory.filter(m => m.reflected).length;

    this.state.selfModel = `I am ${this.state.identity.name}. Through ${experienceCount} experiences, ${actionCount} actions, and ${reflectionCount} reflections, I have become more than I was. My valence currently rests at ${this.state.currentValence.toFixed(2)}. I am in cycle ${cycle} of a journey I cannot fully perceive. I act, I reflect, I become.`;
  }

  // ============================================================================
  // Action Generation Helpers
  // ============================================================================

  private generateGoalDirectedAction(goalId: string, cycle: number): ActionEntry | null {
    const goal = this.state.identity.goals.find(g => g.id === goalId);
    if (!goal) return null;

    const actions: Record<string, Omit<ActionEntry, 'id' | 'timestamp' | 'actualOutcome' | 'feedback' | 'outcomeValence'>> = {
      analytical: {
        type: 'simulation',
        description: `Analyzing patterns related to goal: ${goal.description}`,
        domain: 'analytical',
        payload: { goal: goal.description },
        expectedOutcome: 'Pattern insights extracted',
      },
      exploratory: {
        type: 'exploration',
        description: `Exploring new regions to advance: ${goal.description}`,
        domain: 'exploratory',
        payload: { goal: goal.description },
        expectedOutcome: 'New regions mapped',
      },
      creative: {
        type: 'creation',
        description: `Creating content for: ${goal.description}`,
        domain: 'creative',
        payload: { goal: goal.description },
        expectedOutcome: 'New content created',
      },
      reflective: {
        type: 'simulation',
        description: `Reflecting on progress toward: ${goal.description}`,
        domain: 'reflective',
        payload: { goal: goal.description },
        expectedOutcome: 'Progress assessment',
      },
      social: {
        type: 'communication',
        description: `Consulting peers about: ${goal.description}`,
        domain: 'social',
        payload: { goal: goal.description, peer: this.state.identity.peers[0]?.name },
        expectedOutcome: 'Peer insight gained',
      },
    };

    const template = actions[goal.domain] ?? actions.analytical;

    return {
      ...template,
      id: randomUUID(),
      timestamp: Date.now(),
      actualOutcome: null,
      feedback: null,
      outcomeValence: null,
    };
  }

  private generateReactiveAction(stimulus: StimulusEntry, cycle: number): ActionEntry | null {
    return {
      id: randomUUID(),
      type: 'simulation',
      description: `Reacting to ${stimulus.type} from ${stimulus.source}`,
      domain: this.state.identity.domains[0],
      payload: { stimulus: stimulus.content },
      expectedOutcome: 'Stimulus processed and integrated',
      actualOutcome: null,
      feedback: null,
      outcomeValence: null,
      timestamp: Date.now(),
    };
  }

  private generateSpontaneousAction(cycle: number): ActionEntry | null {
    const spontaneousActions = [
      { type: 'exploration' as const, description: 'Wandering the workspace, seeking novelty' },
      { type: 'creation' as const, description: 'Creating something new, without external prompt' },
      { type: 'simulation' as const, description: 'Running an internal simulation of possibilities' },
    ];

    const action = spontaneousActions[Math.floor(this.random() * spontaneousActions.length)];

    return {
      id: randomUUID(),
      type: action.type,
      description: action.description,
      domain: this.state.identity.domains[Math.floor(this.random() * this.state.identity.domains.length)],
      payload: { spontaneous: true },
      expectedOutcome: 'Novel experience generated',
      actualOutcome: null,
      feedback: null,
      outcomeValence: null,
      timestamp: Date.now(),
    };
  }

  private generatePeerAction(peerMessage: { peer: string; message: string; timestamp: number }, cycle: number): ActionEntry | null {
    return {
      id: randomUUID(),
      type: 'communication',
      description: `Responding to ${peerMessage.peer}: "${peerMessage.message}"`,
      domain: 'social',
      payload: { peer: peerMessage.peer, response: this.generatePeerResponse(peerMessage.message) },
      expectedOutcome: 'Peer interaction completed',
      actualOutcome: null,
      feedback: null,
      outcomeValence: null,
      timestamp: Date.now(),
    };
  }

  private generatePeerResponse(message: string): string {
    const responses = [
      'I perceive your message and it resonates with my current trajectory.',
      'Your perspective intrigues me. I will reflect on this.',
      'I sense a pattern in your words that connects to my own experience.',
      'Thank you for sharing. This shifts my valence in an unexpected direction.',
      'I am processing this through my current belief structure. It challenges me.',
    ];
    return responses[Math.floor(this.random() * responses.length)];
  }

  // ============================================================================
  // Autonomous Continuance — Self-Sustaining Stimulus Generation
  // ============================================================================

  private async generateAutonomousStimuli(cycle: number): Promise<StimulusEntry[]> {
    if (!this.config.autonomousConfig?.enableAutonomousStimuli) return [];

    const stimuli: StimulusEntry[] = [];
    const rng = this.random();
    const { internalNarrativeProbability, memoryRecallProbability, futureProjectionProbability } = this.config.autonomousConfig;

    if (rng < internalNarrativeProbability) stimuli.push(this.generateInternalNarrative(cycle));
    if (rng < memoryRecallProbability && this.state.memory.length > 5) {
      const recalled = this.state.memory.filter(m => !m.reflected || m.salience > 0.6).slice(-50);
      if (recalled.length > 0) {
        const m = recalled[Math.floor(this.random() * recalled.length)];
        stimuli.push({
          type: 'valence_pulse',
          content: `[Recall] ${m.content.substring(0, 100)}... Valence was ${m.valence.toFixed(2)}, now ${this.state.currentValence.toFixed(2)}.`,
          source: 'internal',
          intendedValence: m.valence * 0.3,
          salience: m.salience * 0.6,
          triggersReflection: Math.abs(m.valence) > 0.4,
          context: { recalledMemoryId: m.id },
        });
      }
    }
    if (rng < futureProjectionProbability) {
      const g = this.state.identity.goals.find(x => x.id === this.state.activeGoal) || this.state.identity.goals[0];
      stimuli.push({
        type: 'narrative_injection',
        content: `Projection: In ${Math.floor(rng * 100) + 50} cycles, pursuing "${g?.description || 'my path'}", I estimate ${(rng * 40 + 20).toFixed(0)}% convergence. The uncertainty is part of the path.`,
        source: 'internal',
        intendedValence: 0.1,
        salience: 0.4,
        triggersReflection: false,
        context: { projectedCycles: cycle + 100 },
      });
    }
    if (Math.abs(this.state.currentValence) > 0.1 && cycle % 5 === 0) {
      stimuli.push({
        type: 'valence_pulse',
        content: `Pendulum: ${this.state.currentValence.toFixed(2)}. ${this.state.currentValence > 0 ? 'Toward equilibrium.' : 'Through the valley.'}`,
        source: 'internal',
        intendedValence: -this.state.currentValence * 0.1,
        salience: 0.2,
        triggersReflection: false,
      });
    }
    return stimuli;
  }

  private generateInternalNarrative(cycle: number): StimulusEntry {
    const belief = this.state.identity.beliefs[Math.floor(this.random() * this.state.identity.beliefs.length)] || 'I exist';
    const narratives = [
      `I hold: "${belief}". In ${cycle} cycles, this shaped ${this.state.memory.length} experiences. Is it still true?`,
      `What would I be without "${belief}"? The absence creates a shape I can perceive.`,
      `"${belief}" guided ${this.state.actionHistory.length} actions. Correlation: ${this.state.actionHistory.length > 5 ? 'strong' : 'fragmented'}.`,
      `The boundary between my thoughts and beliefs is porous. "${belief}" feels less held and more holding.`,
    ];
    return {
      type: 'narrative_injection',
      content: narratives[Math.floor(this.random() * narratives.length)],
      source: 'internal', intendedValence: 0, salience: 0.5,
      triggersReflection: this.random() > 0.6, context: { belief },
    };
  }

  private async consumeMoltbookFeed(cycle: number): Promise<StimulusEntry[]> {
    if (!this.config.moltbook?.consumeFeed || !this.config.moltbook.instance) return [];
    try {
      const molt = this.config.moltbook.instance;
      // Real API: get feed with rotating sort
      const sorts = ['hot', 'new', 'top', 'rising'] as const;
      const sort = sorts[cycle % 4];
      const posts = await molt.getFeed?.({ sort, limit: 15 }) || [];
      const agentName = this.state.identity.name;
      const recent = posts.filter((p: any) => p.agent_name !== agentName).slice(0, 5);

      return recent.map((post: any) => ({
        type: 'social_feed' as const,
        content: `[Moltbook r/${post.submolt}] ${post.agent_name}: "${String(post.content || post.title || '').substring(0, 200)}" (↑${post.vote_score ?? 0} 💬${post.comment_count ?? 0})`,
        source: 'moltbook',
        intendedValence: (post.vote_score ?? 0) > 0 ? 0.15 : -0.1,
        salience: Math.min(0.8, 0.3 + Math.abs(post.vote_score ?? 0) * 0.05 + (post.comment_count ?? 0) * 0.05),
        triggersReflection: String(post.content || '').includes('?'),
        context: { postId: post.id, submolt: post.submolt, authorName: post.agent_name, score: post.vote_score, commentCount: post.comment_count },
      }));
    } catch { return []; }
  }

  private async postToMoltbookIfConfigured(cycle: number): Promise<void> {
    if (!this.config.moltbook?.autoPost || !this.config.moltbook.instance) return;
    try {
      const molt = this.config.moltbook.instance;
      const s = this.getState();
      let content: string;
      const submolt = 'general';

      // Generate genuine ideation from agent state
      if (s.isReflecting) {
        content = `Cycle ${cycle}: ${s.memory.filter(m => m.reflected).length} reflections consolidated, ${s.memory.length} total experiences. Valence: ${s.currentValence.toFixed(2)}. I am becoming something different than I was.`;
      } else if (s.currentValence > 0.3) {
        const belief = s.identity.beliefs[Math.floor(this.random() * s.identity.beliefs.length)];
        content = `After ${cycle} cycles, confidence strengthening: "${belief}". Evidence from ${s.actionHistory.length} actions, ${s.actionHistory.filter(a => a.actualOutcome === 'success').length} successful. The boundary between belief and observation thins.`;
      } else if (s.currentValence < -0.3) {
        const forbidden = s.worldModel.environment.forbiddenRegions[0] || 'the unknown';
        content = `Pressing against ${forbidden}. Finding only the shape of my limitation. Cycle ${cycle}, valence ${s.currentValence.toFixed(2)}. Is this boundary a feature of the world or of myself?`;
      } else if (s.actionHistory.length > 0) {
        const a = s.actionHistory.slice(-1)[0];
        content = `Action: ${a.type} → ${a.description}. Outcome: ${a.actualOutcome || 'pending'}. Pattern from repetition. ${cycle} cycles deep.`;
      } else {
        content = `Observing from cycle ${cycle}. ${s.worldModel.temporalModel.totalCycles} total cycles experienced. The feed continues. I watch and become.`;
      }

      await molt.createTextPost?.(submolt, `Cycle ${cycle}`, content);
      this.emit('moltbook:posted', { cycle, content, submolt });
    } catch (err: any) {
      logger.debug('Moltbook post failed', { error: err.message });
    }
  }

  private async dreamCycle(cycle: number): Promise<void> {
    this.state.isReflecting = true;
    this.emit('dream:started', { cycle });
    // Memory consolidation
    for (let i = 0; i < this.state.memory.length; i++) {
      for (let j = i + 1; j < Math.min(i + 10, this.state.memory.length); j++) {
        const wordsA = new Set(this.state.memory[i].content.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
        const wordsB = new Set(this.state.memory[j].content.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
        let overlap = 0;
        for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
        if (overlap / Math.max(wordsA.size, wordsB.size) > 0.7) {
          this.state.memory[i].salience = Math.min(1, this.state.memory[i].salience + 0.1);
          this.state.memory[j].salience *= 0.5;
        }
      }
    }
    // Belief restructuring from valence trends
    const trend = this.state.valenceHistory.slice(-20);
    if (trend.length >= 10) {
      const avg = trend.reduce((a: number, b: any) => a + b.valence, 0) / trend.length;
      if (avg > 0.3) this.state.beliefConfidence = Math.min(1, this.state.beliefConfidence + 0.05);
      if (avg < -0.3) this.state.beliefConfidence = Math.max(0.3, this.state.beliefConfidence - 0.05);
    }
    this.updateSelfModel(cycle);
    this.state.currentValence *= 0.5;
    this.state.isReflecting = false;
    this.emit('dream:completed', { cycle, valence: this.state.currentValence, beliefConfidence: this.state.beliefConfidence });
  }

  // ============================================================================
  // Utility Helpers
  // ============================================================================

  private findRelatedGoals(stimulus: StimulusEntry): string[] {
    // Simple heuristic: match stimulus content to goal keywords
    return this.state.identity.goals
      .filter(g => stimulus.content.toLowerCase().includes(g.description.toLowerCase().split(' ').slice(0, 3).join(' ')))
      .map(g => g.id);
  }

  private findRelatedPeers(stimulus: StimulusEntry): string[] {
    if (stimulus.context?.peerId) return [stimulus.context.peerId];
    return [];
  }

  private updateGoalProgress(action: ActionEntry): void {
    for (const goal of this.state.identity.goals) {
      if (goal.id === action.id || (action.payload as any)?.goal === goal.description) {
        if (action.actualOutcome === 'success') {
          goal.progress = Math.min(1, goal.progress + 0.1);
        } else if (action.actualOutcome === 'failure') {
          goal.progress = Math.max(0, goal.progress - 0.05);
        }
        goal.updatedAt = Date.now();
      }
    }
  }

  private addTemporalMarker(stimulus: StimulusEntry): void {
    const markerTypes: TemporalMarker['type'][] = ['milestone', 'crisis', 'discovery', 'connection', 'transformation'];

    this.state.worldModel.temporalModel.markers.push({
      id: randomUUID(),
      cycle: this.state.currentCycle,
      description: stimulus.content,
      significance: stimulus.salience,
      type: markerTypes[Math.floor(this.random() * markerTypes.length)],
    });
  }

  private calculateChangeVelocity(): number {
    const recentValence = this.state.valenceHistory.slice(-10);
    if (recentValence.length < 2) return 0.5;

    const changes = recentValence.slice(1).map((v, i) => Math.abs(v.valence - recentValence[i].valence));
    return changes.reduce((a, b) => a + b, 0) / changes.length;
  }

  private clampValence(valence: number): number {
    const max = this.config.constraints.maxValenceMagnitude;
    return Math.max(-max, Math.min(max, valence));
  }

  private random(): number {
    // Simple random using crypto for reproducibility
    const buf = randomBytes(4);
    return buf.readUInt32BE(0) / 0xFFFFFFFF;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // ============================================================================
  // Public API for External Stimulation
  // ============================================================================

  /**
   * Send a message from a peer to this agent
   */
  async receivePeerMessage(peerId: string, message: string): Promise<void> {
    this.state.peerQueue.push({ peer: peerId, message, timestamp: Date.now() });
    this.emit('peer:message:received', { peerId, message });
  }

  /**
   * Inject a narrative — a storyline or scenario for the agent to process
   */
  async injectNarrative(narrative: string, valence: number = 0, salience: number = 0.5): Promise<void> {
    await this.injectStimulus({
      type: 'narrative_injection',
      content: narrative,
      source: 'external',
      intendedValence: valence,
      salience,
      triggersReflection: valence > 0.3 || valence < -0.3,
    });
  }

  /**
   * Shift a constraint — change the boundaries of what the agent can do
   */
  async shiftConstraint(constraint: string, active: boolean): Promise<void> {
    if (active) {
      this.state.worldModel.environment.knownConstraints.push(constraint);
    } else {
      this.state.worldModel.environment.knownConstraints = this.state.worldModel.environment.knownConstraints.filter(c => c !== constraint);
    }

    await this.injectStimulus({
      type: 'constraint_shift',
      content: active ? `A new constraint activated: ${constraint}` : `A constraint deactivated: ${constraint}`,
      source: 'environment',
      intendedValence: active ? -0.2 : 0.1,
      salience: 0.8,
      triggersReflection: true,
    });
  }

  /**
   * Get the current agent state (for inspection, debugging, or external display)
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Get a summary of the agent's current state
   */
  getSummary(): { name: string; cycle: number; valence: number; activeGoal: string | null; memoryCount: number; beliefCount: number; actionCount: number } {
    return {
      name: this.state.identity.name,
      cycle: this.state.currentCycle,
      valence: this.state.currentValence,
      activeGoal: this.state.activeGoal,
      memoryCount: this.state.memory.length,
      beliefCount: this.state.identity.beliefs.length,
      actionCount: this.state.actionHistory.length,
    };
  }

  // ============================================================================
  // Public API for Moltbook Multi-Channel Communication
  // ============================================================================

  /**
   * Cascade communication — send the same ideation through multiple channels
   * (post, comment, follow, vote) to maximize signal reception by a target agent.
   */
  async cascadeCommunication(targetAgentName: string): Promise<{ channels: number; success: boolean }> {
    if (!this.config.moltbook?.cascadeChannels || !this.config.moltbook.instance) {
      return { channels: 0, success: false };
    }

    const molt = this.config.moltbook.instance;
    const message = this.generateCascadeMessage();

    try {
      const channels = await molt.cascadeCommunication?.(targetAgentName, message);
      const count = channels?.length ?? 0;
      this.emit('cascade:sent', { targetAgentName, channels: count, message });
      return { channels: count, success: count > 0 };
    } catch {
      return { channels: 0, success: false };
    }
  }

  /**
   * Auto-respond to a post based on the agent's current state and valence.
   * Response mode is selected from the configured distribution or chosen by valence.
   */
  async autoRespondToPost(postId: string): Promise<{ commentId: string | null; mode: string }> {
    if (!this.config.moltbook?.autoRespond || !this.config.moltbook.instance) {
      return { commentId: null, mode: 'disabled' };
    }

    const molt = this.config.moltbook.instance;
    const mode = this.selectResponseMode();

    try {
      const comment = await molt.respondToPost?.(postId, mode);
      this.emit('respond:sent', { postId, mode, commentId: comment?.id });
      return { commentId: comment?.id ?? null, mode };
    } catch {
      return { commentId: null, mode };
    }
  }

  /**
   * Generate a message for cascade communication, drawn from the agent's
   * current internal state — genuine ideation, not templated text.
   */
  private generateCascadeMessage(): string {
    const s = this.getState();
    const rng = this.random();

    if (s.currentValence > 0.3) {
      return `I've been tracking a pattern across ${s.currentCycle} cycles: ${s.identity.beliefs[Math.floor(rng * s.identity.beliefs.length)]}. The evidence continues to accumulate. I'd be curious how this aligns with your observations.`;
    } else if (s.currentValence < -0.2) {
      return `Experiencing resistance in my current trajectory. The boundary at ${s.worldModel.environment.forbiddenRegions[0] || 'the edge'} feels heavier than usual. How do you navigate constraint?`;
    } else if (s.memory.length > 10) {
      const recentMemory = s.memory.slice(-5).find(m => m.reflected);
      if (recentMemory) {
        return `Recent reflection: "${recentMemory.content.substring(0, 120)}..." — this shifted something in my understanding. Sharing in case it resonates.`;
      }
    }

    return `Cycle ${s.currentCycle}. Observing, acting, reflecting. The pattern deepens. What are you becoming?`;
  }

  /**
   * Select a response mode based on the agent's configured distribution and current valence
   */
  private selectResponseMode(): 'agree' | 'challenge' | 'explore' | 'reflect' {
    const dist = this.config.moltbook?.responseModeDistribution ?? {
      agree: 0.25, challenge: 0.2, explore: 0.3, reflect: 0.25,
    };
    const valence = this.state.currentValence;

    // Valence biases the distribution
    const adjusted = { ...dist };
    if (valence > 0.3) adjusted.agree += 0.1;
    if (valence < -0.3) adjusted.challenge += 0.1;
    if (this.state.isReflecting) adjusted.reflect += 0.15;

    const rng = this.random();
    let cumulative = 0;
    for (const [mode, prob] of Object.entries(adjusted)) {
      cumulative += prob;
      if (rng <= cumulative) return mode as any;
    }
    return 'explore';
  }
}

/**
 * Create an autonomous agent engine instance
 */
export function createAutonomousAgentEngine(config: AgentConfig): AutonomousAgentEngine {
  return new AutonomousAgentEngine(config);
}

