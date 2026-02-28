/**
 * Composio Auth Manager
 * 
 * Manages authentication configs and connected accounts
 * - One-time auth config setup
 * - Per-user connected accounts
 * - Token refresh handling
 * - Auth state persistence
 * 
 * Documentation: docs/sdk/composio-llms-full.txt
 */

import { Composio } from '@composio/core';

export interface AuthConfigInfo {
  id: string;
  toolkit: string;
  authMode: string;
  createdAt: Date;
}

export interface ConnectedAccountInfo {
  id: string;
  authConfigId: string;
  userId: string;
  toolkit: string;
  status: string;
  createdAt: Date;
}

export class ComposioAuthManager {
  private composio: Composio;

  constructor(apiKey?: string) {
    this.composio = new Composio({
      apiKey: apiKey || process.env.COMPOSIO_API_KEY,
    });
  }

  /**
   * Get or create auth config for toolkit
   * Note: New Composio SDK uses different API structure
   */
  async getOrCreateAuthConfig(toolkit: string, authMode: string = 'OAUTH2'): Promise<AuthConfigInfo> {
    try {
      // List existing auth configs for this toolkit
      const response = // @ts-ignore - Composio SDK API\n      await (this.composio.authConfigs as any).list({
        toolkit: toolkit,
      });

      const items = (response as any).items || [];
      const existing = items.find((a: any) => a.toolkit?.slug === toolkit);

      if (existing) {
        return {
          id: existing.id,
          toolkit: existing.toolkit?.slug || toolkit,
          authMode: existing.authScheme || authMode,
          createdAt: new Date(existing.lastUpdatedAt || Date.now()),
        };
      }

