/**
 * Centralized OAuth Provider Mapping
 *
 * Single source of truth for:
 * - Which tool provider (Arcade/Nango/Composio) handles which platform
 * - Auth0 connection name mapping
 * - Platform → underlying OAuth provider mapping (e.g. gmail → google)
 *
 * Previously this was duplicated across:
 * - lib/tools/tool-authorization-manager.ts (3 separate hardcoded lists)
 * - lib/oauth/connections.ts (getAuth0ConnectionName)
 * - lib/auth0.ts (PROVIDER_CONNECTION_MAP)
 *
 * All modules should import from here instead.
 */

// ============================================================================
// Auth0 connection names — inlined to avoid importing lib/auth0 at module level
// (auth0.ts triggers database initialization which fails during Next.js build)
// ============================================================================

const AUTH0_CONN = {
  GITHUB: 'github',
  GOOGLE: 'google-oauth2',
  SLACK: 'slack',
  TWITTER: 'twitter',
  LINKEDIN: 'linkedin',
  MICROSOFT: 'windowslive',
} as const;

// ============================================================================
// Tool Provider → Platform OAuth Provider
// ============================================================================

/**
 * Maps tool names (e.g. "gmail.send") to the underlying OAuth platform
 * (e.g. "google"). This determines which OAuth token is needed.
 */
export const TOOL_PROVIDER_MAP: Record<string, string> = {
  // Google suite
  'gmail.send': 'google', 'gmail.read': 'google', 'gmail.search': 'google', 'gmail.draft': 'google',
  'googledocs.create': 'google', 'googledocs.read': 'google', 'googledocs.update': 'google',
  'googlesheets.create': 'google', 'googlesheets.read': 'google', 'googlesheets.write': 'google', 'googlesheets.append': 'google',
  'googlecalendar.create': 'google', 'googlecalendar.read': 'google', 'googlecalendar.update': 'google', 'googlecalendar.delete': 'google',
  'googledrive.upload': 'google', 'googledrive.download': 'google', 'googledrive.list': 'google', 'googledrive.search': 'google',
  'googlemaps.search': 'google', 'googlemaps.directions': 'google', 'googlemaps.geocode': 'google',
  'googlenews.search': 'google',
  // Microsoft / Outlook
  'outlook.send': 'microsoft', 'outlook.read': 'microsoft',
  // Notion
  'notion.create_page': 'notion', 'notion.read_page': 'notion', 'notion.update_page': 'notion', 'notion.search': 'notion',
  // Dropbox
  'dropbox.upload': 'dropbox', 'dropbox.download': 'dropbox', 'dropbox.list': 'dropbox',
  // GitHub
  'github.create_issue': 'github', 'github.list_repos': 'github', 'github.create_pr': 'github', 'github.get_file': 'github', 'github.commit': 'github',
  // Exa
  'exa.search': 'exa', 'exa.find_similar': 'exa',
  // Twilio
  'twilio.send_sms': 'twilio', 'twilio.make_call': 'twilio', 'twilio.receive_sms': 'twilio',
  // Slack
  'slack.send_message': 'slack', 'slack.read_messages': 'slack',
  // Discord
  'discord.send_message': 'discord', 'discord.read_messages': 'discord',
  // Twitter/X
  'twitter.post': 'twitter', 'twitter.read': 'twitter', 'twitter.search': 'twitter',
  // Reddit
  'reddit.post': 'reddit', 'reddit.read': 'reddit', 'reddit.comment': 'reddit',
  // Spotify
  'spotify.play': 'spotify', 'spotify.search': 'spotify', 'spotify.create_playlist': 'spotify', 'spotify.get_current': 'spotify',
  // Vercel
  'vercel.deploy': 'vercel', 'vercel.list_deployments': 'vercel', 'vercel.get_project': 'vercel',
  // Railway
  'railway.deploy': 'railway',
  // Meta tools
  'composio.search_tools': 'composio',
  'composio.execute_tool': 'composio',
  'tambo.format_code': 'tambo',
  'tambo.validate_input': 'tambo',
  'tambo.calculate': 'tambo',
  'mcp.call_tool': 'mcp',
};

/**
 * Tools that don't require user OAuth (use app-level API keys)
 */
