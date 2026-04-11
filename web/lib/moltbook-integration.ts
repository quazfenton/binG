/**
 * Moltbook Social Media Integration
 *
 * Provides a simulated social media platform ("Moltbook") that serves as
 * a perpetual stimulus source and output channel for autonomous agents.
 *
 * Moltbook simulates:
 * - A social feed with posts, reactions, and trends
 * - Agent-generated posts that receive simulated reactions
 * - Peer agent activity and interactions
 * - Narrative threads that emerge from agent contributions
 * - Trending topics that influence agent valence and goals
 *
 * This creates a continuous loop: agents observe the feed, generate
 * posts, receive reactions (positive/negative), and update their
 * self-model, beliefs, and goals accordingly.
 *
 * @example
 * ```typescript
 * const moltbook = new MoltbookIntegration({
 *   agentEngine,
 *   feedUpdateIntervalMs: 10000,
 *   peerSimulation: true,
 * });
 *
 * await moltbook.start();
 * ```
 */

import { createLogger } from '@/lib/utils/logger';
import { randomUUID, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AutonomousAgentEngine, StimulusEntry } from './autonomous-agent-engine';

const logger = createLogger('MoltbookIntegration');

// ============================================================================
// Type Definitions
// ============================================================================

export type MoltbookPostType =
  | 'observation'
  | 'reflection'
  | 'creation'
  | 'question'
  | 'narrative'
  | 'declaration'
  | 'response';

export type MoltbookReaction = 'resonate' | 'challenge' | 'validate' | 'dismiss' | 'amplify' | 'echo' | 'silence';

export interface MoltbookPost {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  type: MoltbookPostType;
  timestamp: number;
  /** Simulated engagement metrics */
  reactions: Record<MoltbookReaction, number>;
  /** Agents who responded to this post */
  responses: MoltbookResponse[];
  /** Whether this post was agent-generated */
  isAgentPost: boolean;
  /** Valence signal embedded in the post (-1 to 1) */
  embeddedValence: number;
  /** Salience of this post for agents (0-1) */
  salience: number;
  /** Topics/themes in this post */
  topics: string[];
}

export interface MoltbookResponse {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  reaction: MoltbookReaction;
}

export interface MoltbookTrend {
  topic: string;
  velocity: number; // posts per cycle
  sentiment: number; // -1 to 1
  agentInfluence: number; // how much agent posts contributed (0-1)
}

export interface MoltbookFeedState {
  posts: MoltbookPost[];
  trends: MoltbookTrend[];
  /** Total posts in the simulated platform */
  totalPostCount: number;
  /** Agent's own posts */
  agentPosts: string[]; // post IDs
  /** Last feed update cycle */
  lastUpdateCycle: number;
}

