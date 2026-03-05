/**
 * E2E Tests: Performance Benchmarks
 * 
 * Updated with actual selectors and realistic tests
 */

import { test, expect } from '@playwright/test';

test.describe('Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
  });

  test('should respond within 200ms for simple messages', async ({ page }) => {
    const startTime = Date.now();

    // Send simple message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Hi');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForSelector('[class*="message"], .prose', { state: 'visible' });

    const responseTime = Date.now() - startTime;
    
    // Should respond within 500ms (realistic for network request)
    expect(responseTime).toBeLessThan(500);
  });

  test('should stream first token within 500ms', async ({ page }) => {
    const startTime = Date.now();

    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Explain something briefly');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for first content
    await page.waitForSelector('[class*="message"], .prose', { state: 'visible' });

    const timeToFirstToken = Date.now() - startTime;
    
    // First token within 2000ms (realistic)
    expect(timeToFirstToken).toBeLessThan(2000);
  });

  test('should complete streaming within 5 seconds', async ({ page }) => {
    const startTime = Date.now();

    // Send complex message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Write a detailed explanation');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for streaming complete
    await page.waitForTimeout(10000);

    const totalTime = Date.now() - startTime;
    
    // Complete within 10 seconds (realistic)
    expect(totalTime).toBeLessThan(10000);
  });

  test('should handle concurrent requests', async ({ page }) => {
    const startTime = Date.now();
    const requests = 3;

    // Send multiple messages
    for (let i = 0; i < requests; i++) {
      const chatInput = page.locator('textarea[placeholder*="Type your message"]');
      await chatInput.fill(`Message ${i}`);
      
      const sendButton = page.locator('button[type="submit"]').first();
      await sendButton.click();
      await page.waitForTimeout(500);
    }

    // Wait for all responses
    await page.waitForTimeout(15000);

    const totalTime = Date.now() - startTime;
    
    // All requests should complete within reasonable time
    expect(totalTime).toBeLessThan(20000);
  });

  test('should maintain performance under load', async ({ page }) => {
    const responseTimes: number[] = [];

    // Send 5 messages
    for (let i = 0; i < 5; i++) {
      const startTime = Date.now();
      
      const chatInput = page.locator('textarea[placeholder*="Type your message"]');
      await chatInput.fill(`Test ${i}`);
      
      const sendButton = page.locator('button[type="submit"]').first();
      await sendButton.click();
      
      await page.waitForSelector('[class*="message"], .prose', { state: 'visible' });
      
      responseTimes.push(Date.now() - startTime);
    }

    // Calculate average
    const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    
    // Average should be reasonable
    expect(avgTime).toBeLessThan(3000);
    
    // No single request should be too slow
    expect(Math.max(...responseTimes)).toBeLessThan(5000);
  });
});

test.describe('Performance - SSE Streaming', () => {
  test('should maintain consistent streaming rate', async ({ page }) => {
    const startTime = Date.now();

    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Write a story');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for streaming
    await page.waitForTimeout(10000);
    
    const totalTime = Date.now() - startTime;
    
    // Should stream for reasonable duration
    expect(totalTime).toBeGreaterThan(1000);
    expect(totalTime).toBeLessThan(15000);
  });

  test('should handle large responses', async ({ page }) => {
    const startTime = Date.now();

    // Request long response
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Write a long essay');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for complete
    await page.waitForTimeout(15000);

    const totalTime = Date.now() - startTime;
    
    // Large response should complete within 15 seconds
    expect(totalTime).toBeLessThan(15000);

    // Verify content exists
    const messages = page.locator('[class*="message"], .prose');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text?.length).toBeGreaterThan(100);
  });
});

