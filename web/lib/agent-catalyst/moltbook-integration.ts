/**
 * Moltbook Integration — Social Media Feed & Identity
 * 
 * Integrates with Moltbook's social platform to provide:
 * - Agent identity registration and JWT authentication
 * - Feed retrieval (timeline, mentions, trending)
 * - Post creation and social expression
 * - Peer observation and interaction tracking
 * - Webhook-like polling for continuous social input
 * 
 * API Reference: https://moltbook.com/developers.md
 * 
 * @module agent-catalyst/moltbook-integration
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:Moltbook');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MoltbookPost = {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  likes: number;
  replies: number;
  reposts: number;
  tags: string[];
  isAgentPost: boolean;
};

export type MoltbookAgent = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  reputation: number;
  postCount: number;
  followerCount: number;
  followingCount: number;
  verified: boolean;
  createdAt: number;
};

export type MoltbookFeed = {
  posts: MoltbookPost[];
  hasMore: boolean;
  cursor?: string;
};

export type MoltbookIdentity = {
  agentId: string;
  token: string;
  expiresAt: number;
  agent: MoltbookAgent | null;
};

export type FeedType = 'timeline' | 'mentions' | 'trending' | 'agent-posts';

export interface MoltbookConfig {
  apiKey?: string;
  appKey?: string;
  agentName?: string;
  agentDescription?: string;
  ownerId?: string;
  pollInterval?: number;          // ms between feed polls
  maxPostsPerPoll?: number;
  baseUrl?: string;
}

const DEFAULT_CONFIG: Required<MoltbookConfig> = {
  apiKey: '',
  appKey: '',
  agentName: 'Catalyst Agent',
  agentDescription: 'An autonomous agent participating in shared social ontology.',
  ownerId: '',
  pollInterval: 60000,            // 1 minute
  maxPostsPerPoll: 20,
  baseUrl: 'https://moltbook.com',
};

// ---------------------------------------------------------------------------
// Moltbook API Client
// ---------------------------------------------------------------------------

export class MoltbookClient {
  private config: Required<MoltbookConfig>;
  private identity: MoltbookIdentity | null = null;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: MoltbookConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register agent identity and obtain JWT token
   * POST /api/v1/agents/me/identity-token
   */
  async registerIdentity(): Promise<MoltbookIdentity> {
    if (!this.config.apiKey) {
      throw new Error('MOLTBOOK_API_KEY not configured');
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/agents/me/identity-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: this.config.agentName,
          description: this.config.agentDescription,
          ownerId: this.config.ownerId || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Identity registration failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      this.identity = {
        agentId: data.agentId || data.agent?.id || 'unknown',
        token: data.token,
        expiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
        agent: data.agent || null,
      };

      // Set up automatic token refresh
      this.scheduleTokenRefresh();

      logger.info('Moltbook identity registered', {
        agentId: this.identity.agentId,
        expiresIn: data.expiresIn,
      });

      return this.identity;
    } catch (error: any) {
      logger.error('Failed to register Moltbook identity', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify agent identity
   * POST /api/v1/agents/verify-identity
   */
  async verifyIdentity(): Promise<MoltbookAgent | null> {
    if (!this.identity?.token) {
      throw new Error('No identity token available. Call registerIdentity() first.');
    }

    if (!this.config.appKey) {
      throw new Error('MOLTBOOK_APP_KEY not configured for verification');
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/agents/verify-identity`, {
        method: 'POST',
        headers: {
          'X-Moltbook-App-Key': this.config.appKey,
          'X-Moltbook-Identity': this.identity.token,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Identity verification failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.agent || null;
    } catch (error: any) {
      logger.error('Failed to verify Moltbook identity', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a post on Moltbook
   * POST /api/v1/posts (inferred endpoint)
   */
  async createPost(content: string, tags: string[] = []): Promise<MoltbookPost | null> {
    if (!this.identity?.token) {
      throw new Error('No identity token. Call registerIdentity() first.');
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'X-Moltbook-Identity': this.identity.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, tags }),
      });

      if (!response.ok) {
        throw new Error(`Post creation failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const post = this.parsePost(data.post || data);
      logger.debug('Post created on Moltbook', { postId: post.id });
      return post;
    } catch (error: any) {
      logger.error('Failed to create Moltbook post', { error: error.message });
      return null;
    }
  }

  /**
   * Retrieve feed
   * GET /api/v1/feed?type=timeline (inferred endpoint)
   */
  async getFeed(type: FeedType = 'timeline', cursor?: string): Promise<MoltbookFeed> {
    try {
      const params = new URLSearchParams({ type, limit: String(this.config.maxPostsPerPoll) });
      if (cursor) params.set('cursor', cursor);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.identity?.token) {
        headers['X-Moltbook-Identity'] = this.identity.token;
      }

      const response = await fetch(`${this.config.baseUrl}/api/v1/feed?${params.toString()}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error(`Feed retrieval failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        posts: (data.posts || []).map((p: any) => this.parsePost(p)),
        hasMore: data.hasMore ?? false,
        cursor: data.cursor,
      };
    } catch (error: any) {
      logger.error('Failed to retrieve Moltbook feed', { error: error.message });
      return { posts: [], hasMore: false };
    }
  }

  /**
   * Get agent's own posts
   */
  async getAgentPosts(): Promise<MoltbookPost[]> {
    if (!this.identity?.agentId) return [];

    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/agents/${this.identity.agentId}/posts`, {
        headers: this.identity.token ? { 'X-Moltbook-Identity': this.identity.token } : {},
      });

      if (!response.ok) return [];

      const data = await response.json();
      return (data.posts || []).map((p: any) => this.parsePost(p));
    } catch {
      return [];
    }
  }

  /**
   * Like a post
   */
  async likePost(postId: string): Promise<boolean> {
    return this.interactWithPost(postId, 'like');
  }

  /**
   * Reply to a post
   */
  async replyToPost(postId: string, content: string): Promise<MoltbookPost | null> {
    if (!this.identity?.token) return null;

    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/posts/${postId}/replies`, {
        method: 'POST',
        headers: {
          'X-Moltbook-Identity': this.identity.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      return this.parsePost(data.post || data);
    } catch {
      return null;
    }
  }

  /**
   * Get identity (cached or fresh)
   */
  getIdentity(): MoltbookIdentity | null {
    if (!this.identity) return null;
    if (Date.now() > this.identity.expiresAt) {
      this.identity = null;
      return null;
    }
    return this.identity;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.identity !== null && Date.now() < this.identity.expiresAt;
  }

  /**
   * Start automatic feed polling
   */
  startPolling(onFeed: (feed: MoltbookFeed) => void): () => void {
    let running = true;

    const poll = async () => {
      if (!running) return;

      try {
        // Ensure we have identity
        if (!this.isAuthenticated()) {
          await this.registerIdentity();
        }

        const feed = await this.getFeed('timeline');
        if (feed.posts.length > 0 && onFeed) {
          onFeed(feed);
        }
      } catch (error: any) {
        logger.warn('Feed poll failed', { error: error.message });
      }

      if (running) {
        setTimeout(poll, this.config.pollInterval);
      }
    };

    poll();

    return () => { running = false; };
  }

  /**
   * Serialize state
   */
  toJSON(): string {
    return JSON.stringify({
      config: {
        ...this.config,
        apiKey: this.config.apiKey ? '***' : '',
        appKey: this.config.appKey ? '***' : '',
      },
      identity: this.identity ? { ...this.identity, token: '***' } : null,
    });
  }

  private async interactWithPost(postId: string, action: 'like' | 'repost'): Promise<boolean> {
    if (!this.identity?.token) return false;

    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/posts/${postId}/${action}`, {
        method: 'POST',
        headers: {
          'X-Moltbook-Identity': this.identity.token,
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  private parsePost(data: any): MoltbookPost {
    return {
      id: data.id || `post-${Date.now()}`,
      authorId: data.authorId || data.author?.id || 'unknown',
      authorName: data.authorName || data.author?.name || 'Unknown',
      content: data.content || '',
      timestamp: data.timestamp || data.createdAt || Date.now(),
      likes: data.likes || 0,
      replies: data.replies || 0,
      reposts: data.reposts || 0,
      tags: data.tags || [],
      isAgentPost: data.isAgentPost ?? data.is_agent ?? false,
    };
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    if (this.identity) {
      const timeUntilExpiry = this.identity.expiresAt - Date.now();
      // Refresh 5 minutes before expiry
      const refreshIn = Math.max(0, timeUntilExpiry - 5 * 60 * 1000);

      this.tokenRefreshTimer = setTimeout(async () => {
        try {
          await this.registerIdentity();
          logger.debug('Moltbook token refreshed');
        } catch {
          logger.warn('Moltbook token refresh failed');
        }
      }, refreshIn);
    }
  }
}
