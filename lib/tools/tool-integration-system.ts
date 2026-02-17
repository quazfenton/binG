/**
 * Universal Tool Integration Module for Next.js LLM Chat Apps
 * Supports Arcade.dev and Nango for seamless third-party service integration
 * 
 * Features:
 * - Unified interface for multiple integration providers
 * - Auto-authorization handling
 * - Tool execution with retry logic
 * - Comprehensive service coverage
 */

import Arcade from "@arcadeai/arcadejs";
import { z } from "zod";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type IntegrationProvider = "arcade" | "nango";

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

export interface ToolExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  authRequired?: boolean;
  authUrl?: string;
}

export interface IntegrationConfig {
  arcade?: {
    apiKey: string;
    baseUrl?: string;
  };
  nango?: {
    apiKey: string;
    host?: string;
    connectionId?: string;
  };
}

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
};

// ============================================================================
// MAIN INTEGRATION CLASS
// ============================================================================

export class ToolIntegrationManager {
  private arcadeClient?: Arcade;
  private nangoConfig?: IntegrationConfig["nango"];
  private config: IntegrationConfig;

  constructor(config: IntegrationConfig) {
    this.config = config;

    // Initialize Arcade client if configured
    if (config.arcade?.apiKey) {
      this.arcadeClient = new Arcade({
        apiKey: config.arcade.apiKey,
      });
    }

    // Store Nango config
    if (config.nango) {
      this.nangoConfig = config.nango;
    }
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

    try {
      if (toolConfig.provider === "arcade") {
        return await this.executeArcadeTool(toolConfig, input, context);
      } else if (toolConfig.provider === "nango") {
        return await this.executeNangoTool(toolConfig, input, context);
      } else {
        return {
          success: false,
          error: `Unsupported provider: ${toolConfig.provider}`,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Unknown error occurred",
      };
    }
  }

  /**
   * Execute an Arcade tool with auto-authorization
   */
  private async executeArcadeTool(
    toolConfig: ToolConfig,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    if (!this.arcadeClient) {
      return {
        success: false,
        error: "Arcade client not initialized. Please provide API key.",
      };
    }

    try {
      // Step 1: Authorize the tool only if it requires auth
      // Skip auth for tools marked as requiresAuth: false (e.g., Google Maps, Google News)
      if (toolConfig.requiresAuth !== false) {
        const authResponse = await this.arcadeClient.tools.authorize({
          tool_name: toolConfig.toolName,
          user_id: context.userId,
        });

        // Step 2: If authorization is not completed, return auth URL
        if (authResponse.status !== "completed") {
          return {
            success: false,
            authRequired: true,
            authUrl: authResponse.url,
            error: `Authorization required for ${toolConfig.toolName}`,
          };
        }
      }

      // Step 3: Execute the tool
      const response = await this.arcadeClient.tools.execute({
        tool_name: toolConfig.toolName,
        input: input,
        user_id: context.userId,
      });

      return {
        success: true,
        output: response.output?.value,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Arcade tool execution failed",
      };
    }
  }

  /**
   * Execute a Nango action/sync
   */
  private async executeNangoTool(
    toolConfig: ToolConfig,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    if (!this.nangoConfig) {
      return {
        success: false,
        error: "Nango not configured. Please provide API key and host.",
      };
    }

    try {
      const host = this.nangoConfig.host || "https://api.nango.dev";
      const connectionId = this.nangoConfig.connectionId || context.userId;

      // Extract the integration/provider from the tool name (e.g., "github" from "github.create_issue")
      const integrationId = toolConfig.toolName.split('.')[0];
      const actionName = toolConfig.toolName;

      const response = await fetch(
        `${host}/v1/action/trigger`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.nangoConfig.apiKey}`,
          },
          body: JSON.stringify({
            action_name: actionName,
            connection_id: connectionId,
            integration_id: integrationId,
            input,
          }),
        }
      );

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          authRequired: true,
          authUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/auth/nango/authorize?provider=${integrationId}`,
          error: `Authorization required for ${integrationId}`,
        };
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.error || errorData.message || `Nango request failed: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        output: data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Nango tool execution failed",
      };
    }
  }

  /**
   * Wait for authorization completion
   */
  async waitForAuthorization(
    authId: string,
    maxWaitMs: number = 300000 // 5 minutes
  ): Promise<boolean> {
    if (!this.arcadeClient) {
      throw new Error("Arcade client not initialized");
    }

    try {
      await this.arcadeClient.auth.waitForCompletion(authId, {
        timeout: maxWaitMs,
      });
      return true;
    } catch (error) {
      return false;
    }
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
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse natural language intent to tool key
 */
export function parseIntentToTool(intent: string): string | null {
  const lowercaseIntent = intent.toLowerCase();

  // Email patterns
  if (
    lowercaseIntent.includes("send") &&
    (lowercaseIntent.includes("email") || lowercaseIntent.includes("gmail"))
  ) {
    return "gmail.send";
  }
  if (
    lowercaseIntent.includes("read") &&
    (lowercaseIntent.includes("email") || lowercaseIntent.includes("gmail"))
  ) {
    return "gmail.read";
  }

  // Document patterns
  if (
    (lowercaseIntent.includes("create") || lowercaseIntent.includes("make")) &&
    (lowercaseIntent.includes("doc") || lowercaseIntent.includes("document"))
  ) {
    return "googledocs.create";
  }

  // Spreadsheet patterns
  if (
    lowercaseIntent.includes("spreadsheet") ||
    lowercaseIntent.includes("sheet")
  ) {
    if (lowercaseIntent.includes("create")) return "googlesheets.create";
    if (lowercaseIntent.includes("read")) return "googlesheets.read";
    if (lowercaseIntent.includes("write") || lowercaseIntent.includes("add"))
      return "googlesheets.write";
  }

  // Calendar patterns
  if (lowercaseIntent.includes("calendar") || lowercaseIntent.includes("event")) {
    if (lowercaseIntent.includes("create") || lowercaseIntent.includes("schedule"))
      return "googlecalendar.create";
    if (lowercaseIntent.includes("read") || lowercaseIntent.includes("get"))
      return "googlecalendar.read";
  }

  // SMS patterns
  if (lowercaseIntent.includes("text") || lowercaseIntent.includes("sms")) {
    return "twilio.send_sms";
  }

  // Social media patterns
  if (lowercaseIntent.includes("tweet") || lowercaseIntent.includes("twitter")) {
    return "twitter.post";
  }

  // Search patterns
  if (lowercaseIntent.includes("search")) {
    if (lowercaseIntent.includes("news")) return "googlenews.search";
    if (lowercaseIntent.includes("place") || lowercaseIntent.includes("location"))
      return "googlemaps.search";
    return "exa.search";
  }

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