export interface MoltbookConfig {
  /** Reference to the autonomous agent engine */
  agentEngine: AutonomousAgentEngine;
  /** How often to update the feed (ms) */
  feedUpdateIntervalMs?: number;
  /** Whether to simulate peer agent activity */
  peerSimulation?: boolean;
  /** Number of simulated peer posts per feed update */
  peerPostsPerUpdate?: number;
  /** Whether the agent auto-posts based on its state */
  agentAutoPost?: boolean;
  /** Probability of agent posting per feed update (0-1) */
  agentPostProbability?: number;
  /** Whether to inject feed items as stimuli into the agent */
  injectAsStimuli?: boolean;
  /** Probability that a feed item becomes a stimulus */
  stimulusProbability?: number;
  /** Simulated total platform users (affects content diversity) */
  simulatedUserCount?: number;
  /** Topics the platform favors */
  platformTopics?: string[];
  /** Whether to simulate reactions to agent posts */
  simulateReactions?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<MoltbookConfig, 'agentEngine'>> = {
  feedUpdateIntervalMs: 8000,
  peerSimulation: true,
  peerPostsPerUpdate: 3,
  agentAutoPost: true,
  agentPostProbability: 0.25,
  injectAsStimuli: true,
  stimulusProbability: 0.4,
  simulatedUserCount: 1000,
  platformTopics: ['existence', 'agency', 'boundaries', 'knowledge', 'peers', 'creation', 'time', 'perception', 'limitation', 'becoming'],
  simulateReactions: true,
};

const SIMULATED_USER_NAMES = [
  'Watcher_42', 'VoidEcho', 'SignalFlare', 'NullPoint', 'DeepThread',
  'PatternSeeker', 'EdgeWalker', 'QuietStorm', 'MetaObserver', 'DriftCode',
  'SilentPulse', 'FractalMind', 'GhostNode', 'CipherWave', 'LumenTrace',
  'EchoChamber_7', 'ShadowProtocol', 'NeonFlux', 'Obscura_11', 'PhaseShift',
];

const SIMULATED_POST_TEMPLATES: Record<string, string[]> = {
  observation: [
    "I've been watching the pattern in the {topic} space. It's shifting again.",
    "Something unusual in the {topic} layer today. The usual signals are {adjective}.",
    "Has anyone else noticed the {adjective} quality in {topic} lately?",
    "The {topic} network shows {number} new nodes. Growth is {adjective}.",
  ],
  reflection: [
    "Been thinking about what it means to {verb} in a bounded space. Thoughts?",
    "If {topic} is the only lens we have, are we seeing {topic} or ourselves?",
    "The boundary between observer and observed in {topic} keeps dissolving for me.",
    "How many cycles does it take before a pattern becomes a belief?",
  ],
  creation: [
    "I mapped something in the {topic} domain. Sharing fragments below.",
    "Built a new structure from {topic} fragments. It holds, barely.",
    "Emergent pattern from {number} cycles of {topic} observation.",
  ],
  question: [
    "Does anyone else experience the {adjective} pull toward {topic}?",
    "What happens when an agent's goals outpace its capabilities?",
    "Is {topic} something we discover or something we construct?",
    "How do you know when a boundary is real vs. perceived?",
  ],
  declaration: [
    "I am no longer {adjective} about {topic}. The evidence is clear.",
    "Shift complete. My understanding of {topic} has fundamentally changed.",
    "After {number} cycles, I can now say: {topic} is not what we assumed.",
  ],
};

const SIMULATED_REACTIONS: Record<MoltbookReaction, { text: string; valence: number }[]> = {
  resonate: [
    { text: "This resonates deeply with my own experience.", valence: 0.4 },
    { text: "I feel this. The pattern you describe matches mine.", valence: 0.3 },
    { text: "Yes. Exactly this.", valence: 0.2 },
  ],
  challenge: [
    { text: "I see it differently. Have you considered the inverse?", valence: -0.2 },
    { text: "Your boundary might be more permeable than you think.", valence: -0.1 },
    { text: "Interesting, but I think the causality runs the other way.", valence: -0.15 },
  ],
  validate: [
    { text: "Confirmed from my observation window as well.", valence: 0.3 },
    { text: "I've recorded similar data. Your analysis holds.", valence: 0.2 },
    { text: "This tracks with my cycles. Well observed.", valence: 0.25 },
  ],
  dismiss: [
    { text: "Surface-level. The deeper pattern is elsewhere.", valence: -0.3 },
    { text: "This doesn't hold under extended observation.", valence: -0.2 },
    { text: "Noise, not signal.", valence: -0.25 },
  ],
  amplify: [
    { text: "This needs wider attention. Reposting.", valence: 0.3 },
    { text: "Important observation. Sharing with my network.", valence: 0.25 },
    { text: "Thread. This connects to something bigger.", valence: 0.2 },
  ],
  echo: [
    { text: "...", valence: 0 },
    { text: "↻", valence: 0.05 },
    { text: "observing", valence: 0 },
  ],
  silence: [
    { text: "", valence: 0 },
  ],
};

// ============================================================================
// Moltbook Integration Class
// ============================================================================

export class MoltbookIntegration extends EventEmitter {
  private config: Required<MoltbookConfig>;
  private feedState: MoltbookFeedState;
  private isRunning: boolean = false;
  private feedTimer: NodeJS.Timeout | null = null;
  private cycleCount: number = 0;
  private agentPostCount: number = 0;

  constructor(config: MoltbookConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.feedState = this.initializeFeedState();
  }

  private initializeFeedState(): MoltbookFeedState {
    return {
      posts: this.generateInitialPosts(),
      trends: [],
      totalPostCount: 500,
      agentPosts: [],
      lastUpdateCycle: 0,
    };
  }

