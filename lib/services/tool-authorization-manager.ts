import { oauthService } from '@/lib/auth/oauth-service';

export interface ToolAuthorizationContext {
  userId: string;
  conversationId: string;
  sessionId: string;
}

const TOOL_PROVIDER_MAP: Record<string, string> = {
  'gmail.send': 'google', 'gmail.read': 'google', 'gmail.search': 'google', 'gmail.draft': 'google',
  'outlook.send': 'microsoft', 'outlook.read': 'microsoft',
  'googledocs.create': 'google', 'googledocs.read': 'google', 'googledocs.update': 'google',
  'googlesheets.create': 'google', 'googlesheets.read': 'google', 'googlesheets.write': 'google', 'googlesheets.append': 'google',
  'googlecalendar.create': 'google', 'googlecalendar.read': 'google', 'googlecalendar.update': 'google', 'googlecalendar.delete': 'google',
  'googledrive.upload': 'google', 'googledrive.download': 'google', 'googledrive.list': 'google', 'googledrive.search': 'google',
  'googlemaps.search': 'google', 'googlemaps.directions': 'google', 'googlemaps.geocode': 'google',
  'notion.create_page': 'notion', 'notion.read_page': 'notion', 'notion.update_page': 'notion', 'notion.search': 'notion',
  'dropbox.upload': 'dropbox', 'dropbox.download': 'dropbox', 'dropbox.list': 'dropbox',
  'github.create_issue': 'github', 'github.list_repos': 'github', 'github.create_pr': 'github', 'github.get_file': 'github', 'github.commit': 'github',
  'exa.search': 'exa', 'exa.find_similar': 'exa',
  'twilio.send_sms': 'twilio', 'twilio.make_call': 'twilio', 'twilio.receive_sms': 'twilio',
  'slack.send_message': 'slack', 'slack.read_messages': 'slack',
  'discord.send_message': 'discord', 'discord.read_messages': 'discord',
  'twitter.post': 'twitter', 'twitter.search': 'twitter',
  'reddit.post': 'reddit', 'reddit.search': 'reddit',
  'spotify.play': 'spotify', 'spotify.search': 'spotify', 'spotify.playlist': 'spotify',
  'vercel.deploy': 'vercel', 'railway.deploy': 'railway',
  'googlenews.search': 'google',
};

// Tools that don't require user OAuth (use app-level API keys)
const NO_AUTH_TOOLS = new Set([
  'googlemaps.search', 'googlemaps.directions', 'googlemaps.geocode',
  'googlenews.search',
]);

export class ToolAuthorizationManager {
  async isAuthorized(userId: string, toolName: string): Promise<boolean> {
    if (NO_AUTH_TOOLS.has(toolName)) return true;

    const provider = TOOL_PROVIDER_MAP[toolName];
    if (!provider) return true; // Unknown tools pass through

    // Convert string userId to number for database query
    const numericUserId = Number(userId);
    if (isNaN(numericUserId)) {
      throw new Error(`Invalid userId: ${userId}`);
    }

    // Check if user has an active connection for this provider
    // This works for both traditional OAuth and for Arcade/Nango connections
    const connections = await oauthService.getUserConnections(numericUserId, provider);
    return connections.some(c => c.isActive);
  }

  getRequiredProvider(toolName: string): string | null {
    if (NO_AUTH_TOOLS.has(toolName)) return null;
    return TOOL_PROVIDER_MAP[toolName] ?? null;
  }

  getAuthorizationUrl(provider: string): string {
    // Determine the correct authorization endpoint based on the provider
    const arcadeProviders = ['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar', 'googledrive', 'googlemaps', 'exa', 'twilio', 'spotify', 'vercel', 'railway'];
    const nangoProviders = ['github', 'slack', 'discord', 'twitter', 'reddit'];
    
    // Check if this provider uses Arcade
    if (arcadeProviders.includes(provider)) {
      return `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/auth/arcade/authorize?provider=${provider}`;
    } 
    // Check if this provider uses Nango
    else if (nangoProviders.includes(provider)) {
      return `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/auth/nango/authorize?provider=${provider}`;
    } 
    // Default to standard OAuth flow
    else {
      return `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/auth/oauth/initiate?provider=${provider}`;
    }
  }

  async getAvailableTools(userId: string): Promise<string[]> {
    // Convert string userId to number for database query
    const numericUserId = Number(userId);
    if (isNaN(numericUserId)) {
      throw new Error(`Invalid userId: ${userId}`);
    }

    const connections = await oauthService.getUserConnections(numericUserId);
    const activeProviders = new Set(connections.map(c => c.provider));

    return Object.entries(TOOL_PROVIDER_MAP)
      .filter(([tool, provider]) => NO_AUTH_TOOLS.has(tool) || activeProviders.has(provider))
      .map(([tool]) => tool);
  }

  async getConnectedProviders(userId: string): Promise<string[]> {
    // Convert string userId to number for database query
    const numericUserId = Number(userId);
    if (isNaN(numericUserId)) {
      throw new Error(`Invalid userId: ${userId}`);
    }

    const connections = await oauthService.getUserConnections(numericUserId);
    return [...new Set(connections.map(c => c.provider))];
  }
}

export const toolAuthManager = new ToolAuthorizationManager();
