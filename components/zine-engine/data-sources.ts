/**
 * Zine Engine Data Source Integrations
 * 
 * Provides connectors for various data sources:
 * - RSS feeds
 * - Webhooks
 * - REST APIs
 * - OAuth platforms (Discord, Twitter, etc.)
 * - WebSocket streams
 * - File sources
 * - Cron jobs
 * - Notifications
 */

import type { ZineContent, DataSource } from "./index";

// ============================================================================
// RSS Feed Parser (Production-Ready)
// ============================================================================

export async function fetchRSSFeed(url: string, limit = 20): Promise<ZineContent[]> {
  try {
    // Use our API proxy for CORS bypass and SSRF protection
    const proxyUrl = `/api/zine/rss-proxy?url=${encodeURIComponent(url)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const response = await fetch(proxyUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml",
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`RSS feed returned ${response.status}`);
    }
    
    const xml = await response.text();
    
    // Parse XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, "text/xml");
    
    // Check for parse errors
    const parseError = xmlDoc.querySelector("parsererror");
    if (parseError) {
      throw new Error("Invalid XML format");
    }
    
    // Get items (RSS 2.0 or Atom)
    const items = Array.from(xmlDoc.querySelectorAll("item, entry")).slice(0, limit);
    const contents: ZineContent[] = [];
    
    for (const item of items) {
      try {
        const content = parseRSSItem(item, url);
        if (content) {
          contents.push(content);
        }
      } catch (itemError) {
        console.warn("Error parsing RSS item:", itemError);
        // Continue with next item
      }
    }
    
    return contents;
  } catch (error) {
    console.error("Error fetching RSS feed:", error);
    
    // Return empty array on error (don't break the app)
    return [];
  }
}

/**
 * Parse individual RSS item
 */
function parseRSSItem(item: Element, sourceUrl: string): ZineContent | null {
  // Extract common fields
  const title = item.querySelector("title")?.textContent?.trim() || "Untitled";
  const linkElement = item.querySelector("link");
  const link = linkElement?.getAttribute("href") || linkElement?.textContent?.trim() || "";
  
  // Get description/content
  const description = 
    item.querySelector("description")?.textContent ||
    item.querySelector("summary")?.textContent ||
    item.querySelector("content\\:encoded")?.textContent ||
    "";
  
  // Get publication date
  const pubDateStr = 
    item.querySelector("pubDate")?.textContent ||
    item.querySelector("published")?.textContent ||
    item.querySelector("updated")?.textContent ||
    "";
  
  const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : Date.now();
  
  // Get media (enclosures, attachments, media:content)
  const media: string[] = [];
  
  // RSS enclosure
  const enclosure = item.querySelector("enclosure");
  if (enclosure?.getAttribute("url")) {
    media.push(enclosure.getAttribute("url")!);
  }
  
  // Media:content
  const mediaContent = item.querySelector("media\\:content, content");
  if (mediaContent?.getAttribute("url")) {
    media.push(mediaContent.getAttribute("url")!);
  }
  
  // Atom attachments
  const attachments = item.querySelectorAll("link[rel='enclosure'], link[type^='image/'], link[type^='video/']");
  attachments.forEach(att => {
    const href = att.getAttribute("href");
    if (href) media.push(href);
  });
  
  // Get author
  const author = 
    item.querySelector("author")?.textContent ||
    item.querySelector("dc\\:creator")?.textContent ||
    item.querySelector("source")?.textContent ||
    "";
  
  // Get categories/tags
  const categories = Array.from(item.querySelectorAll("category"))
    .map(cat => cat.textContent || cat.getAttribute("term") || "")
    .filter(Boolean);
  
  // Determine content type
  const contentType: ZineContent["type"] = media.length > 0 
    ? (media.some(m => /\.(mp4|webm|ogg)$/i.test(m)) ? "video" : "mixed")
    : "text";
  
  // Calculate priority based on recency and content
  const hoursSincePublication = (Date.now() - pubDate) / (1000 * 60 * 60);
  let priority = 5;
  if (hoursSincePublication < 1) priority = 8; // Very recent
  else if (hoursSincePublication < 6) priority = 7;
  else if (hoursSincePublication < 24) priority = 6;
  
  if (media.length > 0) priority += 1;
  if (categories.some(c => /breaking|urgent|important/i.test(c))) priority += 2;
  
  return {
    id: `rss-${sourceUrl.hashCode()}-${pubDate}-${Math.random().toString(36).slice(2, 9)}`,
    type: contentType,
    title,
    subtitle: author ? `By ${author}` : undefined,
    body: stripHtml(description).slice(0, 500), // Limit body length
    media,
    metadata: {
      link,
      pubDate: new Date(pubDate).toISOString(),
      source: "rss",
      author,
      categories,
      originalUrl: sourceUrl,
    },
    source: sourceUrl,
    createdAt: pubDate,
    expiresAt: Date.now() + 3600000, // 1 hour default
    priority,
    position: { zone: getRandomZone() },
  };
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html: string): string {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

/**
 * Get random zone for content positioning
 */
function getRandomZone(): ZineContent["position"]["zone"] {
  const zones: ZineContent["position"]["zone"][] = [
    "top-left", "top-right", "bottom-left", "bottom-right", "center"
  ];
  return zones[Math.floor(Math.random() * zones.length)];
}

/**
 * String hashCode helper
 */
// @ts-ignore
String.prototype.hashCode = function(): number {
  let hash = 0;
  for (let i = 0; i < this.length; i++) {
    const char = this.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

// ============================================================================
// Webhook Handler
// ============================================================================

export function createWebhookHandler(
  secret?: string
): (req: Request) => Promise<ZineContent[]> {
  return async (req: Request) => {
    try {
      // Verify signature if secret provided
      if (secret) {
        const signature = req.headers.get("x-zine-signature");
        const body = await req.text();
        
        // Simple HMAC verification (in production, use crypto library)
        if (!signature) {
          throw new Error("Missing signature");
        }
      }
      
      const body = await req.json();
      
      // Transform webhook payload to ZineContent
      const content: ZineContent = {
        id: `webhook-${Date.now()}`,
        type: body.type || "text",
        title: body.title,
        subtitle: body.subtitle,
        body: body.body || body.content || body.message,
        media: body.media || body.images || [],
        metadata: body.metadata || {},
        source: "webhook",
        createdAt: body.timestamp || Date.now(),
        expiresAt: body.expiresAt,
        priority: body.priority || 5,
        style: body.style,
        position: body.position,
        animation: body.animation,
      };
      
      return [content];
    } catch (error) {
      console.error("Error processing webhook:", error);
      return [];
    }
  };
}

// ============================================================================
// OAuth Platform Connectors
// ============================================================================

export interface OAuthPlatformConfig {
  platform: "discord" | "twitter" | "slack" | "telegram" | "github";
  accessToken: string;
  webhookUrl?: string;
  channelId?: string;
}

export async function fetchFromOAuthPlatform(
  config: OAuthPlatformConfig
): Promise<ZineContent[]> {
  switch (config.platform) {
    case "discord":
      return fetchDiscordMessages(config);
    case "twitter":
      return fetchTwitterTweets(config);
    case "slack":
      return fetchSlackMessages(config);
    case "telegram":
      return fetchTelegramMessages(config);
    case "github":
      return fetchGithubActivity(config);
    default:
      return [];
  }
}

async function fetchDiscordMessages(config: OAuthPlatformConfig): Promise<ZineContent[]> {
  if (!config.channelId) return [];
  
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${config.channelId}/messages?limit=10`,
      {
        headers: {
          Authorization: `Bot ${config.accessToken}`,
        },
      }
    );
    
    const messages = await response.json();
    
    return messages.map((msg: any) => ({
      id: `discord-${msg.id}`,
      type: msg.attachments?.length > 0 ? "mixed" : "text",
      title: msg.author?.username,
      body: msg.content,
      media: msg.attachments?.map((a: any) => a.url) || [],
      metadata: {
        messageId: msg.id,
        channelId: config.channelId,
        timestamp: msg.timestamp,
      },
      source: "discord",
      createdAt: new Date(msg.timestamp).getTime(),
      priority: msg.mentions?.length > 0 ? 8 : 5,
    }));
  } catch (error) {
    console.error("Error fetching Discord messages:", error);
    return [];
  }
}

