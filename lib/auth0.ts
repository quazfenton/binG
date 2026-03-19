/**
 * Auth0 Client Configuration
 * 
 * PURPOSE: Sidelayer for AI agent-to-agent implementations, OAuth providers,
 * and 3rd party integrations (GitHub, Composio, Nango, Arcade, etc.)
 * 
 * This runs alongside existing auth system - NOT a replacement.
 * Used for future features requiring external OAuth/API access.
 */

import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client();

/**
 * Connection names for Auth0 social logins and enterprise connections
 */
export const AUTH0_CONNECTIONS = {
  GITHUB: 'github',
  GOOGLE: 'google-oauth2',
  FACEBOOK: 'facebook',
  TWITTER: 'twitter',
  LINKEDIN: 'linkedin',
} as const;

/**
 * Get Auth0 session if available
 * Returns null if user is not authenticated via Auth0
 */
export async function getAuth0Session() {
  try {
    return await auth0.getSession();
  } catch {
    return null;
  }
}

/**
 * Check if user is authenticated via Auth0
 */
export async function isAuth0Authenticated() {
  const session = await getAuth0Session();
  return session !== null;
}

/**
 * Get Auth0 access token for external API calls
 * Used by agent integrations to access 3rd party APIs
 */
export async function getAuth0AccessToken() {
  try {
    return await auth0.getAccessToken();
  } catch {
    return null;
  }
}

/**
 * Get access token for a specific connection (e.g., GitHub, Google)
 * Used to access external APIs with OAuth tokens from social logins
 * 
 * @param connection - The connection name (e.g., 'github', 'google-oauth2')
 * @returns The access token for the connection, or null if not available
 */
export async function getAccessTokenForConnection(connection: string) {
  try {
    const result = await auth0.getAccessTokenForConnection({ connection });
    return result?.token || null;
  } catch {
    return null;
  }
}

/**
 * Get GitHub access token for the authenticated user
 * Requires user to have connected their GitHub account via Auth0
 * 
 * @returns GitHub access token, or null if not available
 */
export async function getGitHubToken() {
  return getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB);
}
