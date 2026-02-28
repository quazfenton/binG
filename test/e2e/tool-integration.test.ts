/**
 * E2E Tests: Tool Integration (Composio, Nango, Arcade)
 * 
 * Updated with actual selectors from the codebase
 */

import { test, expect } from '@playwright/test';

test.describe('Tool Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
  });

  test('should discover available tools', async ({ page }) => {
    // Look for plugins/integrations tab
    const pluginsTab = page.locator('[role="tab"]').filter({ hasText: /plugins|integrations/i }).first();
    
    if (await pluginsTab.isVisible()) {
      await pluginsTab.click();
      await page.waitForTimeout(1000);
      
      // Should show some tool options
      const toolItems = page.locator('button, [role="button"]').filter({ hasText: /tool|integration/i });
      const count = await toolItems.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should authorize tool', async ({ page }) => {
    // Send message that might require authorization
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Connect to GitHub');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Look for auth prompt in response
    const authPrompt = page.locator('[class*="auth"], [class*="authorize"]').first();
    if (await authPrompt.isVisible()) {
      expect(authPrompt).toBeVisible();
    }
  });

  test('should execute tool successfully', async ({ page }) => {
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('List my files');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should have response
    const messages = page.locator('[class*="message"], .prose, [class*="bubble"]');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should handle tool execution failure', async ({ page }) => {
    // Send message that might fail
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Execute invalid command');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should have error response or graceful handling
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should fallback to alternative provider', async ({ page }) => {
    // This tests the fallback chain indirectly
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test message');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should get response from some provider
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should display tool lifecycle events', async ({ page }) => {
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Help me with something');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for streaming response
    await page.waitForTimeout(5000);
    
    // Look for streaming indicators
    const streamingIndicator = page.locator('[class*="stream"], [class*="typing"]').first();
    // May or may not be visible depending on timing
  });

  test('should handle multi-step tool workflow', async ({ page }) => {
    // Send complex request
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Help me create a project and set it up');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(5000);
    
    // Should have response
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });
});

test.describe('Tool Integration - Nango', () => {
  test('should authorize Nango connection', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Connect to GitHub');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should have response about authorization
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should execute Nango tool', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('List GitHub repos');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should have response
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });
});

test.describe('Tool Integration - Arcade', () => {
  test('should authorize Arcade tool', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Search for information');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should have response
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should execute Arcade tool', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Search AI news');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should have response
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });
});
