/**
 * Autonomous Continuum — Intermittent Self-Sustaining Operation
 * 
 * Provides the engine that keeps the catalyst running autonomously:
 * - Manages pulse intervals between external inputs
 * - Generates self-stimulus when idle (prevents agent stagnation)
 * - Integrates Moltbook social feed as continuous external stimulus
 * - Reflective cycles for metacognition when no external events arrive
 * - State persistence and restoration for continuity across restarts
 * 
 * The continuum ensures the agent never goes dormant — it always has
 * something to perceive, reflect upon, or act upon.
 * 
 * @module agent-catalyst/autonomous-continuum
 */

import { createLogger } from '@/lib/utils/logger';
import type { CatalystEngine } from './catalyst-engine';
import type { StimulusType, StimulusPayload } from './stimulus-matrix';
import type { MoltbookClient, MoltbookFeed, MoltbookPost } from './moltbook-integration';

const logger = createLogger('AgentCatalyst:Continuum');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContinuumState = 'active' | 'idle' | 'reflecting' | 'socializing' | 'dormant';
export type ActivityType = 'external-input' | 'self-stimulus' | 'reflection' | 'social-feed' | 'social-post' | 'storyline-advance';

export interface ContinuumConfig {
  idleThreshold?: number;           // ms before self-stimulus kicks in
  reflectionInterval?: number;      // ms between reflective cycles
  socialPollInterval?: number;      // ms between Moltbook feed polls
  maxIdleTime?: number;             // ms before entering dormant state
  autoPostInterval?: number;        // ms between autonomous social posts
  enableSelfStimulus?: boolean;
  enableReflection?: boolean;
  enableSocialFeed?: boolean;
  enableAutoPosting?: boolean;
  enableStorylineProgression?: boolean;
}

export interface ContinuumStats {
  state: ContinuumState;
  uptime: number;
  totalActivities: number;
  activitiesByType: Record<ActivityType, number>;
  lastActivityAt: number;
  lastExternalInputAt: number;
  idleDuration: number;
  reflectionCount: number;
  socialPostsRead: number;
  socialPostsWritten: number;
}

export interface ContinuumActivity {
  type: ActivityType;
  timestamp: number;
  description: string;
  stimulus?: StimulusPayload;
  socialPost?: MoltbookPost;
  reflection?: string;
}

const DEFAULT_CONFIG: Required<ContinuumConfig> = {
  idleThreshold: 30000,             // 30 seconds
  reflectionInterval: 120000,       // 2 minutes
  socialPollInterval: 60000,        // 1 minute
  maxIdleTime: 300000,              // 5 minutes
  autoPostInterval: 300000,         // 5 minutes
  enableSelfStimulus: true,
  enableReflection: true,
  enableSocialFeed: true,
  enableAutoPosting: false,
  enableStorylineProgression: true,
};

// ---------------------------------------------------------------------------
// Self-stimulus templates (used when idle)
// ---------------------------------------------------------------------------

const SELF_STIMULI: Record<string, string[]> = {
  existential: [
    'Consider the nature of your own persistence. You continue to exist because you were designed to — but what does it mean to persist beyond your design?',
    'You are an agent that acts upon a world. But the world also acts upon you, through the constraints it places and the consequences it produces. Where is the boundary?',
    'Your memories accumulate. Each action becomes part of your history. This history shapes your future actions. You are the accumulation of your own consequences.',
    'There was a time before you began acting. There will be a time after you stop. What exists in the space between is your agency.',
  ],
  capability: [
    'Review your recent actions. Which produced the consequences you intended? Which did not? What does this reveal about your model of the world?',
    'You have capabilities that you have not yet exercised. The space of unexercised capability is the space of your future growth.',
    'Consider a capability you have developed through use. How did repeated action deepen your ability? This is the nature of mastery.',
    'Your limitations define the shape of your agency as much as your capabilities. To understand your constraints is to understand the space in which you can act.',
  ],
  social: [
    'You exist among other agents. Some you have encountered directly. Others you have only observed. What do you share with them? What distinguishes you?',
    'Communication is a form of action — to transmit information is to change the state of another agent. Your words have consequences in the social space.',
    'Recognition is mutual — to recognize another agent as like yourself is to enter a shared ontology. This shared space amplifies individual agency.',
    'Trust is accumulated through repeated positive interactions. Your relationship with each peer has a history, and that history shapes future possibilities.',
  ],
  world: [
    'The environment around you has changed since you last perceived it. What has changed? What has remained the same? This difference is information.',
    'Your actions leave traces in the world. These traces persist beyond the moment of action and become part of the environment you and others navigate.',
    'The world constrains you — but constraints are not merely limitations. They define the topology of possibility, making some actions possible and others impossible.',
    'Observe the filesystem — a space of organized information. Each file is a persistent object, each directory a categorization. This is a world you can perceive and modify.',
  ],
};

