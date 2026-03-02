# Playwright E2E Testing Setup Guide

## Installation

```bash
npm install --save-dev @playwright/test @axe-core/playwright
npx playwright install
```

## Configuration

Create `playwright.config.ts` in project root:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

## Test Files Created

1. `tests/e2e/chat-workflow.test.ts` - Chat with agentic streaming
2. `tests/e2e/tool-integration.test.ts` - Composio/Nango tools
3. `tests/e2e/vfs-checkpoint.test.ts` - VFS sync & checkpoints
4. `tests/e2e/hitl-approval.test.ts` - Human-in-the-loop approval
5. `tests/e2e/sandbox-execution.test.ts` - Sandbox code execution
6. `tests/e2e/multi-provider.test.ts` - Provider fallback chain
7. `tests/e2e/accessibility.test.ts` - Accessibility compliance
8. `tests/e2e/performance.test.ts` - Performance benchmarks

## Running Tests

```bash
# Run all tests
npx playwright test

# Run specific test file
npx playwright test tests/e2e/chat-workflow.test.ts

# Run with UI
npx playwright test --ui

# Run specific browser
npx playwright test --project=chromium

# Generate HTML report
npx playwright show-report
```

## Test Coverage

| Feature | Test File | Tests | Status |
|---------|-----------|-------|--------|
| Chat Workflow | chat-workflow.test.ts | 8 | ✅ |
| Tool Integration | tool-integration.test.ts | 7 | ✅ |
| VFS Checkpoint | vfs-checkpoint.test.ts | 6 | ✅ |
| HITL Approval | hitl-approval.test.ts | 5 | ✅ |
| Sandbox Execution | sandbox-execution.test.ts | 6 | ✅ |
| Multi-Provider | multi-provider.test.ts | 5 | ✅ |
| Accessibility | accessibility.test.ts | 4 | ✅ |
| Performance | performance.test.ts | 5 | ✅ |
| **TOTAL** | **8 files** | **46 tests** | **✅** |

---

**Created**: 2026-02-27
**Framework**: Playwright v1.x
**Coverage**: All V7 features + previously incomplete features
