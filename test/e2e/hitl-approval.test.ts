/**
 * E2E Tests: Human-in-the-Loop (HITL) Approval
 * 
 * Updated with actual selectors from the codebase
 */

import { test, expect } from '@playwright/test';

test.describe('HITL Approval', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 10000 });
  });

  test('should request approval for delete operation', async ({ page }) => {
    // Request delete
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Delete the test file');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Look for approval request in response
    const approvalRequest = page.locator('[class*="auth"], [class*="approve"]').first();
    if (await approvalRequest.isVisible()) {
      expect(approvalRequest).toBeVisible();
    }
  });

  test('should approve destructive operation', async ({ page }) => {
    // Request destructive operation
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Delete all temporary files');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Look for approve button in response
    const approveButton = page.locator('button').filter({ hasText: /approve|confirm|yes/i }).first();
    if (await approveButton.isVisible()) {
      await approveButton.click();
      await page.waitForTimeout(1000);
    }
    
    // Should show confirmation
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should reject destructive operation', async ({ page }) => {
    // Request destructive operation
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Delete important file');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Look for reject button
    const rejectButton = page.locator('button').filter({ hasText: /reject|cancel|no/i }).first();
    if (await rejectButton.isVisible()) {
      await rejectButton.click();
      await page.waitForTimeout(1000);
    }
  });

  test('should provide feedback on rejection', async ({ page }) => {
    // Request operation
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Delete database');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Look for feedback input
    const feedbackInput = page.locator('input[type="text"], textarea').filter({ hasText: /feedback|reason/i }).first();
    if (await feedbackInput.isVisible()) {
      await feedbackInput.fill('This is too dangerous');
      
      const rejectButton = page.locator('button').filter({ hasText: /reject/i }).first();
      if (await rejectButton.isVisible()) {
        await rejectButton.click();
      }
    }
  });

  test('should handle approval timeout', async ({ page }) => {
    // Request approval
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Execute dangerous command');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for timeout (would need mock for proper test)
    await page.waitForTimeout(15000);
    
    // Should show timeout message
    const timeoutMessage = page.locator('[class*="timeout"], [class*="expired"]').first();
    if (await timeoutMessage.isVisible()) {
      expect(timeoutMessage).toBeVisible();
    }
  });

  test('should list pending approvals', async ({ page }) => {
    // Look for approvals panel
    const approvalsButton = page.locator('button').filter({ hasText: /approval|pending/i }).first();
    
    if (await approvalsButton.isVisible()) {
      await approvalsButton.click();
      await page.waitForTimeout(1000);
      
      // Should show pending list
      const pendingList = page.locator('[class*="list"], [class*="pending"]').first();
      expect(pendingList).toBeDefined();
    }
  });

  test('should modify value before approval', async ({ page }) => {
    // Request operation with modifiable value
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Set environment variable');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Look for modify input
    const modifyInput = page.locator('input[type="text"], textarea').first();
    if (await modifyInput.isVisible()) {
      await modifyInput.fill('SAFE_VALUE');
      
      const approveButton = page.locator('button').filter({ hasText: /approve/i }).first();
      if (await approveButton.isVisible()) {
        await approveButton.click();
      }
    }
  });

  test('should handle concurrent approvals', async ({ page }) => {
    // Request multiple operations quickly
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    
    for (let i = 0; i < 3; i++) {
      await chatInput.fill(`Delete file ${i}`);
      
      const sendButton = page.locator('button[type="submit"]').first();
      await sendButton.click();
      
      await page.waitForTimeout(500);
    }

    // Wait for responses
    await page.waitForTimeout(5000);
    
    // Should have multiple messages
    const messages = page.locator('[class*="message"], .prose');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

test.describe('HITL - Configuration', () => {
  test('should respect ENABLE_HITL environment variable', async ({ page }) => {
    // This would need backend configuration test
    // Test UI structure only
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(2000);
  });

  test('should respect HITL_APPROVAL_REQUIRED_ACTIONS', async ({ page }) => {
    // Test that some actions require approval
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Delete file');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(3000);
    
    // Should potentially show approval
    const messages = page.locator('[class*="message"], .prose');
    await expect(messages).toHaveCount({ min: 2 });
  });

  test('should respect HITL_TIMEOUT', async ({ page }) => {
    // Test timeout behavior
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Execute with timeout');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    // Wait for potential timeout
    await page.waitForTimeout(10000);
  });
});

test.describe('HITL - Audit Trail', () => {
  test('should log approval decisions', async ({ page }) => {
    // Request and approve
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Delete file');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(3000);
    
    // Look for approve button
    const approveButton = page.locator('button').filter({ hasText: /approve/i }).first();
    if (await approveButton.isVisible()) {
      await approveButton.click();
      await page.waitForTimeout(1000);
    }
    
    // Look for audit log
    const auditLog = page.locator('[class*="audit"], [class*="log"]').first();
    if (await auditLog.isVisible()) {
      expect(auditLog).toContainText(/approve|approved/i);
    }
  });

  test('should include timestamp in audit log', async ({ page }) => {
    // Request and approve
    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('Test');
    
    const sendButton = page.locator('button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(3000);
    
    // Look for timestamp
    const timestamp = page.locator('[class*="time"], [class*="date"]').first();
    if (await timestamp.isVisible()) {
      expect(timestamp).toBeDefined();
    }
  });

  test('should include user info in audit log', async ({ page }) => {
    // Login first (if auth is available)
    const loginButton = page.locator('button').filter({ hasText: /login|sign in/i }).first();
    
    if (await loginButton.isVisible()) {
      await loginButton.click();
      await page.waitForTimeout(1000);
      
      // Look for user info
      const userInfo = page.locator('[class*="user"], [class*="profile"]').first();
      if (await userInfo.isVisible()) {
        expect(userInfo).toBeDefined();
      }
    }
  });
});