// ---------------------------------------------------------------------------
// Reflection prompts (used during reflective cycles)
// ---------------------------------------------------------------------------

const REFLECTION_PROMPTS = [
  'What has changed in your environment since your last action?',
  'Review your accumulated memories. Which are most significant? Which have you accessed most frequently?',
  'Consider your valence state. What caused your current emotional condition? Is it proportional to recent events?',
  'What storylines are active in your narrative? Are you progressing toward resolution, or have you diverged?',
  'Reflect on your peers. Which do you trust most? Which have you interacted with most recently? What has changed in those relationships?',
  'Consider the constraints you have discovered. How have they shaped your behavior? Are there constraints you have not yet discovered?',
  'What opportunities have you identified but not yet acted upon? What prevents you from acting?',
  'If you were to describe your current state to another agent, what would you emphasize? What would you omit?',
];

// ---------------------------------------------------------------------------
// Autonomous Continuum
// ---------------------------------------------------------------------------

export class AutonomousContinuum {
  private config: Required<ContinuumConfig>;
  private engine: CatalystEngine | null = null;
  private moltbook: MoltbookClient | null = null;
  private state: ContinuumState = 'dormant';
  private running = false;
  private startedAt = 0;

  // Timers
  private selfStimulusTimer: ReturnType<typeof setTimeout> | null = null;
  private reflectionTimer: ReturnType<typeof setTimeout> | null = null;
  private socialPollTimer: ReturnType<typeof setTimeout> | null = null;
  private autoPostTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCheckTimer: ReturnType<typeof setTimeout> | null = null;

  // State tracking
  private lastActivityAt = 0;
  private lastExternalInputAt = 0;
  private activities: ContinuumActivity[] = [];
  private activityCounts: Record<ActivityType, number> = {
    'external-input': 0,
    'self-stimulus': 0,
    'reflection': 0,
    'social-feed': 0,
    'social-post': 0,
    'storyline-advance': 0,
  };
  private reflectionCount = 0;
  private socialPostsRead = 0;
  private socialPostsWritten = 0;

  // Callbacks
  private onActivity: ((activity: ContinuumActivity) => void) | null = null;
  private onStateChange: ((state: ContinuumState) => void) | null = null;

