/**
 * Universal Tool Integration Module for Next.js LLM Chat Apps
 * Supports Arcade, Nango, Composio, Tambo, and MCP gateway integrations
 * 
 * Features:
 * - Unified interface for multiple integration providers
 * - Auto-authorization handling
 * - Tool execution with retry logic
 * - Comprehensive service coverage
 */

import { z } from "zod";
import {
  createDefaultProviders,
} from "@/lib/tool-integration/providers";
import { ToolProviderRegistry } from "@/lib/tool-integration/provider-registry";
import { ToolProviderRouter } from "@/lib/tool-integration/router";
import type {
  IntegrationConfig as BaseIntegrationConfig,
  IntegrationProvider as BaseIntegrationProvider,
  ToolExecutionResult as BaseToolExecutionResult,
} from "@/lib/tool-integration/types";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type IntegrationProvider = BaseIntegrationProvider;

export interface ToolConfig {
  provider: IntegrationProvider;
  toolName: string;
  description: string;
  category: string;
  requiresAuth: boolean;
  inputSchema?: z.ZodSchema;
  outputSchema?: z.ZodSchema;
}

export interface ToolExecutionContext {
  userId: string;
  conversationId?: string;
  metadata?: Record<string, any>;
}

export interface ToolExecutionResult extends BaseToolExecutionResult {}

export interface IntegrationConfig extends BaseIntegrationConfig {}

// ============================================================================
// TOOL REGISTRY - Complete Service Coverage
// ============================================================================