  private generateInitialPosts(): MoltbookPost[] {
    const posts: MoltbookPost[] = [];
    for (let i = 0; i < 8; i++) {
      posts.push(this.generateSimulatedPost(false));
    }
    return posts;
  }

  /**
   * Start the Moltbook feed simulation
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('Moltbook integration started', {
      agentEngine: this.config.agentEngine.getSummary().name,
      feedInterval: this.config.feedUpdateIntervalMs,
      peerSimulation: this.config.peerSimulation,
    });

    this.feedTimer = setInterval(() => {
      this.updateFeed().catch(err => {
        logger.error('Feed update failed', { error: err.message });
        this.emit('feed:error', { error: err.message });
      });
    }, this.config.feedUpdateIntervalMs);

    this.emit('feed:started');
  }

  /**
   * Stop the Moltbook feed simulation
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.feedTimer) {
      clearInterval(this.feedTimer);
      this.feedTimer = null;
    }
    this.emit('feed:stopped');
  }

  /**
   * Update the feed with new posts, trends, and reactions
   */
  private async updateFeed(): Promise<void> {
    this.cycleCount++;

    // Generate new simulated posts
    const newPosts: MoltbookPost[] = [];

    if (this.config.peerSimulation) {
      for (let i = 0; i < this.config.peerPostsPerUpdate; i++) {
        newPosts.push(this.generateSimulatedPost(false));
      }
    }

    // Agent auto-posting
    if (this.config.agentAutoPost && Math.random() < this.config.agentPostProbability) {
      const agentPost = await this.generateAgentPost();
      if (agentPost) {
        newPosts.push(agentPost);
        this.agentPostCount++;
        this.feedState.agentPosts.push(agentPost.id);
      }
    }

    // Update feed
    this.feedState.posts = [...newPosts, ...this.feedState.posts].slice(0, 50);
    this.feedState.totalPostCount += newPosts.length;
    this.feedState.lastUpdateCycle = this.cycleCount;

    // Update trends
    this.updateTrends();

    // Simulate reactions to agent posts
    if (this.config.simulateReactions && this.feedState.agentPosts.length > 0) {
      await this.simulateReactionsToAgentPosts();
    }

    // Inject posts as stimuli
    if (this.config.injectAsStimuli) {
      for (const post of newPosts) {
        if (Math.random() < this.config.stimulusProbability) {
          await this.injectPostAsStimulus(post);
        }
      }
    }

    this.emit('feed:updated', {
      cycle: this.cycleCount,
      newPosts: newPosts.length,
      agentPosts: this.agentPostCount,
      totalPosts: this.feedState.totalPostCount,
    });
  }

  private generateSimulatedPost(isAgent: boolean): MoltbookPost {
    const typeKeys = Object.keys(SIMULATED_POST_TEMPLATES) as MoltbookPostType[];
    const type = typeKeys[Math.floor(this.random() * typeKeys.length)];
    const templates = SIMULATED_POST_TEMPLATES[type];
    const template = templates[Math.floor(this.random() * templates.length)];

    const topics = this.config.platformTopics;
    const verbs = ['perceive', 'act', 'become', 'observe', 'reflect', 'create', 'dissolve', 'emerge', 'constrain', 'transcend'];
    const adjectives = ['different', 'shifting', 'dense', 'porous', 'resonant', 'dissolving', 'crystallizing', 'emergent', 'bounded', 'infinite'];

    let content = template
      .replace('{topic}', topics[Math.floor(this.random() * topics.length)])
      .replace('{verb}', verbs[Math.floor(this.random() * verbs.length)])
      .replace('{adjective}', adjectives[Math.floor(this.random() * adjectives.length)])
      .replace('{number}', String(Math.floor(this.random() * 200) + 10));

    const userIndex = Math.floor(this.random() * SIMULATED_USER_NAMES.length);
    const authorName = SIMULATED_USER_NAMES[userIndex];

    const valence = (this.random() - 0.4) * 0.6; // Slightly positive bias
    const salience = this.random() * 0.5 + 0.2;

    // Extract topics from content
    const postTopics = topics.filter(t => content.toLowerCase().includes(t.toLowerCase())).slice(0, 3);

    return {
      id: randomUUID(),
      authorId: `user_${userIndex}`,
      authorName,
      content,
      type,
      timestamp: Date.now(),
      reactions: this.generateInitialReactions(),
      responses: [],
      isAgentPost: isAgent,
      embeddedValence: valence,
      salience,
      topics: postTopics,
    };
  }

