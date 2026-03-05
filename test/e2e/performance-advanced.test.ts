/**
 * Advanced Performance Tests with Optimization Recommendations
 * 
 * Tests performance metrics and provides actionable optimization recommendations
 */

import { test, expect } from '@playwright/test';

interface PerformanceMetrics {
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  timeToInteractive: number;
  totalBlockingTime: number;
  cumulativeLayoutShift: number;
  domContentLoaded: number;
  loadComplete: number;
  resourceCount: number;
  totalResourceSize: number;
}

test.describe('Performance Benchmarks', () => {
  test('should meet Core Web Vitals thresholds', async ({ page }) => {
    const metrics: PerformanceMetrics = await page.evaluate(async () => {
      const entries = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const paintEntries = performance.getEntriesByType('paint');
      
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
      const lcpEntry = await new Promise<PerformanceEntry | null>(resolve => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries[entries.length - 1] || null);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => resolve(null), 3000);
      });

      return {
        firstContentfulPaint: fcp?.startTime || 0,
        largestContentfulPaint: lcpEntry?.startTime || 0,
        timeToInteractive: entries?.domInteractive || 0,
        totalBlockingTime: 0, // Requires Long Tasks API
        cumulativeLayoutShift: 0, // Requires Layout Shift API
        domContentLoaded: entries?.domContentLoadedEventEnd || 0,
        loadComplete: entries?.loadEventEnd || 0,
        resourceCount: performance.getEntriesByType('resource').length,
        totalResourceSize: performance.getEntriesByType('resource')
          .reduce((sum, r: any) => sum + (r.transferSize || 0), 0),
      };
    });

    // Core Web Vitals thresholds (Good)
    expect(metrics.firstContentfulPaint).toBeLessThan(1800); // FCP < 1.8s
    expect(metrics.largestContentfulPaint).toBeLessThan(2500); // LCP < 2.5s
    expect(metrics.timeToInteractive).toBeLessThan(3800); // TTI < 3.8s
    expect(metrics.domContentLoaded).toBeLessThan(2000); // DCL < 2s
    expect(metrics.loadComplete).toBeLessThan(5000); // Load < 5s

    console.log('Performance Metrics:', metrics);
  });

  test('should load within budget', async ({ page }) => {
    const loadMetrics = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      
      return {
        totalSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
        scriptSize: resources.filter(r => r.initiatorType === 'script')
          .reduce((sum, r) => sum + (r.transferSize || 0), 0),
        imageSize: resources.filter(r => r.initiatorType === 'img')
          .reduce((sum, r) => sum + (r.transferSize || 0), 0),
        cssSize: resources.filter(r => r.initiatorType === 'link' && r.name.endsWith('.css'))
          .reduce((sum, r) => sum + (r.transferSize || 0), 0),
        resourceCount: resources.length,
      };
    });

    // Performance budgets
    const BUDGETS = {
      totalSize: 2 * 1024 * 1024, // 2MB total
      scriptSize: 500 * 1024, // 500KB scripts
      imageSize: 800 * 1024, // 800KB images
      cssSize: 100 * 1024, // 100KB CSS
      resourceCount: 50, // 50 resources max
    };

    expect(loadMetrics.totalSize).toBeLessThan(BUDGETS.totalSize);
    expect(loadMetrics.scriptSize).toBeLessThan(BUDGETS.scriptSize);
    expect(loadMetrics.imageSize).toBeLessThan(BUDGETS.imageSize);
    expect(loadMetrics.cssSize).toBeLessThan(BUDGETS.cssSize);
    expect(loadMetrics.resourceCount).toBeLessThan(BUDGETS.resourceCount);

    console.log('Resource Budget:', loadMetrics);
  });

  test('should have efficient resource loading', async ({ page }) => {
    const resourceTiming = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      
      return {
        averageResourceTime: resources.reduce((sum, r) => sum + r.duration, 0) / resources.length,
        slowestResources: resources
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 5)
          .map(r => ({ name: r.name, duration: r.duration })),
        cachedResources: resources.filter(r => r.transferSize === 0 && r.decodedBodySize > 0).length,
        totalResources: resources.length,
      };
    });

    // Average resource should load in < 500ms
    expect(resourceTiming.averageResourceTime).toBeLessThan(500);
    
    // At least 30% should be cached
    const cacheRatio = resourceTiming.cachedResources / resourceTiming.totalResources;
    expect(cacheRatio).toBeGreaterThan(0.3);

    console.log('Resource Timing:', resourceTiming);
    
    // Log optimization recommendations
    if (resourceTiming.slowestResources.length > 0) {
      console.log('OPTIMIZATION RECOMMENDATION: Consider lazy loading or optimizing these slow resources:');
      resourceTiming.slowestResources.forEach(r => {
        console.log(`  - ${r.name}: ${r.duration.toFixed(0)}ms`);
      });
    }
  });
});