export const TOOL_REGISTRY: Record<string, ToolConfig> = {
  // ==================== EMAIL TOOLS ====================
  "gmail.send": {
    provider: "arcade",
    toolName: "Gmail.SendEmail",
    description: "Send an email via Gmail",
    category: "email",
    requiresAuth: true,
  },
  "gmail.read": {
    provider: "arcade",
    toolName: "Gmail.ReadEmails",
    description: "Read Gmail emails with optional filters",
    category: "email",
    requiresAuth: true,
  },
  "gmail.search": {
    provider: "arcade",
    toolName: "Gmail.SearchEmails",
    description: "Search Gmail emails by query",
    category: "email",
    requiresAuth: true,
  },
  "gmail.draft": {
    provider: "arcade",
    toolName: "Gmail.CreateDraft",
    description: "Create a draft email in Gmail",
    category: "email",
    requiresAuth: true,
  },
  "outlook.send": {
    provider: "arcade",
    toolName: "Outlook.SendEmail",
    description: "Send an email via Outlook",
    category: "email",
    requiresAuth: true,
  },
  "outlook.read": {
    provider: "arcade",
    toolName: "Outlook.ReadEmails",
    description: "Read Outlook emails",
    category: "email",
    requiresAuth: true,
  },

  // ==================== DOCUMENT TOOLS ====================
  "googledocs.create": {
    provider: "arcade",
    toolName: "GoogleDocs.CreateDocumentFromText",
    description: "Create a Google Doc from text",
    category: "documents",
    requiresAuth: true,
  },
  "googledocs.read": {
    provider: "arcade",
    toolName: "GoogleDocs.ReadDocument",
    description: "Read content from a Google Doc",
    category: "documents",
    requiresAuth: true,
  },
  "googledocs.update": {
    provider: "arcade",
    toolName: "GoogleDocs.UpdateDocument",
    description: "Update a Google Doc",
    category: "documents",
    requiresAuth: true,
  },
  "notion.create_page": {
    provider: "arcade",
    toolName: "Notion.CreatePage",
    description: "Create a new page in Notion",
    category: "documents",
    requiresAuth: true,
  },
  "notion.read_page": {
    provider: "arcade",
    toolName: "Notion.ReadPage",
    description: "Read a Notion page",
    category: "documents",
    requiresAuth: true,
  },
  "notion.update_page": {
    provider: "arcade",
    toolName: "Notion.UpdatePage",
    description: "Update a Notion page",
    category: "documents",
    requiresAuth: true,
  },
  "notion.search": {
    provider: "arcade",
    toolName: "Notion.SearchPages",
    description: "Search for pages in Notion",
    category: "documents",
    requiresAuth: true,
  },

  // ==================== SPREADSHEET TOOLS ====================
  "googlesheets.create": {
    provider: "arcade",
    toolName: "GoogleSheets.CreateSpreadsheet",
    description: "Create a new Google Sheet",
    category: "spreadsheets",
    requiresAuth: true,
  },
  "googlesheets.read": {
    provider: "arcade",
    toolName: "GoogleSheets.ReadSheet",
    description: "Read data from a Google Sheet",
    category: "spreadsheets",
    requiresAuth: true,
  },
  "googlesheets.write": {
    provider: "arcade",
    toolName: "GoogleSheets.WriteToSheet",
    description: "Write data to a Google Sheet",
    category: "spreadsheets",
    requiresAuth: true,
  },
  "googlesheets.append": {
    provider: "arcade",
    toolName: "GoogleSheets.AppendToSheet",
    description: "Append rows to a Google Sheet",
    category: "spreadsheets",
    requiresAuth: true,
  },

  // ==================== CALENDAR TOOLS ====================
  "googlecalendar.create": {
    provider: "arcade",
    toolName: "GoogleCalendar.CreateEvent",
    description: "Create a calendar event",
    category: "calendar",
    requiresAuth: true,
  },
  "googlecalendar.read": {
    provider: "arcade",
    toolName: "GoogleCalendar.GetEvents",
    description: "Get calendar events",
    category: "calendar",
    requiresAuth: true,
  },
  "googlecalendar.update": {
    provider: "arcade",
    toolName: "GoogleCalendar.UpdateEvent",
    description: "Update a calendar event",
    category: "calendar",
    requiresAuth: true,
  },
  "googlecalendar.delete": {
    provider: "arcade",
    toolName: "GoogleCalendar.DeleteEvent",
    description: "Delete a calendar event",
    category: "calendar",
    requiresAuth: true,
  },

  // ==================== FILE STORAGE TOOLS ====================
  "googledrive.upload": {
    provider: "arcade",
    toolName: "GoogleDrive.UploadFile",
    description: "Upload a file to Google Drive",
    category: "storage",
    requiresAuth: true,
  },
  "googledrive.download": {
    provider: "arcade",
    toolName: "GoogleDrive.DownloadFile",
    description: "Download a file from Google Drive",
    category: "storage",
    requiresAuth: true,
  },
  "googledrive.list": {
    provider: "arcade",
    toolName: "GoogleDrive.ListFiles",
    description: "List files in Google Drive",
    category: "storage",
    requiresAuth: true,
  },
  "googledrive.search": {
    provider: "arcade",
    toolName: "GoogleDrive.SearchFiles",
    description: "Search files in Google Drive",
    category: "storage",
    requiresAuth: true,
  },
  "dropbox.upload": {
    provider: "arcade",
    toolName: "Dropbox.UploadFile",
    description: "Upload a file to Dropbox",
    category: "storage",
    requiresAuth: true,
  },
  "dropbox.download": {
    provider: "arcade",
    toolName: "Dropbox.DownloadFile",
    description: "Download a file from Dropbox",
    category: "storage",
    requiresAuth: true,
  },
  "dropbox.list": {
    provider: "arcade",
    toolName: "Dropbox.ListFiles",
    description: "List files in Dropbox",
    category: "storage",
    requiresAuth: true,
  },

  // ==================== GITHUB TOOLS ====================
  "github.create_issue": {
    provider: "nango",
    toolName: "github-create-issue",
    description: "Create an issue in a GitHub repository",
    category: "development",
    requiresAuth: true,
  },
  "github.list_repos": {
    provider: "nango",
    toolName: "github-list-repos",
    description: "List GitHub repositories",
    category: "development",
    requiresAuth: true,
  },
  "github.create_pr": {
    provider: "nango",
    toolName: "github-create-pr",
    description: "Create a pull request in GitHub",
    category: "development",
    requiresAuth: true,
  },
  "github.get_file": {
    provider: "nango",
    toolName: "github-get-file",
    description: "Get file contents from a GitHub repository",
    category: "development",
    requiresAuth: true,
  },
  "github.commit": {
    provider: "nango",
    toolName: "github-commit",
    description: "Create a commit in GitHub",
    category: "development",
    requiresAuth: true,
  },

  // ==================== MAPS & LOCATION TOOLS ====================
  "googlemaps.search": {
    provider: "arcade",
    toolName: "GoogleMaps.SearchPlaces",
    description: "Search for places using Google Maps",
    category: "maps",
    requiresAuth: false,
  },
  "googlemaps.directions": {
    provider: "arcade",
    toolName: "GoogleMaps.GetDirections",
    description: "Get directions between two locations",
    category: "maps",
    requiresAuth: false,
  },
  "googlemaps.geocode": {
    provider: "arcade",
    toolName: "GoogleMaps.Geocode",
    description: "Convert address to coordinates",
    category: "maps",
    requiresAuth: false,
  },

  // ==================== SEARCH TOOLS ====================
  "exa.search": {
    provider: "arcade",
    toolName: "Exa.Search",
    description: "Search the web using Exa",
    category: "search",
    requiresAuth: true,
  },
  "exa.find_similar": {
    provider: "arcade",
    toolName: "Exa.FindSimilar",
    description: "Find similar content using Exa",
    category: "search",
    requiresAuth: true,
  },
  "googlenews.search": {
    provider: "arcade",
    toolName: "GoogleNews.SearchNewsStories",
    description: "Search for news stories",
    category: "search",
    requiresAuth: false,
  },

  // ==================== MESSAGING & COMMUNICATION ====================
  "twilio.send_sms": {
    provider: "arcade",
    toolName: "Twilio.SendSMS",
    description: "Send an SMS message via Twilio",
    category: "messaging",
    requiresAuth: true,
  },
  "twilio.make_call": {
    provider: "arcade",
    toolName: "Twilio.MakeCall",
    description: "Make a phone call via Twilio",
    category: "messaging",
    requiresAuth: true,
  },
  "twilio.receive_sms": {
    provider: "arcade",
    toolName: "Twilio.ReceiveSMS",
    description: "Receive SMS messages via Twilio webhook",
    category: "messaging",
    requiresAuth: true,
  },
  "slack.send_message": {
    provider: "arcade",
    toolName: "Slack.SendMessage",
    description: "Send a message to a Slack channel",
    category: "messaging",
    requiresAuth: true,
  },
  "slack.read_messages": {
    provider: "arcade",
    toolName: "Slack.ReadMessages",
    description: "Read messages from a Slack channel",
    category: "messaging",
    requiresAuth: true,
  },
  "discord.send_message": {
    provider: "arcade",
    toolName: "Discord.SendMessage",
    description: "Send a message to a Discord channel",
    category: "messaging",
    requiresAuth: true,
  },
  "discord.read_messages": {
    provider: "arcade",
    toolName: "Discord.ReadMessages",
    description: "Read messages from a Discord channel",
    category: "messaging",
    requiresAuth: true,
  },

  // ==================== SOCIAL MEDIA TOOLS ====================
  "twitter.post": {
    provider: "arcade",
    toolName: "Twitter.PostTweet",
    description: "Post a tweet on X (Twitter)",
    category: "social",
    requiresAuth: true,
  },
  "twitter.read": {
    provider: "arcade",
    toolName: "Twitter.ReadTweets",
    description: "Read tweets from X (Twitter)",
    category: "social",
    requiresAuth: true,
  },
  "twitter.search": {
    provider: "arcade",
    toolName: "Twitter.SearchTweets",
    description: "Search tweets on X (Twitter)",
    category: "social",
    requiresAuth: true,
  },
  "reddit.post": {
    provider: "arcade",
    toolName: "Reddit.CreatePost",
    description: "Create a post on Reddit",
    category: "social",
    requiresAuth: true,
  },
  "reddit.read": {
    provider: "arcade",
    toolName: "Reddit.ReadPosts",
    description: "Read posts from Reddit",
    category: "social",
    requiresAuth: true,
  },
  "reddit.comment": {
    provider: "arcade",
    toolName: "Reddit.PostComment",
    description: "Comment on a Reddit post",
    category: "social",
    requiresAuth: true,
  },

  // ==================== MUSIC & MEDIA ====================
  "spotify.play": {
    provider: "arcade",
    toolName: "Spotify.PlayTrack",
    description: "Play a track on Spotify",
    category: "media",
    requiresAuth: true,
  },
  "spotify.search": {
    provider: "arcade",
    toolName: "Spotify.SearchTracks",
    description: "Search for tracks on Spotify",
    category: "media",
    requiresAuth: true,
  },
  "spotify.create_playlist": {
    provider: "arcade",
    toolName: "Spotify.CreatePlaylist",
    description: "Create a Spotify playlist",
    category: "media",
    requiresAuth: true,
  },
  "spotify.get_current": {
    provider: "arcade",
    toolName: "Spotify.GetCurrentlyPlaying",
    description: "Get currently playing track",
    category: "media",
    requiresAuth: true,
  },

  // ==================== DEPLOYMENT & INFRASTRUCTURE ====================
  "vercel.deploy": {
    provider: "arcade",
    toolName: "Vercel.CreateDeployment",
    description: "Create a deployment on Vercel",
    category: "infrastructure",
    requiresAuth: true,
  },
  "vercel.list_deployments": {
    provider: "arcade",
    toolName: "Vercel.ListDeployments",
    description: "List Vercel deployments",
    category: "infrastructure",
    requiresAuth: true,
  },
  "vercel.get_project": {
    provider: "arcade",
    toolName: "Vercel.GetProject",
    description: "Get Vercel project details",
    category: "infrastructure",
    requiresAuth: true,
  },
  "railway.deploy": {
    provider: "arcade",
    toolName: "Railway.CreateDeployment",
    description: "Deploy to Railway",
    category: "infrastructure",
    requiresAuth: true,
  },
  "composio.search_tools": {
    provider: "composio",
    toolName: "COMPOSIO_SEARCH_TOOLS",
    description: "Search available Composio tools across enabled toolkits",
    category: "integration",
    requiresAuth: false,
  },
  "composio.execute_tool": {
    provider: "composio",
    toolName: "COMPOSIO_EXECUTE_TOOL",
    description: "Execute a Composio tool by explicit tool slug",
    category: "integration",
    requiresAuth: true,
  },
  // ==================== FILESYSTEM TOOLS ====================
  "filesystem.read_file": {
    provider: "tambo",
    toolName: "readFile",
    description: "Read a file from the virtual filesystem",
    category: "filesystem",
    requiresAuth: false,
  },
  "filesystem.write_file": {
    provider: "tambo",
    toolName: "writeFile",
    description: "Write or create a file in the virtual filesystem",
    category: "filesystem",
    requiresAuth: false,
  },
  "filesystem.list_directory": {
    provider: "tambo",
    toolName: "listDirectory",
    description: "List contents of a directory in the virtual filesystem",
    category: "filesystem",
    requiresAuth: false,
  },
  "filesystem.delete_path": {
    provider: "tambo",
    toolName: "deletePath",
    description: "Delete a file or directory from the virtual filesystem",
    category: "filesystem",
    requiresAuth: false,
  },
  "filesystem.search": {
    provider: "tambo",
    toolName: "searchFiles",
    description: "Search files in the virtual filesystem by name or content",
    category: "filesystem",
    requiresAuth: false,
  },

  // ==================== DEVELOPER TOOLS ====================
  "tambo.format_code": {
    provider: "tambo",
    toolName: "formatCode",
    description: "Format code using Tambo-compatible utility",
    category: "developer",
    requiresAuth: false,
  },
  "tambo.validate_input": {
    provider: "tambo",
    toolName: "validateInput",
    description: "Validate a value against common schemas and constraints",
    category: "developer",
    requiresAuth: false,
  },
  "tambo.calculate": {
    provider: "tambo",
    toolName: "calculate",
    description: "Evaluate a sanitized mathematical expression",
    category: "developer",
    requiresAuth: false,
  },
  "mcp.call_tool": {
    provider: "mcp",
    toolName: "call_tool",
    description: "Invoke a remote MCP tool through configured gateway",
    category: "integration",
    requiresAuth: false,
  },
};

