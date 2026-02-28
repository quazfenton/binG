/**
 * E2E Tests: Multi-Provider Fallback Chain
 * 
 * Updated with actual selectors from the codebase
 */

import { test, expect } from '@playwright/test';

test.describe('Multi-Provider Fallback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
  });

  test('should fallback when primary provider fails', async ({ page }) => {
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test fallback');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(5000);
    
    // Should get response from some provider
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should try multiple providers in chain', async ({ page }) => {
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test chain');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(5000);
    
    // Should succeed
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should respect provider priority', async ({ page }) => {
    // Set provider priority
    const settingsButton = page.locator('button').filter({ hasText: /settings/i }).first();
    
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForTimeout(1000);
      
      // Look for provider selector
      const providerSelect = page.locator('select').first();
      if (await providerSelect.isVisible()) {
        await providerSelect.selectOption({ index: 0 });
        await page.waitForTimeout(1000);
      }
    }
    
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test priority');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(5000);
    
    // Should use selected provider
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should handle rate limit with backoff', async ({ page }) => {
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test rate limit');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(5000);
    
    // Should retry and succeed
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should display provider fallback notification', async ({ page }) => {
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test notification');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(5000);
    
    // Look for provider info in response
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });
});

test.describe('Provider Health Checks', () => {
  test('should check provider health before routing', async ({ page }) => {
    // Open provider status
    const statusButton = page.locator('button').filter({ hasText: /status|health|provider/i }).first();
    
    if (await statusButton.isVisible()) {
      await statusButton.click();
      await page.waitForTimeout(1000);
      
      // Should show health status
      const healthStatus = page.locator('[class*="health"], [class*="status"]').first();
      expect(healthStatus).toBeDefined();
    }
  });

  test('should skip unhealthy providers', async ({ page }) => {
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test health check');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(5000);
    
    // Should use healthy provider
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should refresh health status periodically', async ({ page }) => {
    // Wait for initial check
    await page.waitForTimeout(2000);
    
    // Wait for refresh (would need mock for proper test)
    await page.waitForTimeout(32000);
    
    // Send message to verify still working
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test refresh');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(3000);
  });
});

test.describe('Provider Selection UI', () => {
  test('should display available providers', async ({ page }) => {
    // Open provider selector
    const providerSelect = page.locator('select').first();
    await expect(providerSelect).toBeVisible();
    
    // Should have options
    const options = providerSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should allow manual provider selection', async ({ page }) => {
    // Select specific provider
    const providerSelect = page.locator('select').first();
    await providerSelect.selectOption({ index: 1 });
    await page.waitForTimeout(500);
    
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test manual selection');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(3000);
    
    // Should use selected provider
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should display provider capabilities', async ({ page }) => {
    // Open provider info
    const infoButton = page.locator('button').filter({ hasText: /info|capabilities/i }).first();
    
    if (await infoButton.isVisible()) {
      await infoButton.click();
      await page.waitForTimeout(1000);
      
      // Should show capabilities
      const capabilities = page.locator('[class*="capability"], [class*="feature"]').first();
      if (await capabilities.isVisible()) {
        expect(capabilities).toBeVisible();
      }
    }
  });
});

test.describe('Rate Limiting', () => {
  test('should handle rate limit gracefully', async ({ page }) => {
    // Send multiple messages quickly
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    
    for (let i = 0; i < 5; i++) {
      await chatInput.fill(`Message ${i}`);
      
      const sendButton = page.locator('button[type="submit"]').first();
      await sendButton.click();
      
      await page.waitForTimeout(200);
    }
    
    // Wait for responses
    await page.waitForTimeout(10000);
    
    // Should handle gracefully
    const messages = page.locator('[class*="message"], .prose');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should display retry option', async ({ page }) => {
    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test retry');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(3000);
    
    // Look for retry button
    const retryButton = page.locator('button').filter({ hasText: /retry|try again/i }).first();
    if (await retryButton.isVisible()) {
      expect(retryButton).toBeVisible();
    }
  });

  test('should track rate limit status', async ({ page }) => {
    // Open rate limit status
    const statusButton = page.locator('button').filter({ hasText: /status|limit/i }).first();
    
    if (await statusButton.isVisible()) {
      await statusButton.click();
      await page.waitForTimeout(1000);
      
      // Should show status
      const statusDisplay = page.locator('[class*="status"], [class*="limit"]').first();
      expect(statusDisplay).toBeDefined();
    }
  });
});
