// src/oauth-handler.test.ts
// Tests for oauth-handler.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the actual module
import * as oauthHandler from '../src/oauth-handler';

describe('OAuth Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('performOauthLogin', () => {
    it('should throw error for unsupported provider', async () => {
      // Execute & Verify
      await expect(oauthHandler.performOauthLogin('unsupported' as any))
        .rejects
        .toThrow('Provider unsupported not supported.');
    });
  });

  // Note: Testing the full OAuth flow is complex due to dependencies on global.apiRequest
  // and the HTTP server. For now, we're testing the error case which doesn't require
  // mocking those dependencies.
});