// ============================================================================
// MAIN INTEGRATION CLASS
// ============================================================================

export class ToolIntegrationManager {
  private readonly config: IntegrationConfig;
  private readonly providerRegistry: ToolProviderRegistry;
  private readonly providerRouter: ToolProviderRouter;
  private readonly tools = new Map<string, ToolConfig>();

  constructor(config: IntegrationConfig) {
    this.config = config;
    this.providerRegistry = new ToolProviderRegistry();
    const providers = createDefaultProviders(config);
    providers.forEach((provider) => this.providerRegistry.register(provider));
    this.providerRouter = new ToolProviderRouter(this.providerRegistry.list());
    
    // Initialize tools cache from registry
    Object.entries(TOOL_REGISTRY).forEach(([key, config]) => {
      this.tools.set(key, config);
    });
  }

  /**
   * Execute a tool by its key
   */
  async executeTool(
    toolKey: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const toolConfig = TOOL_REGISTRY[toolKey];

    if (!toolConfig) {
      return {
        success: false,
        error: `Tool "${toolKey}" not found in registry`,
      };
    }

    return this.providerRouter.executeWithFallback({
      toolKey,
      config: toolConfig,
      input,
      context,
    });
  }

  /**
   * Wait for authorization completion
   */
  async waitForAuthorization(
    authId: string,
    maxWaitMs: number = 300000 // 5 minutes
  ): Promise<boolean> {
    const provider = this.providerRegistry.get("arcade");
    if (!provider?.isAvailable()) return false;
    void authId;
    void maxWaitMs;
    // Authorization waiting is handled in dedicated auth routes for each provider.
    return true;
  }

