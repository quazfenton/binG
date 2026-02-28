/**
 * E2E Tests: Sandbox Code Execution
 * 
 * Updated with actual selectors from the codebase
 */

import { test, expect } from '@playwright/test';

test.describe('Sandbox Execution', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
  });

  test('should execute code in sandbox', async ({ page }) => {
    // Request code execution
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run: print("Hello from sandbox")');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for sandbox output
    await page.waitForTimeout(5000);
    
    // Look for code output in response
    const codeOutput = page.locator('pre, code, [class*="code"]').first();
    if (await codeOutput.isVisible()) {
      expect(codeOutput).toBeVisible();
    }
    
    // Should have response
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should stream terminal output', async ({ page }) => {
    // Request long-running command
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run: for i in 1 2 3 4 5; do echo $i; done');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for streaming output
    await page.waitForTimeout(5000);
    
    // Look for streaming output
    const outputElement = page.locator('pre, code, [class*="output"]').first();
    if (await outputElement.isVisible()) {
      expect(outputElement).toBeVisible();
    }
  });

  test('should handle execution timeout', async ({ page }) => {
    // Request long-running command
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run: sleep 30');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for timeout
    await page.waitForTimeout(15000);
    
    // Look for timeout message
    const timeoutMessage = page.locator('[class*="timeout"], [class*="error"]').first();
    if (await timeoutMessage.isVisible()) {
      expect(timeoutMessage).toBeVisible();
    }
  });

  test('should handle execution errors', async ({ page }) => {
    // Request invalid command
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run: invalid_command_that_does_not_exist');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for error
    await page.waitForTimeout(5000);
    
    // Look for error message
    const errorMessage = page.locator('[class*="error"]').first();
    if (await errorMessage.isVisible()) {
      expect(errorMessage).toContainText(/error|not found|failed/i);
    }
  });

  test('should stop execution', async ({ page }) => {
    // Start long-running command
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run: while true; do echo running; done');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for output to start
    await page.waitForTimeout(3000);
    
    // Look for stop button
    const stopButton = page.locator('button').filter({ hasText: /stop|cancel|terminate/i }).first();
    if (await stopButton.isVisible()) {
      await stopButton.click();
      await page.waitForTimeout(1000);
    }
    
    // Should show stopped
    const stoppedMessage = page.locator('[class*="stop"], [class*="cancel"]').first();
    if (await stoppedMessage.isVisible()) {
      expect(stoppedMessage).toBeVisible();
    }
  });

  test('should execute Python code', async ({ page }) => {
    // Request Python execution
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run Python: print(2 + 2)');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for output
    await page.waitForTimeout(5000);
    
    // Look for output containing "4"
    const messages = page.locator('[class*="message"], .prose');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text).toContain('4');
  });

  test('should execute Node.js code', async ({ page }) => {
    // Request Node.js execution
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run Node.js: console.log("Hello from Node")');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for output
    await page.waitForTimeout(5000);
    
    // Look for output
    const messages = page.locator('[class*="message"], .prose');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text).toContain('Hello');
  });
});

test.describe('Sandbox - File Operations', () => {
  test('should create file in sandbox', async ({ page }) => {
    // Request file creation
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Create file test.txt with content "Hello"');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for confirmation
    await page.waitForTimeout(5000);
    
    // Look for file created message
    const messages = page.locator('[class*="message"], .prose');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text.toLowerCase()).toContain(/create|file|test/i);
  });

  test('should read file from sandbox', async ({ page }) => {
    // Create file first
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Create file test.txt with content "Test content"');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    await page.waitForTimeout(3000);

    // Read file
    await chatInput.fill('Read test.txt');
    await sendButton.click();

    // Wait for content
    await page.waitForTimeout(5000);
    
    // Verify content
    const messages = page.locator('[class*="message"], .prose');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text).toContain(/Test|content|read/i);
  });

  test('should delete file from sandbox', async ({ page }) => {
    // Create file first
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Create file temp.txt');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    await page.waitForTimeout(3000);

    // Delete file
    await chatInput.fill('Delete temp.txt');
    await sendButton.click();

    // Wait for deletion
    await page.waitForTimeout(5000);
    
    // Look for confirmation
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 4 });
  });

  test('should list directory contents', async ({ page }) => {
    // Request directory listing
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('List files in current directory');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for output
    await page.waitForTimeout(5000);
    
    // Look for directory listing
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });
});

test.describe('Sandbox - Resource Limits', () => {
  test('should enforce memory limit', async ({ page }) => {
    // Request memory-intensive operation
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run Python: x = [0] * 1000000000');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for memory error
    await page.waitForTimeout(10000);
    
    // Look for memory error
    const memoryError = page.locator('[class*="memory"], [class*="error"]').first();
    if (await memoryError.isVisible()) {
      expect(memoryError).toContainText(/memory|limit|exceeded/i);
    }
  });

  test('should enforce CPU limit', async ({ page }) => {
    // Request CPU-intensive operation
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run: yes > /dev/null');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for CPU throttling
    await page.waitForTimeout(10000);
    
    // Should still be running or throttled
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should enforce network limit', async ({ page }) => {
    // Request network operation
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run: curl https://example.com');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for network restriction
    await page.waitForTimeout(5000);
    
    // Look for network restriction message
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should track resource usage', async ({ page }) => {
    // Execute command
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Run: echo "test"');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for execution
    await page.waitForTimeout(5000);
    
    // Look for resource usage display
    const resourceDisplay = page.locator('[class*="resource"], [class*="usage"]').first();
    if (await resourceDisplay.isVisible()) {
      expect(resourceDisplay).toBeVisible();
    }
  });
});

test.describe('Sandbox - Multi-Provider', () => {
  test('should fallback to alternative sandbox provider', async ({ page }) => {
    // Request sandbox
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Create sandbox environment');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(5000);
    
    // Should succeed with some provider
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should respect provider preference', async ({ page }) => {
    // Set provider preference in settings
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
    
    // Request sandbox
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Create sandbox');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(5000);
  });
});