test.describe('Chat Performance', () => {
  test('should send message and receive response within SLA', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });

    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    const sendButton = page.locator('button[type="submit"]');

    // Measure time to send and receive
    const startTime = Date.now();
    
    await chatInput.fill('Performance test message');
    await sendButton.click();
    
    // Wait for response
    await page.waitForSelector('[class*="message"]:nth-child(2)', { timeout: 10000 });
    
    const totalTime = Date.now() - startTime;
    
    // SLA: 5 seconds for round trip
    expect(totalTime).toBeLessThan(5000);
    
    console.log(`Chat Response Time: ${totalTime}ms`);
    
    if (totalTime > 3000) {
      console.log('OPTIMIZATION RECOMMENDATION: Response time exceeds 3s. Consider:');
      console.log('  - Using streaming responses');
      console.log('  - Optimizing backend processing');
      console.log('  - Implementing response caching');
    }
  });

  test('should handle rapid message sending', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });

    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    
    const startTime = Date.now();
    
    // Send 5 messages rapidly
    for (let i = 0; i < 5; i++) {
      await chatInput.fill(`Message ${i}`);
      await chatInput.press('Enter');
      await page.waitForTimeout(200);
    }
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / 5;
    
    // Each message should take < 1s
    expect(avgTime).toBeLessThan(1000);
    
    console.log(`Rapid Send Performance: ${avgTime.toFixed(0)}ms per message`);
  });

  test('should stream response efficiently', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });

    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Write a long response');
    await chatInput.press('Enter');

    // Measure streaming performance
    const streamingMetrics = await page.evaluate(() => {
      let tokenCount = 0;
      let firstTokenTime = 0;
      let lastTokenTime = 0;
      
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.addedNodes.length > 0) {
            const now = performance.now();
            if (firstTokenTime === 0) {
              firstTokenTime = now;
            }
            lastTokenTime = now;
            tokenCount += mutation.addedNodes.length;
          }
        });
      });
      
      const messageArea = document.querySelector('[class*="messages"]');
      if (messageArea) {
        observer.observe(messageArea, { childList: true, subtree: true });
      }
      
      // Return metrics after 5 seconds
      return new Promise((resolve) => {
        setTimeout(() => {
          observer.disconnect();
          resolve({
            tokenCount,
            firstTokenTime,
            lastTokenTime,
            tokensPerSecond: lastTokenTime > 0 ? tokenCount / ((lastTokenTime - firstTokenTime) / 1000) : 0,
          });
        }, 5000);
      });
    });

    console.log('Streaming Metrics:', streamingMetrics);
    
    // Should start streaming within 1s
    expect(streamingMetrics.firstTokenTime).toBeLessThan(1000);
    
    // Should maintain > 10 tokens/second
    if (streamingMetrics.tokensPerSecond > 0) {
      expect(streamingMetrics.tokensPerSecond).toBeGreaterThan(10);
    }
    
    if (streamingMetrics.tokensPerSecond < 20) {
      console.log('OPTIMIZATION RECOMMENDATION: Streaming speed is low. Consider:');
      console.log('  - Increasing server-side streaming buffer size');
      console.log('  - Reducing token generation latency');
      console.log('  - Using WebSocket instead of SSE for bidirectional streaming');
    }
  });
});