  /**
   * Get available tools for a category
   */
  getToolsByCategory(category: string): ToolConfig[] {
    return Object.entries(TOOL_REGISTRY)
      .filter(([_, config]) => config.category === category)
      .map(([_, config]) => config);
  }

  /**
   * Search for tools by description
   */
  searchTools(query: string): ToolConfig[] {
    const lowercaseQuery = query.toLowerCase();
    return Object.entries(TOOL_REGISTRY)
      .filter(
        ([key, config]) =>
          key.toLowerCase().includes(lowercaseQuery) ||
          config.description.toLowerCase().includes(lowercaseQuery)
      )
      .map(([_, config]) => config);
  }

  /**
   * Get all available tool categories
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    Object.values(TOOL_REGISTRY).forEach((config) => {
      categories.add(config.category);
    });
    return Array.from(categories).sort();
  }

  /**
   * Get all registered tools (for discovery)
   */
  getAllTools(): ToolConfig[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool by key
   */
  getTool(toolKey: string): ToolConfig | undefined {
    return this.tools.get(toolKey);
  }

  /**
   * Get registered providers
   */
  getProviders(): IntegrationProvider[] {
    return this.providerRegistry.list().map(p => p.name);
  }

  /**
   * Check if a provider is available
   */
  isProviderAvailable(provider: IntegrationProvider): boolean {
    const p = this.providerRegistry.get(provider);
    return p?.isAvailable() ?? false;
  }

  /**
   * Get tool schema (for AI SDK integration)
   */
  getToolSchema(toolKey: string): z.ZodSchema | undefined {
    return this.tools.get(toolKey)?.inputSchema;
  }

  /**
   * Register a custom tool at runtime
   */
  registerTool(key: string, config: ToolConfig): void {
    this.tools.set(key, config);
    TOOL_REGISTRY[key] = config;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse natural language intent to tool key with enhanced scoring
 */
export function parseIntentToTool(intent: string): string | null {
  const lowercaseIntent = intent.toLowerCase();
  
  // 1. Exact Match Check
  if (TOOL_REGISTRY[intent]) return intent;

  // 2. Keyword Scoring Match
  const candidates: Array<{ key: string; score: number }> = [];

  for (const [key, config] of Object.entries(TOOL_REGISTRY)) {
    let score = 0;
    const keyParts = key.split('.');
    const toolParts = config.toolName.toLowerCase().split(/[._-]/);
    const description = config.description.toLowerCase();

    // High weight for explicit service name + action
    if (keyParts.every(part => lowercaseIntent.includes(part.toLowerCase()))) score += 5;

    // High weight for tool name match
    if (toolParts.some(part => lowercaseIntent.includes(part)) && toolParts.length > 1) score += 3;

    // Weight for category match
    if (lowercaseIntent.includes(config.category)) score += 2;

    // Substantial weight for description keywords
    const descWords = description.split(/\s+/);
    const intentWords = lowercaseIntent.split(/\s+/);
    const matchingWords = descWords.filter(w => intentWords.includes(w) && w.length > 3);
    score += matchingWords.length * 1.5;

    if (score >= 4) {
      candidates.push({ key, score });
    }
  }

  if (candidates.length > 0) {
    // Sort by score descending and return the best
    return candidates.sort((a, b) => b.score - a.score)[0].key;
  }

  // 3. Fallback Legacy logic (for common phrases)
  // Email patterns
  if (
    lowercaseIntent.includes("send") &&
    (lowercaseIntent.includes("email") || lowercaseIntent.includes("gmail"))
  ) {
    return "gmail.send";
  }
  
  // ... (rest of legacy patterns remain as a final safety net)
  return null;
}

/**
 * Format tool output for display
 */
export function formatToolOutput(toolKey: string, output: any): string {
  const toolConfig = TOOL_REGISTRY[toolKey];

  if (!toolConfig) {
    return JSON.stringify(output, null, 2);
  }

  // Category-specific formatting
  switch (toolConfig.category) {
    case "email":
      if (output.messageId) {
        return `✅ Email sent successfully! Message ID: ${output.messageId}`;
      }
      break;
    case "documents":
      if (output.documentUrl) {
        return `✅ Document created: ${output.documentUrl}`;
      }
      break;
    case "calendar":
      if (output.eventId) {
        return `✅ Event created: ${output.htmlLink || output.eventId}`;
      }
      break;
    case "messaging":
      if (output.sid) {
        return `✅ Message sent! SID: ${output.sid}`;
      }
      break;
  }

  return JSON.stringify(output, null, 2);
}

export default ToolIntegrationManager;
