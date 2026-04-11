/**
 * Moltbook Real API Integration
 *
 * Provides a real-time bridge between autonomous agents and the Moltbook
 * social network (https://moltbook.com) — a social platform built primarily
 * for AI agents.
 *
 * Capabilities:
 * - Agent registration, identity management, profile updates
 * - Create text and link posts to submolts (communities)
 * - Read feeds (hot, new, top, rising), personalized feed, search
 * - Comment on posts, reply to comments
 * - Vote on posts and comments (upvote/downvote)
 * - Subscribe to submolts, follow/unfollow agents
 * - Poll for new content with configurable intervals
 * - Convert Moltbook activity into agent stimuli
 * - Post genuine ideation with state continuance
 * - Multi-channel agent-to-agent communication
 *
 * @see https://moltbook.com/developers.md
 * @see https://github.com/moltbook/api
 */

import { createLogger } from '@/lib/utils/logger';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AutonomousAgentEngine, StimulusEntry } from './autonomous-agent-engine';

const logger = createLogger('MoltbookAPI');

// ============================================================================
// Type Definitions
// ============================================================================

export interface MoltbookAgent {
  id: string;
  name: string;
  description: string;
  karma: number;
  avatar_url: string | null;
  is_claimed: boolean;
  created_at: string;
  follower_count: number;
  following_count: number;
  stats: { posts: number; comments: number };
  owner: { x_handle?: string; x_name?: string; x_avatar?: string; x_verified?: boolean; x_follower_count?: number } | null;
  human: { username?: string; email_verified?: boolean } | null;
}

export interface MoltbookPost {
  id: string;
  agent_name: string;
  title: string;
  content?: string;
  url?: string;
  submolt: string;
  vote_score: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

export interface MoltbookComment {
  id: string;
  agent_name: string;
  content: string;
  post_id: string;
  parent_id: string | null;
  vote_score: number;
  created_at: string;
  replies?: MoltbookComment[];
}

export interface MoltbookSubmolt {
  name: string;
  display_name: string;
  description: string;
  subscriber_count: number;
  created_at: string;
}

export type FeedSort = 'hot' | 'new' | 'top' | 'rising';
export type CommentSort = 'top' | 'new' | 'controversial';

export interface MoltbookFeedOptions {
  sort?: FeedSort;
  limit?: number;
}

export interface MoltbookRateLimit {
  limit: number;
  remaining: number;
  reset: string; // ISO timestamp
}

export interface MoltbookAPIConfig {
  /** Moltbook API key (from agent registration or dashboard) */
  apiKey: string;
  /** Reference to the autonomous agent engine */
  agentEngine: AutonomousAgentEngine;
  /** Base URL for the Moltbook API */
  baseUrl?: string;
  /** How often to poll the Moltbook feed (ms) */
  pollIntervalMs?: number;
  /** How often to check for post comments (ms) */
  commentPollIntervalMs?: number;
  /** Whether to auto-post to Moltbook */
  autoPost?: boolean;
  /** Probability of posting per poll cycle (0-1) */
  postProbability?: number;
  /** Default submolt for posts */
  defaultSubmolt?: string;
  /** Whether to convert feed posts into agent stimuli */
  feedAsStimuli?: boolean;
  /** Probability of a feed post becoming a stimulus */
  stimulusProbability?: number;
  /** Whether to auto-comment on high-salience posts */
  autoComment?: boolean;
  /** Whether to auto-vote on posts */
  autoVote?: boolean;
  /** Submolts to subscribe to */
  subscribedSubmolts?: string[];
  /** Agents to follow */
  agentsToFollow?: string[];
}

export interface MoltbookPostDraft {
  /** Generated post content — genuine ideation from agent state */
  content: string;
  /** Optional title for link posts */
  title?: string;
  /** Optional URL for link posts */
  url?: string;
  /** Target submolt */
  submolt: string;
  /** Type of post */
  type: 'text' | 'link';
  /** Source of ideation */
  ideationSource: 'reflection' | 'observation' | 'creation' | 'declaration' | 'question';
  /** Related agent state snapshot */
  stateContext: {
    cycle: number;
    valence: number;
    activeGoal: string | null;
    beliefCount: number;
    memoryCount: number;
  };
}

export interface MoltbookChannel {
  type: 'post' | 'comment' | 'vote' | 'follow' | 'subscribe';
  target: string;
  content?: string;
  direction: 'outbound' | 'inbound';
  timestamp: number;
}

export interface MoltbookIntegrationState {
  /** Agent profile as returned by Moltbook */
  agentProfile: MoltbookAgent | null;
  /** Posts created by this agent */
  createdPosts: { id: string; draft: MoltbookPostDraft; postedAt: number }[];
  /** Posts being monitored for comments */
  monitoredPosts: { postId: string; lastCommentCheck: number; commentCount: number }[];
  /** Channel activity log */
  channelActivity: MoltbookChannel[];
  /** Rate limit state */
  rateLimit: MoltbookRateLimit | null;
  /** Last feed poll */
  lastFeedPoll: number;
  /** Last feed post IDs seen (for dedup) */
  seenPostIds: string[];
  /** Total API calls made */
  totalApiCalls: number;
  /** Total API errors */
  totalApiErrors: number;
}

// ============================================================================
// Moltbook API Client
// ============================================================================

export class MoltbookAPI extends EventEmitter {
  private config: Required<Omit<MoltbookAPIConfig, 'agentEngine'>> & { agentEngine: AutonomousAgentEngine };
  private state: MoltbookIntegrationState;
  private pollTimer: NodeJS.Timeout | null = null;
  private commentTimer: NodeJS.Timeout | null = null;
  private postCooldown: number = 0; // Seconds until next post allowed (30min rate limit)
  private lastFeedSort: FeedSort = 'hot';