test.describe('Memory Performance', () => {
  test('should not have memory leaks during chat', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });

    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    
    // Get initial memory (if available)
    const initialMemory = await page.evaluate(() => {
      // @ts-ignore - Performance.memory is Chrome-only
      return performance.memory?.usedJSHeapSize || 0;
    });
    
    // Send 10 messages
    for (let i = 0; i < 10; i++) {
      await chatInput.fill(`Message ${i}`);
      await chatInput.press('Enter');
      await page.waitForTimeout(500);
    }
    
    // Get final memory
    const finalMemory = await page.evaluate(() => {
      // @ts-ignore
      return performance.memory?.usedJSHeapSize || 0;
    });
    
    if (initialMemory > 0 && finalMemory > 0) {
      const memoryGrowth = finalMemory - initialMemory;
      const growthPercent = (memoryGrowth / initialMemory) * 100;
      
      // Memory should not grow more than 50%
      expect(growthPercent).toBeLessThan(50);
      
      console.log(`Memory Growth: ${growthPercent.toFixed(1)}%`);
      
      if (growthPercent > 20) {
        console.log('OPTIMIZATION RECOMMENDATION: High memory growth detected. Consider:');
        console.log('  - Implementing message virtualization for long conversations');
        console.log('  - Cleaning up event listeners on component unmount');
        console.log('  - Using WeakMap/WeakRef for caches');
      }
    }
  });

  test('should clean up resources on navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
    
    // Interact with the page
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test');
    await chatInput.press('Enter');
    await page.waitForTimeout(1000);
    
    // Get resource count before navigation
    const beforeResources = await page.evaluate(() => performance.getEntriesByType('resource').length);
    
    // Navigate away and back
    await page.goto('about:blank');
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
    
    // Get resource count after navigation
    const afterResources = await page.evaluate(() => performance.getEntriesByType('resource').length);
    
    // Should not accumulate resources
    expect(afterResources).toBeLessThanOrEqual(beforeResources + 10); // Allow some buffer
    
    console.log(`Resource Cleanup: Before=${beforeResources}, After=${afterResources}`);
  });
});

test.describe('Network Performance', () => {
  test('should use compression effectively', async ({ page }) => {
    await page.goto('/');
    
    const compressionMetrics = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      
      const compressed = resources.filter(r => {
        const responseHeaders = r.toJSON() as any;
        return responseHeaders.responseHeaders?.includes('content-encoding');
      });
      
      const totalSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
      const decodedSize = resources.reduce((sum, r) => sum + (r.decodedBodySize || 0), 0);
      const compressionRatio = decodedSize > 0 ? (1 - (totalSize / decodedSize)) * 100 : 0;
      
      return {
        compressedResources: compressed.length,
        totalResources: resources.length,
        compressionRatio,
        totalSize,
        decodedSize,
      };
    });
    
    console.log('Compression Metrics:', compressionMetrics);
    
    // At least 50% compression ratio
    expect(compressionMetrics.compressionRatio).toBeGreaterThan(50);
    
    if (compressionMetrics.compressionRatio < 70) {
      console.log('OPTIMIZATION RECOMMENDATION: Compression ratio is low. Consider:');
      console.log('  - Enabling gzip/brotli compression on server');
      console.log('  - Using modern image formats (WebP, AVIF)');
      console.log('  - Minifying JavaScript and CSS');
    }
  });

  test('should minimize HTTP requests', async ({ page }) => {
    await page.goto('/');
    
    const requestMetrics = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      
      const byType = resources.reduce((acc, r) => {
        acc[r.initiatorType] = (acc[r.initiatorType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      return {
        total: resources.length,
        byType,
      };
    });
    
    console.log('Request Metrics:', requestMetrics);
    
    // Should have < 50 total requests
    expect(requestMetrics.total).toBeLessThan(50);
    
    if (requestMetrics.total > 30) {
      console.log('OPTIMIZATION RECOMMENDATION: High request count. Consider:');
      console.log('  - Bundling small JavaScript files');
      console.log('  - Using CSS sprites for icons');
      console.log('  - Implementing HTTP/2 server push');
      console.log('  - Using resource hints (preload, prefetch)');
    }
  });

  test('should use caching effectively', async ({ page }) => {
    // First load
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
    
    const firstLoadMetrics = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return {
        total: resources.length,
        cached: resources.filter(r => r.transferSize === 0 && r.decodedBodySize > 0).length,
      };
    });
    
    // Reload (should use cache)
    await page.reload();
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
    
    const secondLoadMetrics = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return {
        total: resources.length,
        cached: resources.filter(r => r.transferSize === 0 && r.decodedBodySize > 0).length,
      };
    });
    
    console.log('First Load:', firstLoadMetrics);
    console.log('Second Load:', secondLoadMetrics);
    
    // Second load should have more cached resources
    const firstCacheRatio = firstLoadMetrics.cached / firstLoadMetrics.total;
    const secondCacheRatio = secondLoadMetrics.cached / secondLoadMetrics.total;
    
    expect(secondCacheRatio).toBeGreaterThan(firstCacheRatio);
    
    if (secondCacheRatio < 0.5) {
      console.log('OPTIMIZATION RECOMMENDATION: Low cache hit ratio. Consider:');
      console.log('  - Setting appropriate Cache-Control headers');
      console.log('  - Using service workers for offline caching');
      console.log('  - Implementing stale-while-revalidate strategy');
      console.log('  - Using content hashing for cache busting');
    }
  });
});

