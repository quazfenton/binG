/**
 * Visual Regression Tests
 * 
 * Tests UI components for visual changes using screenshot comparisons
 * Uses Playwright for screenshot capture
 */

import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
  });

  test('homepage should match baseline', async ({ page }) => {
    await expect(page).toHaveScreenshot('homepage.png', {
      maxDiffPixels: 100, // Allow some pixel differences
      fullPage: true,
    });
  });

  test('chat interface should match baseline', async ({ page }) => {
    const chatPanel = page.locator('[class*="chat-panel"], [class*="interaction-panel"]').first();
    await expect(chatPanel).toHaveScreenshot('chat-interface.png', {
      maxDiffPixels: 50,
    });
  });

  test('message bubbles should match baseline', async ({ page }) => {
    // Send a message to create message bubbles
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test message for visual regression');
    await chatInput.press('Enter');
    
    // Wait for response
    await page.waitForTimeout(3000);
    
    // Screenshot message area
    const messagesArea = page.locator('[class*="messages"], [class*="chat-history"]').first();
    await expect(messagesArea).toHaveScreenshot('message-bubbles.png', {
      maxDiffPixels: 100,
    });
  });

  test('provider selection dropdown should match baseline', async ({ page }) => {
    const providerSelect = page.locator('select').first();
    await expect(providerSelect).toHaveScreenshot('provider-selection.png', {
      maxDiffPixels: 20,
    });
  });

  test('settings panel should match baseline', async ({ page }) => {
    // Open settings if available
    const settingsButton = page.locator('button').filter({ hasText: /settings/i }).first();
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForTimeout(500);
      
      const settingsPanel = page.locator('[class*="settings"], [class*="config"]').first();
      await expect(settingsPanel).toHaveScreenshot('settings-panel.png', {
        maxDiffPixels: 50,
      });
    }
  });

  test('mobile viewport should match baseline', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
    
    await expect(page).toHaveScreenshot('homepage-mobile.png', {
      maxDiffPixels: 100,
      fullPage: true,
    });
  });

  test('dark mode should match baseline', async ({ page }) => {
    // Enable dark mode if available
    await page.emulateMedia({ colorScheme: 'dark' });
    
    await expect(page).toHaveScreenshot('homepage-dark.png', {
      maxDiffPixels: 100,
      fullPage: true,
    });
  });

  test('error state should match baseline', async ({ page }) => {
    // Trigger an error state by sending empty message or simulating error
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('');
    
    // Screenshot error state
    await expect(page).toHaveScreenshot('error-state.png', {
      maxDiffPixels: 50,
    });
  });

  test('loading state should match baseline', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test loading state');
    await chatInput.press('Enter');
    
    // Capture loading state immediately
    await page.waitForTimeout(100);
    
    await expect(page).toHaveScreenshot('loading-state.png', {
      maxDiffPixels: 50,
    });
  });

  test('code block rendering should match baseline', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Show me code: ```typescript\nconst x = 1;\n```');
    await chatInput.press('Enter');
    
    await page.waitForTimeout(3000);
    
    // Screenshot code block
    const codeBlocks = page.locator('pre, [class*="code"], [class*="syntax"]');
    if (await codeBlocks.count() > 0) {
      await expect(codeBlocks.first()).toHaveScreenshot('code-block.png', {
        maxDiffPixels: 50,
      });
    }
  });
});

test.describe('Component Visual Tests', () => {
  test('buttons should have consistent styling', async ({ page }) => {
    const buttons = page.locator('button');
    const count = await buttons.count();
    
    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i);
      if (await button.isVisible()) {
        await expect(button).toHaveScreenshot(`button-${i}.png`, {
          maxDiffPixels: 20,
        });
      }
    }
  });

  test('input fields should have consistent styling', async ({ page }) => {
    const inputs = page.locator('input, textarea');
    const count = await inputs.count();
    
    for (let i = 0; i < Math.min(count, 5); i++) {
      const input = inputs.nth(i);
      if (await input.isVisible()) {
        await expect(input).toHaveScreenshot(`input-${i}.png`, {
          maxDiffPixels: 20,
        });
      }
    }
  });

  test('cards should have consistent styling', async ({ page }) => {
    const cards = page.locator('[class*="card"], [role="region"]');
    const count = await cards.count();
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      const card = cards.nth(i);
      if (await card.isVisible()) {
        await expect(card).toHaveScreenshot(`card-${i}.png`, {
          maxDiffPixels: 30,
        });
      }
    }
  });
});

test.describe('Responsive Visual Tests', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1920, height: 1080 },
  ];

  for (const viewport of viewports) {
    test(`homepage on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });

      await expect(page).toHaveScreenshot(`homepage-${viewport.name}.png`, {
        maxDiffPixels: 100,
        fullPage: true,
      });
    });
  }
});