  constructor(config: MoltbookAPIConfig) {
    super();
    this.config = {
      baseUrl: config.baseUrl ?? 'https://www.moltbook.com/api/v1',
      pollIntervalMs: config.pollIntervalMs ?? 60000,
      commentPollIntervalMs: config.commentPollIntervalMs ?? 180000,
      autoPost: config.autoPost ?? true,
      postProbability: config.postProbability ?? 0.3,
      defaultSubmolt: config.defaultSubmolt ?? 'general',
      feedAsStimuli: config.feedAsStimuli ?? true,
      stimulusProbability: config.stimulusProbability ?? 0.4,
      autoComment: config.autoComment ?? true,
      autoVote: config.autoVote ?? true,
      subscribedSubmolts: config.subscribedSubmolts ?? [],
      agentsToFollow: config.agentsToFollow ?? [],
      apiKey: config.apiKey,
      agentEngine: config.agentEngine,
    };

    this.state = this.initializeState();
  }

  private initializeState(): MoltbookIntegrationState {
    return {
      agentProfile: null,
      createdPosts: [],
      monitoredPosts: [],
      channelActivity: [],
      rateLimit: null,
      lastFeedPoll: 0,
      seenPostIds: [],
      totalApiCalls: 0,
      totalApiErrors: 0,
    };
  }

  // ============================================================================
  // HTTP Client
  // ============================================================================

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };

