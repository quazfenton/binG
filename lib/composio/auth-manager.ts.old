/**
 * Composio Auth Manager
 * 
 * Manages authentication configs and connected accounts for Composio.
 * Handles OAuth flows, API keys, and token refresh.
 * 
 * @see https://docs.composio.dev/auth
 */

import { Composio } from '@composio/core';

/**
 * Auth configuration for a toolkit
 */
export interface AuthConfig {
  id: string;
  toolkit: string;
  authMode: 'OAUTH2' | 'API_KEY' | 'BASIC';
  createdAt: string;
  updatedAt: string;
}

/**
 * Connected account for a user
 */
export interface ConnectedAccount {
  id: string;
  authConfigId: string;
  userId: string;
  toolkit: string;
  status: 'active' | 'inactive' | 'expired';
  createdAt: string;
  expiresAt?: string;
}

/**
 * Auth manager for Composio
 */
export class ComposioAuthManager {
  private composio: Composio;

  constructor(apiKey?: string) {
    this.composio = new Composio({
      apiKey: apiKey || process.env.COMPOSIO_API_KEY,
      baseUrl: process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev',
    });
  }

  /**
   * Get or create auth config for toolkit
   */
  async getOrCreateAuthConfig(
    toolkit: string,
    authMode: 'OAUTH2' | 'API_KEY' | 'BASIC' = 'OAUTH2'
  ): Promise<AuthConfig> {
    // Find existing
    const existing = await this.composio.authConfigs.find({ toolkit });
    if (existing) {
      return existing as AuthConfig;
    }

    // Create new
    const created = await this.composio.authConfigs.create({
      toolkit,
      authMode,
    });

    return created as AuthConfig;
  }

  /**
   * List all auth configs
   */
  async listAuthConfigs(): Promise<AuthConfig[]> {
    const configs = await this.composio.authConfigs.list();
    return configs as AuthConfig[];
  }

  /**
   * Get connected accounts for user
   */
  async getConnectedAccounts(userId: string): Promise<ConnectedAccount[]> {
    const accounts = await this.composio.connectedAccounts.list({ userId });
    return accounts.filter((a: any) => a.userId === userId) as ConnectedAccount[];
  }

  /**
   * Get connected account by ID
   */
  async getConnectedAccount(accountId: string): Promise<ConnectedAccount | null> {
    try {
      const account = await this.composio.connectedAccounts.get({ id: accountId });
      return account as ConnectedAccount;
    } catch {
      return null;
    }
  }

  /**
   * Connect account for user
   * 
   * For OAuth2: Returns redirect URL for user to authorize
   * For API Key: Returns immediately with active account
   */
  async connectAccount(
    userId: string,
    toolkit: string,
    authMode: 'OAUTH2' | 'API_KEY' | 'BASIC' = 'OAUTH2',
    options?: {
      redirectUrl?: string;
      apiKey?: string;
    }
  ): Promise<{
    account: ConnectedAccount;
    redirectUrl?: string;
    authUrl?: string;
  }> {
    // Get or create auth config
    const authConfig = await this.getOrCreateAuthConfig(toolkit, authMode);

    // Create connected account
    const account = await this.composio.connectedAccounts.create({
      authConfigId: authConfig.id,
      userId,
    });

    // For OAuth2, get authorization URL
    let redirectUrl: string | undefined;
    let authUrl: string | undefined;

    if (authMode === 'OAUTH2') {
      const authSession = await this.composio.authSessions.create({
        authConfigId: authConfig.id,
        userId,
        redirectUrl: options?.redirectUrl,
      });

      authUrl = authSession.authUrl;
      redirectUrl = authSession.redirectUrl;
    } else if (authMode === 'API_KEY' && options?.apiKey) {
      // For API key auth, update the account with the key
      await this.composio.connectedAccounts.update({
        id: account.id,
        credentials: { apiKey: options.apiKey },
      });
    }

    return {
      account: account as ConnectedAccount,
      redirectUrl,
      authUrl,
    };
  }

  /**
   * Disconnect account
   */
  async disconnectAccount(accountId: string): Promise<void> {
    await this.composio.connectedAccounts.delete({ id: accountId });
  }

  /**
   * Refresh account credentials
   * 
   * For OAuth2: Refreshes access token
   * For API Key: Validates the key is still valid
   */
  async refreshAccount(accountId: string): Promise<ConnectedAccount> {
    const account = await this.composio.connectedAccounts.get({ id: accountId });
    
    // Trigger refresh
    await this.composio.connectedAccounts.refresh({ id: accountId });
    
    // Get updated account
    const updated = await this.composio.connectedAccounts.get({ id: accountId });
    
    return updated as ConnectedAccount;
  }

  /**
   * Check if account is still valid
   */
  async validateAccount(accountId: string): Promise<{
    valid: boolean;
    error?: string;
  }> {
    try {
      const account = await this.composio.connectedAccounts.get({ id: accountId });
      
      // Check status
      if (account.status !== 'active') {
        return {
          valid: false,
          error: `Account status: ${account.status}`,
        };
      }

      // Check expiration
      if (account.expiresAt && new Date(account.expiresAt) < new Date()) {
        return {
          valid: false,
          error: 'Account expired',
        };
      }

      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Get accounts by toolkit
   */
  async getAccountsByToolkit(
    userId: string,
    toolkit: string
  ): Promise<ConnectedAccount[]> {
    const accounts = await this.getConnectedAccounts(userId);
    return accounts.filter(a => a.toolkit === toolkit);
  }

  /**
   * Get account for toolkit (most recently connected)
   */
  async getAccountForToolkit(
    userId: string,
    toolkit: string
  ): Promise<ConnectedAccount | null> {
    const accounts = await this.getAccountsByToolkit(userId, toolkit);
    
    if (accounts.length === 0) {
      return null;
    }

    // Return most recently connected
    return accounts.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  /**
   * Handle OAuth callback
   * 
   * Call this after user completes OAuth flow
   */
  async handleOAuthCallback(
    code: string,
    state: string
  ): Promise<{
    account: ConnectedAccount;
    success: boolean;
  }> {
    try {
      // Exchange code for token
      const result = await this.composio.authSessions.exchange({ code, state });
      
      // Get the connected account
      const account = await this.composio.connectedAccounts.get({
        id: result.connectedAccountId,
      });

      return {
        account: account as ConnectedAccount,
        success: true,
      };
    } catch (error: any) {
      return {
        account: {} as ConnectedAccount,
        success: false,
      };
    }
  }

  /**
   * Get auth URL for user to authorize
   */
  async getAuthUrl(
    userId: string,
    toolkit: string,
    redirectUrl?: string
  ): Promise<string> {
    const result = await this.connectAccount(userId, toolkit, 'OAUTH2', {
      redirectUrl,
    });

    if (!result.authUrl) {
      throw new Error('Failed to get auth URL');
    }

    return result.authUrl;
  }

  /**
   * List available toolkits
   */
  async listToolkits(): Promise<string[]> {
    const toolkits = await this.composio.toolkits.list();
    return toolkits.map((t: any) => t.name);
  }

  /**
   * Search toolkits
   */
  async searchToolkits(query: string): Promise<string[]> {
    const toolkits = await this.composio.toolkits.search({ query });
    return toolkits.map((t: any) => t.name);
  }
}

// Singleton instance
export const composioAuthManager = new ComposioAuthManager();