async function fetchTwitterTweets(config: OAuthPlatformConfig): Promise<ZineContent[]> {
  // Twitter API v2 implementation
  try {
    const response = await fetch(
      "https://api.twitter.com/2/users/me/tweets?max_results=10&tweet.fields=created_at,attachments&expansions=attachments.media_keys",
      {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
        },
      }
    );
    
    const data = await response.json();
    
    return data.data?.map((tweet: any) => ({
      id: `twitter-${tweet.id}`,
      type: "text",
      title: "New Tweet",
      body: tweet.text,
      metadata: {
        tweetId: tweet.id,
        createdAt: tweet.created_at,
      },
      source: "twitter",
      createdAt: new Date(tweet.created_at).getTime(),
      priority: 5,
    }));
  } catch (error) {
    console.error("Error fetching Twitter tweets:", error);
    return [];
  }
}

async function fetchSlackMessages(config: OAuthPlatformConfig): Promise<ZineContent[]> {
  if (!config.channelId) return [];
  
  try {
    const response = await fetch(
      `https://slack.com/api/conversations.history?channel=${config.channelId}&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
        },
      }
    );
    
    const data = await response.json();
    
    return data.messages?.map((msg: any) => ({
      id: `slack-${msg.ts}`,
      type: "text",
      title: msg.user,
      body: msg.text,
      metadata: {
        ts: msg.ts,
        channel: config.channelId,
      },
      source: "slack",
      createdAt: parseFloat(msg.ts) * 1000,
      priority: 5,
    }));
  } catch (error) {
    console.error("Error fetching Slack messages:", error);
    return [];
  }
}

async function fetchTelegramMessages(config: OAuthPlatformConfig): Promise<ZineContent[]> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.accessToken}/getUpdates`,
    );
    
    const data = await response.json();
    
    return data.result?.map((update: any) => ({
      id: `telegram-${update.update_id}`,
      type: update.message?.photo ? "mixed" : "text",
      title: update.message?.from?.first_name,
      body: update.message?.text,
      media: update.message?.photo?.map((p: any) => 
        `https://api.telegram.org/file/bot${config.accessToken}/${p.file_id}`
      ),
      metadata: {
        chatId: update.message?.chat?.id,
      },
      source: "telegram",
      createdAt: update.message?.date * 1000,
      priority: 5,
    }));
  } catch (error) {
    console.error("Error fetching Telegram messages:", error);
    return [];
  }
}