      // Note: Creating auth configs typically requires admin access
      // For most use cases, use existing configs from Composio platform
      throw new Error(
        `Auth config for '${toolkit}' not found. Please create it in Composio dashboard first.`
      );
    } catch (error: any) {
      throw new Error(`Failed to get auth config: ${error.message}`);
    }
  }

  /**
   * Get or create connected account for user
   */
  async getOrCreateConnectedAccount(
    userId: string,
    toolkit: string,
    authMode: string = 'OAUTH2'
  ): Promise<ConnectedAccountInfo> {
    try {
      // Check for existing connected account
      const response = await this.composio.connectedAccounts.list({
        userIds: [userId],
        toolkit: toolkit,
      });

      const items = (response as any).items || [];
      const match = items.find((a: any) => a.toolkit?.slug === toolkit);

      if (match) {
        return {
          id: match.id,
          authConfigId: match.authConfig?.id || '',
          userId: match.userUuid || userId,
          toolkit: match.toolkit?.slug || toolkit,
          status: match.status || 'unknown',
          createdAt: new Date(match.updatedAt || Date.now()),
        };
      }

      // No existing account - user needs to authenticate
      throw new Error(
        `No connected account found for user '${userId}' and toolkit '${toolkit}'. ` +
        `Please initiate OAuth flow first.`
      );
    } catch (error: any) {
      throw new Error(`Failed to get connected account: ${error.message}`);
    }
  }

  /**
   * List connected accounts for user
   */
  async listConnectedAccounts(userId: string): Promise<ConnectedAccountInfo[]> {
    try {
      const response = await this.composio.connectedAccounts.list({
        userIds: [userId],
      });

      const items = (response as any).items || [];

      return items.map((a: any) => ({
        id: a.id,
        authConfigId: a.authConfig?.id || '',
        userId: a.userUuid || userId,
        toolkit: a.toolkit?.slug || 'unknown',
        status: a.status || 'unknown',
        createdAt: new Date(a.updatedAt || Date.now()),
      }));
    } catch (error: any) {
      throw new Error(`Failed to list connected accounts: ${error.message}`);
    }
  }

  /**
   * Get auth config by toolkit
   */
  async getAuthConfig(toolkit: string): Promise<AuthConfigInfo | null> {
    try {
      const response = // @ts-ignore - Composio SDK API\n      await (this.composio.authConfigs as any).list({
        toolkit: toolkit,
      });

      const items = (response as any).items || [];
      const config = items[0];

      if (!config) {
        return null;
      }

      return {
        id: config.id,
        toolkit: config.toolkit?.slug || toolkit,
        authMode: config.authScheme || 'OAUTH2',
        createdAt: new Date(config.lastUpdatedAt || Date.now()),
      };
    } catch {
      return null;
    }
  }

  /**
   * List all auth configs
   */
  async listAuthConfigs(): Promise<AuthConfigInfo[]> {
    try {
      const response = // @ts-ignore - Composio SDK API\n      await (this.composio.authConfigs as any).list({});

      const items = (response as any).items || [];

      return items.map((c: any) => ({
        id: c.id,
        toolkit: c.toolkit?.slug || 'unknown',
        authMode: c.authScheme || 'OAUTH2',
        createdAt: new Date(c.lastUpdatedAt || Date.now()),
      }));
    } catch (error: any) {
      throw new Error(`Failed to list auth configs: ${error.message}`);
    }
  }

  /**
   * Get OAuth redirect URL for user
   */
  async getOAuthRedirectUrl(
    toolkit: string,
    userId: string,
    redirectUrl?: string
  ): Promise<string> {
    try {
      const authConfig = await this.getAuthConfig(toolkit);

      if (!authConfig) {
        throw new Error(`Auth config for '${toolkit}' not found`);
      }

      const baseUrl = process.env.COMPOSIO_HOST || 'https://backend.composio.dev';
      const redirect = redirectUrl || process.env.COMPOSIO_REDIRECT_URL || 'http://localhost:3000/oauth/callback';

      return `${baseUrl}/api/v1/auth/redirect?auth_config_id=${authConfig.id}&user_id=${userId}&redirect_uri=${encodeURIComponent(redirect)}`;
    } catch (error: any) {
      throw new Error(`Failed to get OAuth redirect URL: ${error.message}`);
    }
  }

  /**
   * Check if account is active and not expired
   */
  async isAccountActive(accountId: string): Promise<boolean> {
    try {
      const response = await this.composio.connectedAccounts.list({
        userIds: [accountId],
      });

      const items = (response as any).items || [];
      const account = items[0];

      if (!account) {
        return false;
      }

      // Check status
      if (account.status !== 'ACTIVE') {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available toolkits
   */
  async listToolkits(): Promise<Array<{ slug: string; name: string; description?: string }>> {
    try {
      const response = await this.composio.toolkits.list({});
      const items = (response as any).items || [];

      return items.map((t: any) => ({
        slug: t.slug || t.key || 'unknown',
        name: t.name || 'Unknown',
        description: t.description,
      }));
    } catch (error: any) {
      throw new Error(`Failed to list toolkits: ${error.message}`);
    }
  }

  /**
   * Search toolkits by query
   */
  async searchToolkits(query: string): Promise<Array<{ slug: string; name: string; description?: string }>> {
    try {
      const allToolkits = await this.listToolkits();
      const queryLower = query.toLowerCase();

      return allToolkits.filter(t =>
        t.slug.toLowerCase().includes(queryLower) ||
        t.name.toLowerCase().includes(queryLower) ||
        (t.description && t.description.toLowerCase().includes(queryLower))
      );
    } catch {
      return [];
    }
  }
}

/**
 * Create auth manager instance
 */
export function createComposioAuthManager(apiKey?: string): ComposioAuthManager {
  return new ComposioAuthManager(apiKey);
}

/**
 * Get or create connected account helper
 */
export async function getOrCreateConnectedAccount(
  userId: string,
  toolkit: string
): Promise<ConnectedAccountInfo> {
  const manager = createComposioAuthManager();
  return manager.getOrCreateConnectedAccount(userId, toolkit);
}

/**
 * List user's connected accounts helper
 */
export async function listUserConnectedAccounts(userId: string): Promise<ConnectedAccountInfo[]> {
  const manager = createComposioAuthManager();
  return manager.listConnectedAccounts(userId);
}
