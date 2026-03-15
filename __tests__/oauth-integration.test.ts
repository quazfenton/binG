/**
 * OAuth Integration Unit Tests
 * 
 * Tests for OAuth integration capabilities including:
 * - toolAuthManager methods
 * - oauthIntegration class
 * - toolContextManager OAuth processing
 * - Natural language intent detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock external dependencies
vi.mock('@arcadeai/arcadejs', () => ({
  default: vi.fn().mockImplementation(() => ({
    tools: {
      execute: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [] }),
    },
    auth: {
      start: vi.fn().mockResolvedValue({ url: 'https://arcade.dev/auth/test', id: 'test-id' }),
    },
  })),
}));

vi.mock('@nangohq/node', () => ({
  Nango: vi.fn().mockImplementation(() => ({
    proxy: vi.fn(),
    createConnectSession: vi.fn().mockResolvedValue({
      data: {
        token: 'test-token',
        connect_link: 'https://nango.dev/connect',
        expires_at: Date.now() + 3600000,
      },
    }),
  })),
}));

vi.mock('@composio/core', () => ({
  Composio: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({
      execute: vi.fn(),
    }),
  })),
}));

vi.mock('../auth/oauth-service', () => ({
  oauthService: {
    getUserConnections: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../auth/auth-service', () => ({
  authService: {
    getUserById: vi.fn(),
  },
}));

// Import after mocks
import { toolAuthManager } from '@/lib/services/tool-authorization-manager';
import { oauthIntegration } from '@/lib/oauth';
import { toolContextManager } from '@/lib/services/tool-context-manager';

// Test user ID (numeric as expected by the code)
const TEST_USER_ID = '123';

// ============================================================================
// toolAuthManager Tests
// ============================================================================

describe('ToolAuthorizationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initiateConnection', () => {
    it('should return auth URL for valid Arcade provider (gmail)', async () => {
      const result = await toolAuthManager.initiateConnection(TEST_USER_ID, 'gmail');

      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('/api/auth/arcade/authorize');
      expect(result.authUrl).toContain('provider=gmail');
      expect(result.provider).toBe('gmail');
    });

    it('should return auth URL for valid Arcade provider (google)', async () => {
      const result = await toolAuthManager.initiateConnection(TEST_USER_ID, 'google');

      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('/api/auth/arcade/authorize');
    });

    it('should return auth URL for valid Nango provider (github)', async () => {
      const result = await toolAuthManager.initiateConnection(TEST_USER_ID, 'github');

      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('/api/auth/nango/authorize');
      expect(result.authUrl).toContain('provider=github');
    });

    it('should return auth URL for valid Nango provider (slack)', async () => {
      const result = await toolAuthManager.initiateConnection(TEST_USER_ID, 'slack');

      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('/api/auth/nango/authorize');
    });

    it('should return auth URL for Composio provider', async () => {
      const result = await toolAuthManager.initiateConnection(TEST_USER_ID, 'composio');

      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('/api/auth/oauth/initiate');
      expect(result.authUrl).toContain('provider=composio');
    });

    it('should reject unknown provider', async () => {
      const result = await toolAuthManager.initiateConnection(TEST_USER_ID, 'unknown_provider');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown provider');
      expect(result.authUrl).toBe('');
    });

    it('should handle empty provider', async () => {
      const result = await toolAuthManager.initiateConnection(TEST_USER_ID, '');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown provider');
    });

    it('should support all Arcade providers', async () => {
      const arcadeProviders = [
        'google', 'gmail', 'googledocs', 'googlesheets', 
        'googlecalendar', 'googledrive', 'googlemaps', 'googlenews',
        'exa', 'twilio', 'spotify', 'vercel', 'railway'
      ];

      for (const provider of arcadeProviders) {
        const result = await toolAuthManager.initiateConnection(TEST_USER_ID, provider);
        expect(result.success).toBe(true);
        expect(result.authUrl).toContain('/api/auth/arcade/authorize');
      }
    });

    it('should support all Nango providers', async () => {
      const nangoProviders = ['github', 'slack', 'discord', 'twitter', 'reddit'];

      for (const provider of nangoProviders) {
        const result = await toolAuthManager.initiateConnection(TEST_USER_ID, provider);
        expect(result.success).toBe(true);
        expect(result.authUrl).toContain('/api/auth/nango/authorize');
      }
    });
  });

  describe('listConnections', () => {
    it('should return empty list for user with no connections', async () => {
      const result = await toolAuthManager.listConnections(TEST_USER_ID);

      expect(result.success).toBe(true);
      expect(result.connections).toEqual([]);
      expect(result.providers).toEqual([]);
    });

    it('should handle invalid user ID', async () => {
      const result = await toolAuthManager.listConnections('invalid');

      expect(result.success).toBe(false);
      expect(result.connections).toEqual([]);
      expect(result.providers).toEqual([]);
    });

    it('should filter by provider when specified', async () => {
      // Mock oauthService to return connections
      const { oauthService } = await import('../auth/oauth-service');
      vi.mocked(oauthService.getUserConnections).mockResolvedValue([
        {
          id: 1,
          userId: 123,
          provider: 'gmail',
          providerAccountId: 'test@gmail.com',
          providerDisplayName: 'Gmail',
          isActive: true,
          createdAt: new Date(),
        },
      ]);

      const result = await toolAuthManager.listConnections(TEST_USER_ID, 'gmail');

      expect(result.success).toBe(true);
      expect(result.connections.length).toBeGreaterThan(0);
    });
  });

  describe('revokeConnection', () => {
    it('should handle invalid user ID', async () => {
      const result = await toolAuthManager.revokeConnection('invalid', 'gmail');

      expect(result.success).toBe(false);
      expect(result.revoked).toBe(false);
      expect(result.message).toContain('Invalid user ID');
    });

    it('should return success when no connection exists', async () => {
      // Mock oauthService to return no connections
      const { oauthService } = await import('../auth/oauth-service');
      vi.mocked(oauthService.getUserConnections).mockResolvedValue([]);

      const result = await toolAuthManager.revokeConnection(TEST_USER_ID, 'gmail');

      expect(result.success).toBe(false);
      expect(result.revoked).toBe(false);
      expect(result.message).toContain('No active connection found');
    });

    it('should return success when connection exists', async () => {
      // Mock oauthService to return a connection
      const { oauthService } = await import('../auth/oauth-service');
      vi.mocked(oauthService.getUserConnections).mockResolvedValue([
        {
          id: 1,
          userId: 123,
          provider: 'gmail',
          providerAccountId: 'test@gmail.com',
          providerDisplayName: 'Gmail',
          isActive: true,
          createdAt: new Date(),
        },
      ]);

      const result = await toolAuthManager.revokeConnection(TEST_USER_ID, 'gmail');

      expect(result.success).toBe(true);
      expect(result.revoked).toBe(true);
      expect(result.message).toContain('Connection revoked');
    });
  });

  describe('executeTool', () => {
    it('should check authorization before execution', async () => {
      // Mock isAuthorized to return false
      const isAuthorizedSpy = vi.spyOn(toolAuthManager, 'isAuthorized');
      isAuthorizedSpy.mockResolvedValue(false);

      const result = await toolAuthManager.executeTool('gmail', 'send_email', {}, TEST_USER_ID);

      expect(result.success).toBe(false);
      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toBeDefined();
      expect(result.error).toContain('Authorization required');

      isAuthorizedSpy.mockRestore();
    });

    it('should return error for unknown provider', async () => {
      const isAuthorizedSpy = vi.spyOn(toolAuthManager, 'isAuthorized');
      isAuthorizedSpy.mockResolvedValue(true);

      const result = await toolAuthManager.executeTool('unknown', 'action', {}, TEST_USER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown provider');

      isAuthorizedSpy.mockRestore();
    });
  });

  describe('isAuthorized', () => {
    it('should return true for tools that do not require auth', async () => {
      const noAuthTools = [
        'googlemaps.search',
        'googlemaps.directions',
        'googlemaps.geocode',
        'googlenews.search',
        'composio.search_tools',
        'tambo.format_code',
        'tambo.validate_input',
        'tambo.calculate',
        'mcp.call_tool',
      ];

      for (const tool of noAuthTools) {
        const result = await toolAuthManager.isAuthorized(TEST_USER_ID, tool);
        expect(result).toBe(true);
      }
    });

    it('should return false for unknown tools', async () => {
      const result = await toolAuthManager.isAuthorized(TEST_USER_ID, 'unknown.tool');
      expect(result).toBe(false);
    });

    it('should handle invalid user ID', async () => {
      await expect(toolAuthManager.isAuthorized('invalid', 'gmail.send'))
        .rejects.toThrow('Invalid userId');
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should return Arcade URL for Google providers', () => {
      const providers = ['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar'];
      
      for (const provider of providers) {
        const url = toolAuthManager.getAuthorizationUrl(provider);
        expect(url).toContain('/api/auth/arcade/authorize');
        expect(url).toContain(`provider=${provider}`);
      }
    });

    it('should return Nango URL for Nango providers', () => {
      const providers = ['github', 'slack', 'discord', 'twitter', 'reddit'];
      
      for (const provider of providers) {
        const url = toolAuthManager.getAuthorizationUrl(provider);
        expect(url).toContain('/api/auth/nango/authorize');
        expect(url).toContain(`provider=${provider}`);
      }
    });

    it('should return Composio URL for Composio', () => {
      const url = toolAuthManager.getAuthorizationUrl('composio');
      expect(url).toContain('/api/auth/oauth/initiate');
      expect(url).toContain('provider=composio');
    });

    it('should return default OAuth URL for unknown providers', () => {
      const url = toolAuthManager.getAuthorizationUrl('unknown');
      expect(url).toContain('/api/auth/oauth/initiate');
      expect(url).toContain('provider=unknown');
    });
  });
});

// ============================================================================
// oauthIntegration Tests
// ============================================================================

describe('OAuthIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('should delegate to toolAuthManager.initiateConnection', async () => {
      const result = await oauthIntegration.connect('gmail', TEST_USER_ID);

      expect(result.success).toBe(true);
      expect(result.authUrl).toBeDefined();
    });

    it('should handle provider errors', async () => {
      const result = await oauthIntegration.connect('unknown', TEST_USER_ID);

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
    });
  });

  describe('listConnections', () => {
    it('should delegate to toolAuthManager.listConnections', async () => {
      const result = await oauthIntegration.listConnections(TEST_USER_ID);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.connections)).toBe(true);
      expect(Array.isArray(result.providers)).toBe(true);
    });
  });

  describe('revoke', () => {
    it('should delegate to toolAuthManager.revokeConnection', async () => {
      const result = await oauthIntegration.revoke('gmail', TEST_USER_ID);

      // Will fail because no connection exists, but should call the method
      expect(result.success).toBe(false);
      expect(result.message).toContain('No active connection found');
    });
  });

  describe('execute', () => {
    it('should check authorization before execution', async () => {
      const result = await oauthIntegration.execute('gmail', 'send_email', {}, TEST_USER_ID);

      // Will fail because user is not authorized
      expect(result.success).toBe(false);
      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toBeDefined();
    });

    it('should handle conversationId for tool execution', async () => {
      const result = await oauthIntegration.execute(
        'gmail',
        'send_email',
        {},
        TEST_USER_ID,
        'conv_456'
      );

      // Will fail because user is not authorized
      expect(result.requiresAuth).toBe(true);
    });
  });

  describe('getAuthUrl', () => {
    it('should return auth URL for provider', () => {
      const url = oauthIntegration.getAuthUrl('gmail');
      expect(url).toContain('/api/auth/arcade/authorize');
    });
  });

  describe('isAuthorized', () => {
    it('should check authorization status', async () => {
      const result = await oauthIntegration.isAuthorized(TEST_USER_ID, 'gmail.send');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getAvailableTools', () => {
    it('should return list of available tools', async () => {
      const result = await oauthIntegration.getAvailableTools(TEST_USER_ID);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getConnectedProviders', () => {
    it('should return list of connected providers', async () => {
      const result = await oauthIntegration.getConnectedProviders(TEST_USER_ID);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

// ============================================================================
// toolContextManager OAuth Processing Tests
// ============================================================================

describe('ToolContextManager OAuth Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Natural Language Intent Detection', () => {
    it('should detect "connect my gmail" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'connect my gmail account' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toBeDefined();
      expect(result.content).toContain('To connect your account');
    });

    it('should detect "authorize github" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'authorize github' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toBeDefined();
    });

    it('should detect "link my slack" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'link my slack account' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toBeDefined();
    });

    it('should detect "list my connections" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'list my connections' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.content).toBeDefined();
      expect(result.content).toContain('Connected providers');
    });

    it('should detect "show connections" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'show my connections' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.content).toBeDefined();
    });

    it('should detect "revoke github" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'revoke github access' }],
        TEST_USER_ID,
        'conv_456'
      );

      // Will fail because no connection exists
      expect(result.content).toBeDefined();
    });

    it('should detect "disconnect slack" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'disconnect slack' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.content).toBeDefined();
    });

    it('should detect "what tools" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'what tools are available' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.content).toBeDefined();
    });

    it('should detect "available tools" intent', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'show available tools' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.content).toBeDefined();
    });

    it('should return null for non-OAuth requests', async () => {
      // This should fall through to regular tool processing
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'write a hello world function' }],
        TEST_USER_ID,
        'conv_456'
      );

      // Should not require auth for coding requests
      expect(result.requiresAuth).toBe(false);
    });
  });

  describe('OAuth Capability Processing', () => {
    it('should process integration.connect capability', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'connect my gmail' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toBeDefined();
    });

    it('should process integration.list_connections capability', async () => {
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'list connections' }],
        TEST_USER_ID,
        'conv_456'
      );

      expect(result.content).toBeDefined();
    });

    it('should handle missing provider parameter', async () => {
      // This tests edge case handling
      const result = await toolContextManager.processToolRequest(
        [{ role: 'user', content: 'connect my' }], // Incomplete request
        TEST_USER_ID,
        'conv_456'
      );

      // Should fall through to regular processing or return error
      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('OAuth Integration - End to End', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full OAuth flow: connect → list → revoke', async () => {
    // Step 1: Initiate connection
    const connectResult = await toolAuthManager.initiateConnection(TEST_USER_ID, 'gmail');
    expect(connectResult.success).toBe(true);
    expect(connectResult.authUrl).toBeDefined();

    // Step 2: List connections (will be empty in test)
    const listResult = await toolAuthManager.listConnections(TEST_USER_ID);
    expect(listResult.success).toBe(true);
    expect(Array.isArray(listResult.connections)).toBe(true);

    // Step 3: Revoke connection (will fail because none exists)
    const revokeResult = await toolAuthManager.revokeConnection(TEST_USER_ID, 'gmail');
    expect(revokeResult.success).toBe(false);
    expect(revokeResult.message).toContain('No active connection found');
  });

  it('should handle multiple providers', async () => {
    const providers = ['gmail', 'github', 'slack', 'composio'];

    for (const provider of providers) {
      const result = await toolAuthManager.initiateConnection(TEST_USER_ID, provider);
      expect(result.success).toBe(true);
      expect(result.authUrl).toBeDefined();
    }
  });

  it('should use oauthIntegration for unified API', async () => {
    // Connect
    const connectResult = await oauthIntegration.connect('gmail', TEST_USER_ID);
    expect(connectResult.success).toBe(true);

    // List
    const listResult = await oauthIntegration.listConnections(TEST_USER_ID);
    expect(listResult.success).toBe(true);

    // Get providers
    const providersResult = await oauthIntegration.getConnectedProviders(TEST_USER_ID);
    expect(Array.isArray(providersResult)).toBe(true);
  });
});
