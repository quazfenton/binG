/**
 * Figma OAuth Configuration
 * 
 * Configuration for Figma OAuth 2.0 flow with PKCE
 * 
 * @see https://www.figma.com/developers/api#oauth2
 */

export const FIGMA_OAUTH_CONFIG = {
  /**
   * Figma OAuth authorization URL
   */
  authUrl: 'https://www.figma.com/oauth',
  
  /**
   * Figma OAuth token exchange URL
   */
  tokenUrl: 'https://www.figma.com/api/oauth/token',
  
  /**
   * OAuth scopes requested
   * - file_read: Read file structure and content
   * - file_comments:read: Read comments
   * - file_comments:write: Create comments
   */
  scopes: 'file_read file_comments:read',
  
  /**
   * Environment variable for client ID
   */
  clientIdEnv: 'FIGMA_CLIENT_ID',
  
  /**
   * Environment variable for client secret
   */
  clientSecretEnv: 'FIGMA_CLIENT_SECRET',
  
  /**
   * Default redirect URI (should match OAuth app settings)
   */
  defaultRedirectUri: '/api/integrations/figma/callback',
} as const;

/**
 * Figma API base URL
 */
export const FIGMA_API_BASE = 'https://api.figma.com/v1';

/**
 * Check if Figma OAuth is configured
 */
export function isFigmaConfigured(): boolean {
  return !!(
    process.env.FIGMA_CLIENT_ID &&
    process.env.FIGMA_CLIENT_SECRET
  );
}

/**
 * Get Figma client ID
 */
export function getFigmaClientId(): string | undefined {
  return process.env.FIGMA_CLIENT_ID;
}

/**
 * Get Figma client secret
 */
export function getFigmaClientSecret(): string | undefined {
  return process.env.FIGMA_CLIENT_SECRET;
}

/**
 * Get redirect URI for Figma OAuth
 */
export function getFigmaRedirectUri(baseUrl?: string): string {
  const customUri = process.env.FIGMA_REDIRECT_URI;
  if (customUri) {
    return customUri;
  }
  
  const appUrl = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${appUrl}${FIGMA_OAUTH_CONFIG.defaultRedirectUri}`;
}

/**
 * Validate Figma configuration
 */
export function validateFigmaConfig(): { valid: boolean; missing?: string[] } {
  const missing: string[] = [];
  
  if (!process.env.FIGMA_CLIENT_ID) {
    missing.push('FIGMA_CLIENT_ID');
  }
  
  if (!process.env.FIGMA_CLIENT_SECRET) {
    missing.push('FIGMA_CLIENT_SECRET');
  }
  
  if (!process.env.NEXT_PUBLIC_APP_URL && !process.env.FIGMA_REDIRECT_URI) {
    missing.push('NEXT_PUBLIC_APP_URL or FIGMA_REDIRECT_URI');
  }
  
  return {
    valid: missing.length === 0,
    missing: missing.length > 0 ? missing : undefined,
  };
}