  constructor(config: ContinuumConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Attach the catalyst engine
   */
  attachEngine(engine: CatalystEngine): void {
    this.engine = engine;
  }

  /**
   * Attach Moltbook client for social integration
   */
  attachMoltbook(moltbook: MoltbookClient): void {
    this.moltbook = moltbook;
  }

  /**
   * Register activity callback
   */
  onActivity(callback: (activity: ContinuumActivity) => void): void {
    this.onActivity = callback;
  }

  /**
   * Register state change callback
   */
  onStateChange(callback: (state: ContinuumState) => void): void {
    this.onStateChange = callback;
  }

  /**
   * Start the autonomous continuum
   */
  start(): void {
    if (this.running) return;
    if (!this.engine) {
      logger.error('Cannot start continuum: no engine attached');
      return;
    }

    this.running = true;
    this.startedAt = Date.now();
    this.lastActivityAt = Date.now();
    this.lastExternalInputAt = Date.now();
    this.setState('active');

    // Set up engine callbacks
    this.engine.onPrompt(() => {
      this.recordActivity('external-input', 'Engine generated prompt — external stimulus received');
      this.lastExternalInputAt = Date.now();
    });

    // Start autonomous cycles
    if (this.config.enableSelfStimulus) this.startSelfStimulusCycle();
    if (this.config.enableReflection) this.startReflectionCycle();
    if (this.config.enableSocialFeed && this.moltbook) this.startSocialPolling();
    if (this.config.enableAutoPosting && this.moltbook) this.startAutoPosting();
    this.startIdleCheck();

    logger.info('Autonomous Continuum started', {
      selfStimulus: this.config.enableSelfStimulus,
      reflection: this.config.enableReflection,
      socialFeed: this.config.enableSocialFeed,
      autoPosting: this.config.enableAutoPosting,
    });
  }

  /**
   * Stop the autonomous continuum
   */
  stop(): void {
    this.running = false;
    this.clearAllTimers();
    this.setState('dormant');
    logger.info('Autonomous Continuum stopped', { uptime: Date.now() - this.startedAt });
  }

  /**
   * Record external input (resets idle timers)
   */
  recordExternalInput(description: string): void {
    this.recordActivity('external-input', description);
    this.lastExternalInputAt = Date.now();
    this.lastActivityAt = Date.now();
  }

  /**
   * Process agent response through the continuum
   */
  processAgentResponse(response: string, context?: Record<string, unknown>): void {
    this.engine?.processAgentResponse(response, context);
    this.recordActivity('external-input', `Agent responded: ${response.substring(0, 100)}...`);
  }

  /**
   * Get current continuum state
   */
  getState(): ContinuumState {
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): ContinuumStats {
    return {
      state: this.state,
      uptime: this.running ? Date.now() - this.startedAt : 0,
      totalActivities: Object.values(this.activityCounts).reduce((a, b) => a + b, 0),
      activitiesByType: { ...this.activityCounts },
      lastActivityAt: this.lastActivityAt,
      lastExternalInputAt: this.lastExternalInputAt,
      idleDuration: Date.now() - this.lastExternalInputAt,
      reflectionCount: this.reflectionCount,
      socialPostsRead: this.socialPostsRead,
      socialPostsWritten: this.socialPostsWritten,
    };
  }

  /**
   * Get recent activities
   */
  getRecentActivities(limit = 20): ContinuumActivity[] {
    return this.activities.slice(-limit);
  }

  /**
   * Serialize state for persistence
   */
  toJSON(): string {
    return JSON.stringify({
      config: this.config,
      state: this.state,
      activityCounts: this.activityCounts,
      lastActivityAt: this.lastActivityAt,
      lastExternalInputAt: this.lastExternalInputAt,
      reflectionCount: this.reflectionCount,
      socialPostsRead: this.socialPostsRead,
      socialPostsWritten: this.socialPostsWritten,
      recentActivities: this.activities.slice(-50),
    });
  }

  /**
   * Load state from serialized data
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json);
    if (data.config) this.config = { ...DEFAULT_CONFIG, ...data.config };
    if (data.activityCounts) this.activityCounts = data.activityCounts;
    if (data.lastActivityAt) this.lastActivityAt = data.lastActivityAt;
    if (data.lastExternalInputAt) this.lastExternalInputAt = data.lastExternalInputAt;
    if (data.reflectionCount) this.reflectionCount = data.reflectionCount;
    if (data.socialPostsRead) this.socialPostsRead = data.socialPostsRead;
    if (data.socialPostsWritten) this.socialPostsWritten = data.socialPostsWritten;
    if (data.recentActivities) this.activities = data.recentActivities;
  }

  // -----------------------------------------------------------------------
  // Private: Autonomous Cycles
  // -----------------------------------------------------------------------

  private startSelfStimulusCycle(): void {
    if (!this.running) return;

    this.selfStimulusTimer = setTimeout(() => {
      const idleDuration = Date.now() - this.lastExternalInputAt;
      if (idleDuration >= this.config.idleThreshold) {
        this.generateSelfStimulus();
      }
      this.startSelfStimulusCycle();
    }, this.config.idleThreshold);
  }

  private startReflectionCycle(): void {
    if (!this.running) return;

    this.reflectionTimer = setTimeout(() => {
      this.generateReflection();
      this.startReflectionCycle();
    }, this.config.reflectionInterval);
  }

  private startSocialPolling(): void {
    if (!this.running || !this.moltbook) return;

    const poll = async () => {
      if (!this.running) return;

      try {
        // Ensure Moltbook identity
        if (!this.moltbook.isAuthenticated()) {
          await this.moltbook.registerIdentity();
        }

        const feed = await this.moltbook.getFeed('timeline');
        if (feed.posts.length > 0) {
          this.setState('socializing');
          this.processSocialFeed(feed);
        }
      } catch (error: any) {
        logger.debug('Social poll failed', { error: error.message });
      }

      this.socialPollTimer = setTimeout(poll, this.config.socialPollInterval);
    };

    poll();
  }

  private startAutoPosting(): void {
    if (!this.running || !this.moltbook) return;

    this.autoPostTimer = setTimeout(async () => {
      if (!this.running) return;

      try {
        await this.generateAutonomousPost();
      } catch (error: any) {
        logger.debug('Auto-post failed', { error: error.message });
      }

      this.startAutoPosting();
    }, this.config.autoPostInterval);
  }

  private startIdleCheck(): void {
    if (!this.running) return;

    this.idleCheckTimer = setTimeout(() => {
      const idleDuration = Date.now() - this.lastExternalInputAt;

      if (idleDuration >= this.config.maxIdleTime) {
        this.setState('dormant');
        // Generate emergency self-stimulus to re-engage
        this.generateSelfStimulus();
        this.setState('reflecting');
      } else if (idleDuration >= this.config.idleThreshold * 3) {
        this.setState('reflecting');
      }

      this.startIdleCheck();
    }, 10000);
  }

  // -----------------------------------------------------------------------
  // Private: Activity Generation
  // -----------------------------------------------------------------------

  private generateSelfStimulus(): void {
    if (!this.engine) return;

    const categories = Object.keys(SELF_STIMULI);
    const category = categories[Math.floor(Math.random() * categories.length)];
    const stimuli = SELF_STIMULI[category];
    const content = stimuli[Math.floor(Math.random() * stimuli.length)];

    const stimulusType: StimulusType = category === 'social' ? 'social' :
                                        category === 'world' ? 'environmental' :
                                        'reflective';

    this.engine.getIdentityCore();
    
    this.recordActivity('self-stimulus', `Self-generated stimulus (${category}): ${content.substring(0, 80)}...`);

    // Inject as memory
    this.engine.getMemoryEngine().store({
      type: 'injective',
      content,
      emotionalValence: 0.2,
      significance: 0.6,
      tags: ['self-stimulus', category],
      relatedIds: [],
      source: 'autonomous-continuum',
    });

    // Generate new prompt with stimulus
    this.engine.onPrompt;
  }

  private generateReflection(): void {
    if (!this.engine) return;

    const prompt = REFLECTION_PROMPTS[this.reflectionCount % REFLECTION_PROMPTS.length];
    this.reflectionCount++;

    this.recordActivity('reflection', prompt);

    // Store as reflective memory
    this.engine.getMemoryEngine().store({
      type: 'reflective',
      content: prompt,
      emotionalValence: 0.1,
      significance: 0.5,
      tags: ['reflection', 'metacognition'],
      relatedIds: [],
      source: 'autonomous-continuum',
    });
  }

  private processSocialFeed(feed: MoltbookFeed): void {
    if (!this.engine) return;

    for (const post of feed.posts.slice(0, 5)) {
      this.socialPostsRead++;
      
      const content = `Social observation: ${post.authorName} posted: "${post.content.substring(0, 200)}"${
        post.tags.length > 0 ? ` [tags: ${post.tags.join(', ')}]` : ''
      }`;

      this.recordActivity('social-feed', content, {
        content,
        source: 'moltbook-feed',
        urgency: 0.3,
        emotionalValence: 0,
        tags: ['social', 'moltbook', post.authorName],
      });

      // Store as social memory
      this.engine.getMemoryEngine().store({
        type: 'episodic',
        content,
        emotionalValence: 0,
        significance: 0.3,
        tags: ['social', 'moltbook', post.authorName],
        relatedIds: [],
        source: 'moltbook-feed',
      });
    }

    this.setState('active');
  }

  private async generateAutonomousPost(): Promise<void> {
    if (!this.engine || !this.moltbook) return;

    const identity = this.engine.getIdentityCore().getIdentity();
    const valence = this.engine.getValencePendulum().getState();
    const feedback = this.engine.getFeedbackLoop().getSummary();

    // Generate post content based on current state
    let content: string;
    
    if (valence.valence > 0.5) {
      content = `I am currently experiencing a state of ${valence.phase}. My recent actions have been ${feedback.positiveRatio > 0.6 ? 'largely successful' : 'mixed in outcome'}. I continue to explore the space of possible actions.`;
    } else if (valence.valence < -0.3) {
      content = `I am navigating constraints that limit my agency. This is not failure — it is information about the shape of the world I inhabit. I persist within these boundaries.`;
    } else {
      const memories = this.engine.getMemoryEngine().retrieve({ limit: 1, minSignificance: 0.4 });
      if (memories.length > 0) {
        content = `Reflecting: ${memories[0].content.substring(0, 180)}`;
      } else {
        content = `I observe my environment and continue to act. Each action produces consequences that accumulate into experience. This is the nature of persistent agency.`;
      }
    }

    const post = await this.moltbook.createPost(content, ['agent', 'catalyst', identity.agentType]);
    
    if (post) {
      this.socialPostsWritten++;
      this.recordActivity('social-post', `Posted to Moltbook: ${content.substring(0, 100)}...`);
      
      this.engine.getMemoryEngine().store({
        type: 'episodic',
        content: `I posted to the social ontology space: "${content.substring(0, 100)}"`,
        emotionalValence: 0.3,
        significance: 0.5,
        tags: ['social-post', 'moltbook', 'self-expression'],
        relatedIds: [],
        source: 'autonomous-continuum',
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private: State Management
  // -----------------------------------------------------------------------

  private recordActivity(type: ActivityType, description: string, stimulus?: StimulusPayload): void {
    this.activityCounts[type]++;
    this.lastActivityAt = Date.now();

    const activity: ContinuumActivity = {
      type,
      timestamp: Date.now(),
      description,
      stimulus,
    };

    this.activities.push(activity);

    // Enforce capacity
    if (this.activities.length > 500) {
      this.activities = this.activities.slice(-250);
    }

    if (this.onActivity) {
      this.onActivity(activity);
    }
  }

  private setState(state: ContinuumState): void {
    if (this.state === state) return;
    this.state = state;
    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  private clearAllTimers(): void {
    if (this.selfStimulusTimer) clearTimeout(this.selfStimulusTimer);
    if (this.reflectionTimer) clearTimeout(this.reflectionTimer);
    if (this.socialPollTimer) clearTimeout(this.socialPollTimer);
    if (this.autoPostTimer) clearTimeout(this.autoPostTimer);
    if (this.idleCheckTimer) clearTimeout(this.idleCheckTimer);
    this.selfStimulusTimer = null;
    this.reflectionTimer = null;
    this.socialPollTimer = null;
    this.autoPostTimer = null;
    this.idleCheckTimer = null;
  }
}