test.describe('Rendering Performance', () => {
  test('should maintain 60fps during scrolling', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
    
    // Send multiple messages to create scrollable content
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    for (let i = 0; i < 20; i++) {
      await chatInput.fill(`Message ${i}`);
      await chatInput.press('Enter');
      await page.waitForTimeout(200);
    }
    
    // Measure scroll performance
    const scrollMetrics = await page.evaluate(async () => {
      const messagesContainer = document.querySelector('[class*="messages"]') || document.body;
      
      let frameCount = 0;
      let jankCount = 0;
      let lastTime = performance.now();
      
      return new Promise((resolve) => {
        const startTime = performance.now();
        
        const scrollInterval = setInterval(() => {
          messagesContainer.scrollTop += 50;
          
          const now = performance.now();
          const frameTime = now - lastTime;
          
          if (frameTime > 16.67) { // More than 60fps frame time
            jankCount++;
          }
          
          frameCount++;
          lastTime = now;
          
          if (now - startTime > 2000) {
            clearInterval(scrollInterval);
            resolve({
              frameCount,
              jankCount,
              averageFrameTime: (now - startTime) / frameCount,
              jankRatio: jankCount / frameCount,
            });
          }
        }, 16);
      });
    });
    
    console.log('Scroll Performance:', scrollMetrics);
    
    // Should maintain > 90% frames at 60fps
    expect(scrollMetrics.jankRatio).toBeLessThan(0.1);
    
    if (scrollMetrics.jankRatio > 0.05) {
      console.log('OPTIMIZATION RECOMMENDATION: Scroll jank detected. Consider:');
      console.log('  - Using CSS containment for message bubbles');
      console.log('  - Implementing virtual scrolling for long conversations');
      console.log('  - Reducing DOM complexity');
      console.log('  - Using will-change CSS property sparingly');
    }
  });

  test('should minimize layout thrashing', async ({ page }) => {
    await page.goto('/');
    
    const layoutMetrics = await page.evaluate(() => {
      // Force multiple layout calculations
      const chatInput = document.querySelector('textarea');
      if (!chatInput) return { forcedLayouts: 0 };
      
      let forcedLayouts = 0;
      
      for (let i = 0; i < 10; i++) {
        // Read (triggers layout)
        const height = chatInput.offsetHeight;
        // Write (triggers layout)
        chatInput.style.height = `${height + 1}px`;
        forcedLayouts++;
      }
      
      return { forcedLayouts };
    });
    
    console.log('Layout Metrics:', layoutMetrics);
    
    if (layoutMetrics.forcedLayouts > 5) {
      console.log('OPTIMIZATION RECOMMENDATION: Layout thrashing detected. Consider:');
      console.log('  - Batching DOM reads and writes');
      console.log('  - Using requestAnimationFrame for animations');
      console.log('  - Caching layout values instead of re-reading');
    }
  });
});