export const NO_AUTH_TOOLS = new Set([
  'googlemaps.search', 'googlemaps.directions', 'googlemaps.geocode',
  'googlenews.search',
  'composio.search_tools',
  'tambo.format_code', 'tambo.validate_input', 'tambo.calculate',
  'mcp.call_tool',
]);

// ============================================================================
// Tool Service Assignment — which integration service handles which platform
// ============================================================================

/**
 * Platforms handled by Arcade (Google ecosystem, etc.)
 */
export const ARCADE_PLATFORMS = new Set([
  'google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar',
  'googledrive', 'googlemaps', 'googlenews', 'exa', 'twilio',
  'spotify', 'vercel', 'railway',
]);

/**
 * Platforms handled by Nango
 */
export const NANGO_PLATFORMS = new Set([
  'github', 'slack', 'discord', 'twitter', 'reddit',
]);

/**
 * Get which tool service handles a given platform
 */
export function getToolServiceForPlatform(
  platform: string
): 'arcade' | 'nango' | 'composio' | null {
  if (ARCADE_PLATFORMS.has(platform)) return 'arcade';
  if (NANGO_PLATFORMS.has(platform)) return 'nango';
  // Composio is the catch-all for remaining platforms
  if (platform === 'composio' || platform === 'notion' || platform === 'dropbox' || platform === 'microsoft') return 'composio';
  return null;
}

// ============================================================================
// Auth0 Connection Name Mapping
// ============================================================================

/**
 * Map platform names to Auth0 connection names.
 * Auth0 handles UX-level social logins and provides fallback tokens.
 */
const PLATFORM_TO_AUTH0: Record<string, string> = {
  'github': AUTH0_CONN.GITHUB,
  'google': AUTH0_CONN.GOOGLE,
  'gmail': AUTH0_CONN.GOOGLE,
  'googledocs': AUTH0_CONN.GOOGLE,
  'googlesheets': AUTH0_CONN.GOOGLE,
  'googlecalendar': AUTH0_CONN.GOOGLE,
  'googledrive': AUTH0_CONN.GOOGLE,
  'googlemaps': AUTH0_CONN.GOOGLE,
  'googlenews': AUTH0_CONN.GOOGLE,
  'slack': AUTH0_CONN.SLACK,
  'twitter': AUTH0_CONN.TWITTER,
  'linkedin': AUTH0_CONN.LINKEDIN,
  'microsoft': AUTH0_CONN.MICROSOFT,
  'figma': 'figma', // Figma OAuth connection
};

/**
 * Get Auth0 connection name for a platform, or null if not supported.
 */
export function getAuth0ConnectionForPlatform(platform: string): string | null {
  return PLATFORM_TO_AUTH0[platform] ?? null;
}

// ============================================================================
// Shared Token Resolution — avoid duplicate OAuth for same underlying platform
// ============================================================================

/**
 * Get the underlying OAuth platform for a tool name.
 * e.g. "gmail.send" → "google", "slack.send_message" → "slack"
 */
export function getOAuthPlatformForTool(toolName: string): string | null {
  if (NO_AUTH_TOOLS.has(toolName)) return null;
  return TOOL_PROVIDER_MAP[toolName] ?? null;
}

/**
 * Check if two tools share the same underlying OAuth platform.
 * If so, a single OAuth grant can serve both.
 */
export function toolsShareAuth(toolA: string, toolB: string): boolean {
  const platformA = getOAuthPlatformForTool(toolA);
  const platformB = getOAuthPlatformForTool(toolB);
  if (!platformA || !platformB) return false;
  return platformA === platformB;
}

/**
 * Get the authorization URL for a platform, routing to the correct
 * integration service (Arcade, Nango, Composio, or generic OAuth).
 */
export function getAuthorizationUrlForPlatform(platform: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const service = getToolServiceForPlatform(platform);

  switch (service) {
    case 'arcade':
      return `${baseUrl}/api/auth/arcade/authorize?provider=${platform}&redirect=1`;
    case 'nango':
      return `${baseUrl}/api/auth/nango/authorize?provider=${platform}&redirect=1`;
    case 'composio':
      return `${baseUrl}/api/auth/oauth/initiate?provider=composio`;
    default:
      return `${baseUrl}/api/auth/oauth/initiate?provider=${platform}`;
  }
}