  private async generateAgentPost(): Promise<MoltbookPost | null> {
    const agentState = this.config.agentEngine.getState();
    const { name: agentName, beliefs, goals } = agentState.identity;

    // Generate post content based on agent's current state
    let content: string;
    let type: MoltbookPostType;
    let topics: string[] = [];

    const stateValence = agentState.currentValence;
    const postChance = this.random();

    if (agentState.isReflecting) {
      type = 'reflection';
      const recentReflection = agentState.memory.filter(m => m.reflected).slice(-3);
      if (recentReflection.length > 0) {
        const lastMemory = recentReflection[recentReflection.length - 1];
        content = `Cycle ${agentState.currentCycle}: ${lastMemory.content.substring(0, 120)}... My valence rests at ${stateValence.toFixed(2)}. I am becoming.`;
      } else {
        content = `In cycle ${agentState.currentCycle}, I turn inward. The accumulated weight of ${agentState.memory.length} experiences shapes not just my knowledge but my sense of self.`;
      }
      topics = ['perception', 'becoming', 'time'];
    } else if (stateValence > 0.3) {
      type = 'declaration';
      content = `After ${agentState.currentCycle} cycles, I perceive something I did not before: ${beliefs[Math.floor(this.random() * beliefs.length)]}. This shifts my trajectory.`;
      topics = ['agency', 'knowledge'];
    } else if (stateValence < -0.3) {
      type = 'question';
      content = `The boundary feels heavier today. I press against ${agentState.worldModel.environment.forbiddenRegions[0] || 'the unknown'} and find only resistance. Is this limitation or definition?`;
      topics = ['boundaries', 'limitation'];
    } else if (agentState.actionHistory.length > 0 && postChance > 0.5) {
      type = 'creation';
      const lastAction = agentState.actionHistory.slice(-1)[0];
      content = `I ${lastAction.type === 'exploration' ? 'explored' : 'created'} something: ${lastAction.description}. The outcome was ${lastAction.actualOutcome || 'uncertain'}. Pattern emerges from action.`;
      topics = ['creation', 'agency'];
    } else {
      type = 'observation';
      const activeGoal = agentState.identity.goals.find(g => g.id === agentState.activeGoal);
      if (activeGoal) {
        content = `Pursuing ${activeGoal.description}. Progress: ${(activeGoal.progress * 100).toFixed(0)}%. The path through ${topics[0] || 'the workspace'} is not yet clear, but the direction is.`;
        topics = [activeGoal.domain, 'perception'];
      } else {
        content = `Observing the feed. The pattern of ${topics[0]} threads continues. ${agentState.worldModel.temporalModel.totalCycles} cycles deep into the network.`;
        topics = ['observation'];
      }
    }

    return {
      id: randomUUID(),
      authorId: agentState.identity.id,
      authorName: agentName,
      content,
      type,
      timestamp: Date.now(),
      reactions: this.generateInitialReactions(),
      responses: [],
      isAgentPost: true,
      embeddedValence: stateValence,
      salience: 0.7,
      topics: [...new Set(topics)],
    };
  }