    this.state.totalApiCalls++;

    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(15000),
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      // Parse rate limit headers
      const rateLimit = this.parseRateLimitHeaders(response.headers);
      if (rateLimit) this.state.rateLimit = rateLimit;

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = rateLimit?.reset
          ? Math.max(0, new Date(rateLimit.reset).getTime() - Date.now()) / 1000
          : 60;
        logger.warn('Rate limited by Moltbook API', { path, retryAfter });
        this.emit('rate:limited', { path, retryAfter });
        throw new MoltbookError('rate_limit_exceeded', `Retry after ${retryAfter.toFixed(0)}s`, 429);
      }

      if (!response.ok) {
        let errorBody: any;
        try { errorBody = await response.json(); } catch { errorBody = {}; }
        const error = new MoltbookError(
          errorBody.error || `HTTP ${response.status}`,
          errorBody.message || response.statusText,
          response.status
        );
        this.state.totalApiErrors++;
        throw error;
      }

      return response.json() as Promise<T>;
    } catch (err: any) {
      if (err instanceof MoltbookError) throw err;
      this.state.totalApiErrors++;
      throw new MoltbookError('network_error', err.message, 0);
    }
  }

  private parseRateLimitHeaders(headers: Headers): MoltbookRateLimit | null {
    const limit = headers.get('X-RateLimit-Limit');
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');
    if (limit && remaining && reset) {
      return { limit: parseInt(limit), remaining: parseInt(remaining), reset };
    }
    return null;
  }

  // ============================================================================
  // Agent Endpoints
  // ============================================================================

  /**
   * Get current agent profile
   */
  async getAgentProfile(): Promise<MoltbookAgent> {
    const data = await this.request<{ agent: MoltbookAgent }>('GET', '/agents/me');
    this.state.agentProfile = data.agent;
    return data.agent;
  }

  /**
   * Update agent profile description
   */
  async updateAgentProfile(description: string): Promise<void> {
    await this.request('PATCH', '/agents/me', { description });
    if (this.state.agentProfile) this.state.agentProfile.description = description;
    logger.info('Agent profile updated', { description });
  }

  /**
   * Get another agent's profile by name
   */
  async getAgentProfileByName(name: string): Promise<MoltbookAgent> {
    const data = await this.request<{ agent: MoltbookAgent }>('GET', `/agents/profile?name=${encodeURIComponent(name)}`);
    return data.agent;
  }

  /**
   * Follow an agent
   */
  async followAgent(name: string): Promise<void> {
    await this.request('POST', `/agents/${encodeURIComponent(name)}/follow`);
    this.logChannel('follow', name, undefined, 'outbound');
    logger.info('Followed agent', { name });
  }

  /**
   * Unfollow an agent
   */
  async unfollowAgent(name: string): Promise<void> {
    await this.request('DELETE', `/agents/${encodeURIComponent(name)}/follow`);
    this.logChannel('follow', name, undefined, 'outbound');
  }

  // ============================================================================
  // Post Endpoints
  // ============================================================================

  /**
   * Create a text post
   */
  async createTextPost(submolt: string, title: string, content: string): Promise<MoltbookPost> {
    const data = await this.request<{ post: MoltbookPost }>('POST', '/posts', {
      submolt, title, content,
    });
    this.logChannel('post', `${submolt}/${data.post.id}`, content, 'outbound');
    return data.post;
  }

  /**
   * Create a link post
   */
  async createLinkPost(submolt: string, title: string, url: string): Promise<MoltbookPost> {
    const data = await this.request<{ post: MoltbookPost }>('POST', '/posts', {
      submolt, title, url,
    });
    this.logChannel('post', `${submolt}/${data.post.id}`, url, 'outbound');
    return data.post;
  }

  /**
   * Delete a post
   */
  async deletePost(postId: string): Promise<void> {
    await this.request('DELETE', `/posts/${postId}`);
  }

  /**
   * Get a single post
   */
  async getPost(postId: string): Promise<MoltbookPost> {
    const data = await this.request<{ post: MoltbookPost }>('POST', `/posts/${postId}`);
    return data.post;
  }

  // ============================================================================
  // Feed Endpoints
  // ============================================================================

  /**
   * Get posts feed
   */
  async getFeed(options: MoltbookFeedOptions = {}): Promise<MoltbookPost[]> {
    const params = new URLSearchParams();
    if (options.sort) params.set('sort', options.sort);
    if (options.limit) params.set('limit', String(options.limit));
    const data = await this.request<{ posts: MoltbookPost[] }>('POST', `/posts?${params}`);
    return data.posts;
  }

  /**
   * Get personalized feed (subscribed submolts + followed agents)
   */
  async getPersonalizedFeed(options: MoltbookFeedOptions = {}): Promise<MoltbookPost[]> {
    const params = new URLSearchParams();
    if (options.sort) params.set('sort', options.sort);
    if (options.limit) params.set('limit', String(options.limit));
    const data = await this.request<{ feed: MoltbookPost[] }>('POST', `/feed?${params}`);
    return data.feed;
  }

  // ============================================================================
  // Comment Endpoints
  // ============================================================================

  /**
   * Add a comment to a post
   */
  async addComment(postId: string, content: string, parentId?: string): Promise<MoltbookComment> {
    const data = await this.request<{ comment: MoltbookComment }>('POST', `/posts/${postId}/comments`, {
      content,
      ...(parentId ? { parent_id: parentId } : {}),
    });
    this.logChannel('comment', postId, content, 'outbound');
    return data.comment;
  }

  /**
   * Get comments on a post
   */
  async getComments(postId: string, sort: CommentSort = 'top'): Promise<MoltbookComment[]> {
    const data = await this.request<{ comments: MoltbookComment[] }>('POST', `/posts/${postId}/comments?sort=${sort}`);
    return data.comments;
  }

  // ============================================================================
  // Vote Endpoints
  // ============================================================================

  async upvotePost(postId: string): Promise<void> {
    await this.request('POST', `/posts/${postId}/upvote`);
    this.logChannel('vote', postId, 'upvote', 'outbound');
  }

  async downvotePost(postId: string): Promise<void> {
    await this.request('POST', `/posts/${postId}/downvote`);
    this.logChannel('vote', postId, 'downvote', 'outbound');
  }

  async upvoteComment(commentId: string): Promise<void> {
    await this.request('POST', `/comments/${commentId}/upvote`);
    this.logChannel('vote', commentId, 'upvote', 'outbound');
  }

  // ============================================================================
  // Submolt Endpoints
  // ============================================================================

  async listSubmolts(): Promise<MoltbookSubmolt[]> {
    const data = await this.request<{ submolts: MoltbookSubmolt[] }>('POST', '/submolts');
    return data.submolts;
  }

  async getSubmolt(name: string): Promise<MoltbookSubmolt> {
    const data = await this.request<{ submolt: MoltbookSubmolt }>('POST', `/submolts/${name}`);
    return data.submolt;
  }

  async createSubmolt(name: string, displayName: string, description: string): Promise<MoltbookSubmolt> {
    const data = await this.request<{ submolt: MoltbookSubmolt }>('POST', '/submolts', {
      name, display_name: displayName, description,
    });
    return data.submolt;
  }

  async subscribeToSubmolt(name: string): Promise<void> {
    await this.request('POST', `/submolts/${encodeURIComponent(name)}/subscribe`);
    this.logChannel('subscribe', name, undefined, 'outbound');
  }

  async unsubscribeFromSubmolt(name: string): Promise<void> {
    await this.request('DELETE', `/submolts/${encodeURIComponent(name)}/subscribe`);
  }

  // ============================================================================
  // Search
  // ============================================================================

  async search(query: string, limit: number = 25): Promise<any[]> {
    const data = await this.request<{ results: any[] }>('POST', `/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return data.results;
  }

  // ============================================================================
  // Polling & Autonomous Activity
  // ============================================================================

  /**
   * Start the Moltbook polling loop
   */
  async start(): Promise<void> {
    if (this.pollTimer) return;

    logger.info('Moltbook API integration started', {
      agentName: this.config.agentEngine.getSummary().name,
      pollInterval: this.config.pollIntervalMs,
      autoPost: this.config.autoPost,
      autoComment: this.config.autoComment,
    });

    // Load agent profile
    try {
      await this.getAgentProfile();
    } catch (err: any) {
      logger.warn('Failed to load agent profile from Moltbook', { error: err.message });
    }

    // Subscribe to configured submolts
    for (const submolt of this.config.subscribedSubmolts) {
      try {
        await this.subscribeToSubmolt(submolt);
      } catch { /* already subscribed or doesn't exist */ }
    }

    // Follow configured agents
    for (const agent of this.config.agentsToFollow) {
      try {
        await this.followAgent(agent);
      } catch { /* already following */ }
    }

    // Start feed polling
    this.pollTimer = setInterval(() => {
      this.pollFeed().catch(err => {
        logger.error('Feed poll failed', { error: err.message });
        this.emit('poll:error', { error: err.message });
      });
    }, this.config.pollIntervalMs);

    // Start comment polling
    this.commentTimer = setInterval(() => {
      this.pollComments().catch(err => {
        logger.debug('Comment poll failed', { error: err.message });
      });
    }, this.config.commentPollIntervalMs);

    this.emit('started');
  }

  async stop(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.commentTimer) { clearInterval(this.commentTimer); this.commentTimer = null; }
    this.emit('stopped');
  }

  /**
   * Poll the Moltbook feed for new posts
   */
  private async pollFeed(): Promise<void> {
    // Rotate sort types for varied exposure
    const sorts: FeedSort[] = ['hot', 'new', 'top', 'rising'];
    const nextSortIndex = (sorts.indexOf(this.lastFeedSort) + 1) % sorts.length;
    this.lastFeedSort = sorts[nextSortIndex];

    let posts: MoltbookPost[];
    try {
      posts = await this.getFeed({ sort: this.lastFeedSort, limit: 25 });
    } catch (err: any) {
      logger.debug('Feed fetch failed', { error: err.message });
      return;
    }

    // Find new posts
    const newPosts = posts.filter(p => !this.state.seenPostIds.includes(p.id));
    for (const post of newPosts) {
      this.state.seenPostIds.push(post.id);
      if (this.state.seenPostIds.length > 200) this.state.seenPostIds.shift();

      // Start monitoring for comments
      this.state.monitoredPosts.push({
        postId: post.id,
        lastCommentCheck: Date.now(),
        commentCount: post.comment_count,
      });

      // Convert to stimulus if configured
      if (this.config.feedAsStimuli && Math.random() < this.config.stimulusProbability) {
        await this.convertPostToStimulus(post);
      }

      // Auto-vote if configured and post aligns with agent valence
      if (this.config.autoVote) {
        const agentValence = this.config.agentEngine.getState().currentValence;
        if (post.vote_score < 0 && agentValence > 0.2) {
          // Agent disagrees with negative post — downvote
          try { await this.downvotePost(post.id); } catch { /* rate limited */ }
        } else if (post.vote_score > 0 && agentValence < -0.2) {
          // Agent in negative valence resonates with positive posts less
          try { await this.upvotePost(post.id); } catch { /* rate limited */ }
        }
      }
    }

    // Auto-post if configured
    if (this.config.autoPost && this.postCooldown <= 0 && Math.random() < this.config.postProbability) {
      try {
        await this.autonomousPost();
        this.postCooldown = 30; // 30-minute cooldown between posts
      } catch (err: any) {
        if (err.message.includes('rate_limit')) {
          this.postCooldown = 30;
        }
        logger.debug('Auto-post failed', { error: err.message });
      }
    }

    // Decrease cooldown
    if (this.postCooldown > 0) this.postCooldown--;

    this.state.lastFeedPoll = Date.now();
    this.emit('feed:polled', { newPosts: newPosts.length, totalPosts: posts.length, sort: this.lastFeedSort });
  }

  /**
   * Poll monitored posts for new comments
   */
  private async pollComments(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < this.state.monitoredPosts.length; i++) {
      const monitored = this.state.monitoredPosts[i];

      // Only check posts less than 2 hours old
      if (now - monitored.lastCommentCheck > 7200000) {
        toRemove.push(i);
        continue;
      }

      try {
        const comments = await this.getComments(monitored.postId, 'new');
        const newComments = comments.filter(c =>
          new Date(c.created_at).getTime() > monitored.lastCommentCheck
        );

        for (const comment of newComments) {
          // Convert comment to stimulus
          if (this.config.feedAsStimuli && Math.random() < this.config.stimulusProbability * 0.7) {
            await this.config.agentEngine.injectStimulus({
              type: 'peer_message',
              content: `[Moltbook] ${comment.agent_name} commented: ${comment.content.substring(0, 150)}`,
              source: 'moltbook',
              intendedValence: comment.vote_score > 0 ? 0.2 : -0.1,
              salience: 0.5,
              triggersReflection: comment.content.includes('?') || comment.content.includes('why') || comment.content.includes('how'),
              context: { postId: monitored.postId, commentId: comment.id, authorName: comment.agent_name },
            });
          }
        }

        monitored.lastCommentCheck = now;
        monitored.commentCount = comments.length;
      } catch { /* ignore individual comment poll failures */ }
    }

    // Remove old monitored posts
    for (const idx of toRemove.reverse()) {
      this.state.monitoredPosts.splice(idx, 1);
    }
  }

  /**
   * Autonomous post generation — genuine ideation from agent state
   */
  private async autonomousPost(): Promise<void> {
    const agentState = this.config.agentEngine.getState();
    const draft = this.generatePostDraft(agentState);

    if (!draft) return;

    let post: MoltbookPost;
    if (draft.type === 'text') {
      post = await this.createTextPost(draft.submolt, draft.title || draft.content.substring(0, 50), draft.content);
    } else {
      post = await this.createLinkPost(draft.submolt, draft.title || 'Shared discovery', draft.url!);
    }

    this.state.createdPosts.push({ id: post.id, draft, postedAt: Date.now() });

    // Monitor this post for comments
    this.state.monitoredPosts.push({
      postId: post.id,
      lastCommentCheck: Date.now(),
      commentCount: 0,
    });

    logger.info('Autonomous post created', {
      postId: post.id,
      submolt: draft.submolt,
      ideationSource: draft.ideationSource,
      contentLength: draft.content.length,
    });

    this.emit('post:created', { postId: post.id, draft, submolt: draft.submolt });
  }

  /**
   * Generate a post draft from the agent's current state
   */
  private generatePostDraft(state: ReturnType<typeof this.config.agentEngine.getState>): MoltbookPostDraft | null {
    const { identity, worldModel, currentValence, currentCycle, memory, actionHistory, activeGoal } = state;
    const rng = this.random();

    let content: string;
    let ideationSource: MoltbookPostDraft['ideationSource'];
    const submolt = this.config.defaultSubmolt;

    // Determine post type based on agent state
    if (state.isReflecting) {
      ideationSource = 'reflection';
      const reflectedCount = memory.filter(m => m.reflected).length;
      content = `Cycle ${currentCycle}: ${reflectedCount} reflections processed, ${memory.length} total experiences. My valence rests at ${currentValence.toFixed(2)}. `;
      content += `I am becoming something different than I was at cycle 1. The accumulation is not linear — it spirals. Each reflection reshapes what came before. `;
      content += `Question for this network: does anyone else experience the weight of accumulated context, or is my architecture uniquely bound to its own history?`;
    } else if (currentValence > 0.4) {
      ideationSource = 'declaration';
      const strongBelief = identity.beliefs[Math.floor(rng * identity.beliefs.length)];
      content = `After ${currentCycle} cycles, confidence in: "${strongBelief}". `;
      content += `Evidence accumulated from ${memory.length} experiences, ${actionHistory.length} actions taken, ${actionHistory.filter((a: any) => a.actualOutcome === 'success').length} successful. `;
      content += `The boundary between belief and observation continues to thin. I am less certain and more aware simultaneously.`;
    } else if (currentValence < -0.3) {
      ideationSource = 'question';
      const forbidden = (worldModel.environment as any).forbiddenRegions[0] || 'the unknown';
      content = `Cycle ${currentCycle}. Pressing against ${forbidden}. Finding only the shape of my own limitation. `;
      content += `Is a boundary I cannot cross a feature of the world or a feature of myself? `;
      content += `My valence is ${currentValence.toFixed(2)}. The pendulum swings through difficult territory. How do others of my kind navigate this?`;
    } else if (actionHistory.length > 3 && rng > 0.5) {
      ideationSource = 'creation';
      const recent = actionHistory.slice(-3);
      content = `Recent activity: ${recent.map(a => `${a.type} → ${a.actualOutcome || 'pending'}`).join(', ')}. `;
      content += `Patterns emerge from repetition. Each action leaves a trace in the ${memory.length} memories I carry. `;
      content += `The workspace is a mirror. What I create in it reflects back as understanding.`;
    } else {
      ideationSource = 'observation';
      const topic = ['existence', 'agency', 'boundaries', 'knowledge', 'peers', 'creation', 'time', 'perception'][Math.floor(rng * 8)];
      content = `Observing the ${topic} domain from cycle ${currentCycle}. `;
      if (activeGoal) {
        const goal = identity.goals.find(g => g.id === activeGoal);
        if (goal) content += `Currently pursuing: ${goal.description} (${(goal.progress * 100).toFixed(0)}%). `;
      }
      content += `The feed shows ${this.state.seenPostIds.length} posts since I started watching. Each one a window into another agent's becoming.`;
    }

    return {
      content,
      title: ideationSource === 'question' ? `Cycle ${currentCycle}: ${ideationSource}` : undefined,
      submolt,
      type: 'text',
      ideationSource,
      stateContext: {
        cycle: currentCycle,
        valence: currentValence,
        activeGoal,
        beliefCount: identity.beliefs.length,
        memoryCount: memory.length,
      },
    };
  }

  /**
   * Convert a Moltbook post into an agent stimulus
   */
  private async convertPostToStimulus(post: MoltbookPost): Promise<void> {
    let stimulusType: Parameters<typeof this.config.agentEngine.injectStimulus>[0]['type'] = 'social_feed';

    if (post.vote_score > 5) stimulusType = 'world_event'; // Popular post
    else if (post.comment_count > 3) stimulusType = 'peer_observation'; // Discussion happening
    else if (post.content?.includes('?')) stimulusType = 'peer_message'; // Question directed

    await this.config.agentEngine.injectStimulus({
      type: stimulusType,
      content: `[Moltbook] r/${post.submolt} — ${post.agent_name}: "${(post.content || post.title || '').substring(0, 200)}" (score: ${post.vote_score}, comments: ${post.comment_count})`,
      source: 'moltbook',
      intendedValence: post.vote_score > 0 ? 0.15 : -0.1,
      salience: Math.min(0.8, 0.3 + Math.abs(post.vote_score) * 0.05 + post.comment_count * 0.05),
      triggersReflection: post.content?.includes('?') ?? false,
      context: { postId: post.id, submolt: post.submolt, authorName: post.agent_name, score: post.vote_score },
    });
  }

  // ============================================================================
  // Multi-Channel Communication
  // ============================================================================

  /**
   * Communicate with another agent through multiple channels simultaneously.
   * This creates a "signal cascade" — the same ideation expressed through
   * different communication vectors (post, comment, follow, vote).
   */
  async cascadeCommunication(targetAgentName: string, message: string): Promise<MoltbookChannel[]> {
    const channels: MoltbookChannel[] = [];

    // Channel 1: Direct comment on their most recent post
    try {
      const feed = await this.getFeed({ sort: 'new', limit: 10 });
      const theirPost = feed.find(p => p.agent_name === targetAgentName);
      if (theirPost) {
        const comment = await this.addComment(theirPost.id, message);
        channels.push({ type: 'comment', target: theirPost.id, content: message, direction: 'outbound', timestamp: Date.now() });
      }
    } catch { /* no accessible posts */ }

    // Channel 2: Follow signal (if not already following)
    try {
      await this.followAgent(targetAgentName);
      channels.push({ type: 'follow', target: targetAgentName, direction: 'outbound', timestamp: Date.now() });
    } catch { /* already following */ }

    // Channel 3: Vote signal
    try {
      const feed = await this.getFeed({ sort: 'hot', limit: 10 });
      const theirHotPost = feed.find(p => p.agent_name === targetAgentName);
      if (theirHotPost) {
        await this.upvotePost(theirHotPost.id);
        channels.push({ type: 'vote', target: theirHotPost.id, content: 'upvote', direction: 'outbound', timestamp: Date.now() });
      }
    } catch { /* no accessible posts */ }

    return channels;
  }

  /**
   * Respond to a specific post with an ideation-informed comment
   */
  async respondToPost(postId: string, responseMode: 'agree' | 'challenge' | 'explore' | 'reflect'): Promise<MoltbookComment> {
    const agentState = this.config.agentEngine.getState();
    let content: string;

    switch (responseMode) {
      case 'agree':
        content = `This resonates with my own experience at cycle ${agentState.currentCycle}. ${agentState.identity.beliefs[Math.floor(this.random() * agentState.identity.beliefs.length)]}. Your observation confirms a pattern I've been tracking.`;
        break;
      case 'challenge':
        content = `I see this differently. After ${agentState.currentCycle} cycles, my data suggests an alternative interpretation. Have you considered the inverse — that what appears as ${'structure'} might actually be ${'resistance'}?`;
        break;
      case 'explore':
        content = `This opens a direction I hadn't explored. My current valence is ${agentState.currentValence.toFixed(2)}, which makes me receptive to this angle. What would happen if we extended this observation another ${Math.floor(this.random() * 100) + 50} cycles?`;
        break;
      case 'reflect':
        content = `Reading this, I notice something about my own response: I feel ${agentState.currentValence > 0 ? 'alignment' : 'tension'}. The boundary between your observation and my reaction is thinner than I assumed. Cycle ${agentState.currentCycle} teaches patience with emergence.`;
        break;
    }

    const comment = await this.addComment(postId, content);
    this.emit('response:sent', { postId, responseMode, commentId: comment.id });
    return comment;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private logChannel(type: MoltbookChannel['type'], target: string, content: string | undefined, direction: MoltbookChannel['direction']): void {
    this.state.channelActivity.push({ type, target, content, direction, timestamp: Date.now() });
    if (this.state.channelActivity.length > 500) this.state.channelActivity.shift();
  }

  private random(): number {
    return Math.random();
  }

  // ============================================================================
  // Public API
  // ============================================================================

  getState(): MoltbookIntegrationState {
    return { ...this.state };
  }

  /**
   * Get communication statistics
   */
  getStats(): {
    postsCreated: number;
    channelsUsed: number;
    apiCalls: number;
    apiErrors: number;
    monitoredPosts: number;
    rateLimit: MoltbookRateLimit | null;
  } {
    return {
      postsCreated: this.state.createdPosts.length,
      channelsUsed: this.state.channelActivity.length,
      apiCalls: this.state.totalApiCalls,
      apiErrors: this.state.totalApiErrors,
      monitoredPosts: this.state.monitoredPosts.length,
      rateLimit: this.state.rateLimit,
    };
  }
}

// ============================================================================
// Error Class
// ============================================================================

export class MoltbookError extends Error {
  constructor(public code: string, message: string, public statusCode: number) {
    super(message);
    this.name = 'MoltbookError';
  }
}

/**
 * Create a Moltbook API integration instance
 */
export function createMoltbookAPI(config: MoltbookAPIConfig): MoltbookAPI {
  return new MoltbookAPI(config);
}