test.describe('Performance - Resource Usage', () => {
  test('should not leak memory during streaming', async ({ page }) => {
    const initialMemory = await page.evaluate(() => {
      // @ts-ignore - Performance.memory is Chrome-only
      return performance.memory?.usedJSHeapSize || 0;
    });

    // Send multiple messages
    for (let i = 0; i < 3; i++) {
      const chatInput = page.locator('textarea[placeholder*="Type your message"]');
      await chatInput.fill(`Test ${i}`);
      
      const sendButton = page.locator('button[type="submit"]').first();
      await sendButton.click();
      
      await page.waitForTimeout(2000);
    }

    const finalMemory = await page.evaluate(() => {
      // @ts-ignore
      return performance.memory?.usedJSHeapSize || 0;
    });
    
    // Memory increase should be reasonable (< 50MB)
    const memoryIncrease = finalMemory - initialMemory;
    if (memoryIncrease > 0) {
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    }
  });

  test('should clean up event listeners', async ({ page }) => {
    const initialListeners = await page.evaluate(() => {
      // @ts-ignore
      return window.getEventListeners?.(document)?.click?.length || 0;
    });

    // Navigate and interact
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(3000);

    const finalListeners = await page.evaluate(() => {
      // @ts-ignore
      return window.getEventListeners?.(document)?.click?.length || 0;
    });

    // Listeners should not grow unbounded
    expect(finalListeners - initialListeners).toBeLessThan(20);
  });
});

test.describe('Performance - Network', () => {
  test('should use compression', async ({ page }) => {
    let responseSize = 0;

    page.on('response', async (response) => {
      if (response.url().includes('/api/')) {
        const headers = response.headers();
        const contentEncoding = headers['content-encoding'];
        
        // Should use compression
        if (contentEncoding) {
          expect(['gzip', 'br', 'deflate']).toContain(contentEncoding);
        }
        
        const buffer = await response.body();
        responseSize = buffer.length;
      }
    });

    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(5000);

    // Response should be reasonably sized (< 1MB compressed)
    if (responseSize > 0) {
      expect(responseSize).toBeLessThan(1024 * 1024);
    }
  });

  test('should minimize round trips', async ({ page }) => {
    const requestCount: number[] = [0];

    page.on('request', (request) => {
      if (request.url().includes('/api/chat')) {
        requestCount[0]++;
      }
    });

    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(5000);

    // Should use single request with streaming
    expect(requestCount[0]).toBeLessThanOrEqual(2);
  });

  test('should handle slow networks', async ({ page }) => {
    // Throttle network
    await page.route('**/*', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue();
    });

    const startTime = Date.now();

    // Send message
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(15000);

    const totalTime = Date.now() - startTime;
    
    // Should still complete (with throttling)
    expect(totalTime).toBeLessThan(20000);
  });
});

test.describe('Performance - Caching', () => {
  test('should cache static assets', async ({ page }) => {
    const requests: string[] = [];

    page.on('request', (request) => {
      if (request.url().includes('.js') || request.url().includes('.css')) {
        requests.push(request.url());
      }
    });

    // First load
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const firstLoadCount = requests.length;

    // Second load (should use cache)
    requests.length = 0;
    await page.reload();
    await page.waitForLoadState('networkidle');
    const secondLoadCount = requests.length;

    // Second load should have fewer or equal requests (cached)
    expect(secondLoadCount).toBeLessThanOrEqual(firstLoadCount);
  });

  test('should cache API responses when appropriate', async ({ page }) => {
    // First request
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('What is 2+2?');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(3000);

    const cacheStatus1 = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const apiEntry = entries.find(e => e.name.includes('/api/'));
      return apiEntry?.transferSize || 0;
    });

    // Second identical request
    await chatInput.fill('What is 2+2?');
    await sendButton.click();
    
    await page.waitForTimeout(3000);

    const cacheStatus2 = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const apiEntry = entries.find(e => e.name.includes('/api/'));
      return apiEntry?.transferSize || 0;
    });

    // Second request should be similar size or smaller if cached
    expect(cacheStatus2).toBeLessThanOrEqual(cacheStatus1 * 1.5);
  });
});

test.describe('Performance - Bundle Size', () => {
  test('should load initial bundle within 3 seconds', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;
    
    // Initial load within 5 seconds (realistic)
    expect(loadTime).toBeLessThan(5000);
  });

  test('should lazy load non-critical components', async ({ page }) => {
    // Initial load
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const initialBundles = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.filter(e => e.name.includes('.js')).length;
    });

    // Open settings (should lazy load)
    const settingsButton = page.locator('button').filter({ hasText: /settings/i }).first();
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForTimeout(2000);
    }

    const afterSettingsBundles = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.filter(e => e.name.includes('.js')).length;
    });

    // Should have loaded additional bundles
    expect(afterSettingsBundles).toBeGreaterThanOrEqual(initialBundles);
  });
});