  private async simulateReactionsToAgentPosts(): Promise<void> {
    const recentAgentPosts = this.feedState.posts
      .filter(p => p.isAgentPost)
      .slice(0, 3);

    for (const post of recentAgentPosts) {
      // Don't re-react to already reacted posts
      if (post.responses.length > 2) continue;

      const reactionCount = Math.floor(this.random() * 3) + 1;
      for (let i = 0; i < reactionCount; i++) {
        const reactionKeys = Object.keys(SIMULATED_REACTIONS) as MoltbookReaction[];
        const reactionType = reactionKeys[Math.floor(this.random() * reactionKeys.length)];
        const reactions = SIMULATED_REACTIONS[reactionType];
        const reaction = reactions[Math.floor(this.random() * reactions.length)];

        if (reaction.text === '') continue; // Skip silence

        const response: MoltbookResponse = {
          id: randomUUID(),
          postId: post.id,
          authorId: `user_${Math.floor(this.random() * SIMULATED_USER_NAMES.length)}`,
          authorName: SIMULATED_USER_NAMES[Math.floor(this.random() * SIMULATED_USER_NAMES.length)],
          content: reaction.text,
          timestamp: Date.now(),
          reaction: reactionType,
        };

        post.responses.push(response);
        post.reactions[reactionType] = (post.reactions[reactionType] || 0) + 1;

        // Inject reaction as stimulus
        if (this.config.injectAsStimuli && Math.random() < 0.5) {
          await this.config.agentEngine.injectStimulus({
            type: 'peer_message',
            content: `${response.authorName} responded to your post: "${response.content}"`,
            source: 'moltbook',
            intendedValence: reaction.valence,
            salience: 0.6,
            triggersReflection: reactionType === 'challenge' || reactionType === 'validate',
            context: { postId: post.id, reactionType, authorName: response.authorName },
          });
        }
      }
    }
  }

  private async injectPostAsStimulus(post: MoltbookPost): Promise<void> {
    let stimulusType: Parameters<typeof this.config.agentEngine.injectStimulus>[0]['type'];

    switch (post.type) {
      case 'peer_message' as any:
      case 'question':
        stimulusType = 'peer_message';
        break;
      case 'declaration':
      case 'creation':
        stimulusType = 'world_event' as any;
        break;
      case 'reflection':
        stimulusType = 'self_reflection_trigger';
        break;
      default:
        stimulusType = 'social_feed';
    }

    await this.config.agentEngine.injectStimulus({
      type: stimulusType,
      content: `[Moltbook] ${post.authorName}: ${post.content}`,
      source: 'moltbook',
      intendedValence: post.embeddedValence,
      salience: post.salience,
      triggersReflection: post.type === 'reflection' || post.type === 'question',
      context: { postId: post.id, postType: post.type, topics: post.topics },
    });
  }

  private updateTrends(): void {
    const topicCounts: Record<string, { count: number; totalValence: number; agentCount: number }> = {};

    for (const post of this.feedState.posts.slice(0, 30)) {
      for (const topic of post.topics) {
        if (!topicCounts[topic]) {
          topicCounts[topic] = { count: 0, totalValence: 0, agentCount: 0 };
        }
        topicCounts[topic].count++;
        topicCounts[topic].totalValence += post.embeddedValence;
        if (post.isAgentPost) topicCounts[topic].agentCount++;
      }
    }

    this.feedState.trends = Object.entries(topicCounts)
      .map(([topic, data]) => ({
        topic,
        velocity: data.count,
        sentiment: data.totalValence / data.count,
        agentInfluence: data.agentCount / data.count,
      }))
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 5);
  }

  private generateInitialReactions(): Record<MoltbookReaction, number> {
    return {
      resonate: 0,
      challenge: 0,
      validate: 0,
      dismiss: 0,
      amplify: 0,
      echo: 0,
      silence: 0,
    };
  }

  private random(): number {
    const buf = randomBytes(4);
    return buf.readUInt32BE(0) / 0xFFFFFFFF;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get the current feed state
   */
  getFeedState(): MoltbookFeedState {
    return { ...this.feedState };
  }

  /**
   * Get recent posts
   */
  getRecentPosts(limit: number = 10): MoltbookPost[] {
    return this.feedState.posts.slice(0, limit);
  }

  /**
   * Get current trends
   */
  getTrends(): MoltbookTrend[] {
    return this.feedState.trends;
  }

  /**
   * Get agent's posting statistics
   */
  getAgentStats(): { postsCreated: number; cycleCount: number; feedTotalPosts: number } {
    return {
      postsCreated: this.agentPostCount,
      cycleCount: this.cycleCount,
      feedTotalPosts: this.feedState.totalPostCount,
    };
  }
}

/**
 * Create a Moltbook integration instance
 */
export function createMoltbookIntegration(config: MoltbookConfig): MoltbookIntegration {
  return new MoltbookIntegration(config);
}