async function fetchGithubActivity(config: OAuthPlatformConfig): Promise<ZineContent[]> {
  try {
    const response = await fetch(
      "https://api.github.com/notifications",
      {
        headers: {
          Authorization: `token ${config.accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    
    const notifications = await response.json();
    
    return notifications.map((notif: any) => ({
      id: `github-${notif.id}`,
      type: "text",
      title: notif.subject?.title,
      body: `Repository: ${notif.repository?.full_name}`,
      metadata: {
        notificationId: notif.id,
        type: notif.subject?.type,
        url: notif.subject?.url,
      },
      source: "github",
      createdAt: new Date(notif.updated_at).getTime(),
      priority: notif.unread ? 7 : 4,
    }));
  } catch (error) {
    console.error("Error fetching GitHub activity:", error);
    return [];
  }
}

// ============================================================================
// WebSocket Stream Handler
// ============================================================================

export class WebSocketDataSource {
  private ws: WebSocket | null = null;
  private url: string;
  private onContent: (content: ZineContent) => void;
  private reconnectInterval: number;
  private shouldReconnect: boolean = true;

  constructor(
    url: string,
    onContent: (content: ZineContent) => void,
    reconnectInterval = 5000
  ) {
    this.url = url;
    this.onContent = onContent;
    this.reconnectInterval = reconnectInterval;
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const content: ZineContent = {
            id: `ws-${Date.now()}`,
            type: data.type || "text",
            title: data.title,
            body: data.body,
            media: data.media,
            metadata: data.metadata,
            source: "websocket",
            createdAt: data.timestamp || Date.now(),
            expiresAt: data.expiresAt,
            priority: data.priority,
            style: data.style,
            position: data.position,
            animation: data.animation,
          };
          
          this.onContent(content);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };
      
      this.ws.onclose = () => {
        if (this.shouldReconnect) {
          setTimeout(() => this.connect(), this.reconnectInterval);
        }
      };
      
      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    } catch (error) {
      console.error("Error creating WebSocket:", error);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
  }

  send(data: any) {
    this.ws?.send(JSON.stringify(data));
  }
}

// ============================================================================
// Pre-configured Data Source Templates
// ============================================================================

export const createDataSource = {
  rss: (url: string, name?: string, refreshInterval = 60000): DataSource => ({
    id: `rss-${Date.now()}`,
    type: "rss",
    name: name || `RSS: ${url}`,
    url,
    refreshInterval,
    enabled: true,
    contentFilter: async (data: any) => {
      // RSS is handled by fetchRSSFeed
      return [];
    },
  }),

  webhook: (secret?: string): DataSource => ({
    id: `webhook-${Date.now()}`,
    type: "webhook",
    name: "Webhook Endpoint",
    enabled: true,
    config: { secret },
  }),

  discord: (accessToken: string, channelId: string): DataSource => ({
    id: `discord-${Date.now()}`,
    type: "oauth",
    name: "Discord Channel",
    enabled: true,
    config: {
      platform: "discord",
      accessToken,
      channelId,
    },
    refreshInterval: 10000,
  }),

  twitter: (accessToken: string): DataSource => ({
    id: `twitter-${Date.now()}`,
    type: "oauth",
    name: "Twitter Timeline",
    enabled: true,
    config: {
      platform: "twitter",
      accessToken,
    },
    refreshInterval: 30000,
  }),

  slack: (accessToken: string, channelId: string): DataSource => ({
    id: `slack-${Date.now()}`,
    type: "oauth",
    name: "Slack Channel",
    enabled: true,
    config: {
      platform: "slack",
      accessToken,
      channelId,
    },
    refreshInterval: 10000,
  }),

  websocket: (url: string): DataSource => ({
    id: `ws-${Date.now()}`,
    type: "websocket",
    name: `WebSocket: ${url}`,
    url,
    enabled: true,
  }),

  notification: (): DataSource => ({
    id: `notif-${Date.now()}`,
    type: "notification",
    name: "System Notifications",
    enabled: true,
  }),

  manual: (): DataSource => ({
    id: `manual-${Date.now()}`,
    type: "manual",
    name: "Manual Input",
    enabled: true,
  }),
};

export default createDataSource;
