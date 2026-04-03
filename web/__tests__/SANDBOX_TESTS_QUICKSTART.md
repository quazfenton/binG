# 🧪 Sandbox Provider Tests - Quick Start

## Prerequisites

1. **Install Dependencies**
```bash
npm install
```

2. **Set API Keys**

Copy `.env.example` to `.env.local` and set your API keys:

```bash
# Required - Choose at least ONE provider
CODESANDBOX_API_KEY=csb_your_key_here      # From https://codesandbox.io/t/api
E2B_API_KEY=e2b_your_key_here              # From https://e2b.dev/dashboard?tab=keys
DAYTONA_API_KEY=your_key_here              # From https://app.daytona.io
BLAXEL_API_KEY=your_key_here               # From https://blaxel.ai
RUNLOOP_API_KEY=your_key_here              # From https://runloop.ai
SPRITES_API_KEY=your_key_here              # From Blaxel dashboard
MISTRAL_API_KEY=your_key_here              # From https://console.mistral.ai

# Optional - For additional providers
OPENAI_API_KEY=sk-your_key_here            # From https://platform.openai.com
```

## Running Tests

### Quick Test (All Providers)
```bash
# Run all sandbox provider tests
npm run test:sandbox
```

### Test Specific Provider
```bash
# CodeSandbox only
npm test -- -t "CodeSandbox Provider"

# E2B only  
npm test -- -t "E2B Provider"

# Daytona only
npm test -- -t "Daytona Provider"

# Blaxel only
npm test -- -t "Blaxel Provider"
```

### Watch Mode (For Development)
```bash
npm run test:sandbox:watch
```

### Verbose Output
```bash
DEBUG=* npm run test:sandbox
```

## Expected Results

### ✅ All Tests Pass
```
✓ Sandbox Provider Creation (120s)
  ✓ CodeSandbox Provider (45s)
    ✓ should create CodeSandbox sandbox
    ✓ should execute commands in CodeSandbox
    ✓ should handle file operations in CodeSandbox
  ✓ E2B Provider (38s)
    ...

Test Files  1 passed (1)
Tests  15 passed (15)
Duration  125.43s
```

### ⚠️ Some Tests Skipped (Missing API Keys)
```
[Skip] CODESANDBOX_API_KEY not set
[Skip] E2B_API_KEY not set
↓ CodeSandbox Provider (skipped)
↓ E2B Provider (skipped)

Test Files  1 skipped (1)
Tests  15 skipped (15)
```

This is **normal** - tests skip gracefully for providers without API keys.

### ❌ Test Failures

Common issues:

**"Unauthorized" Error:**
```
✗ should create CodeSandbox sandbox
  → Failed to create sandbox: Unauthorized
```
**Fix:** Check your API key is correct and hasn't expired.

**"Provider not configured" Error:**
```
✗ should create E2B sandbox
  → Provider e2b is not configured
```
**Fix:** 
1. Install SDK: `npm install @e2b/code-interpreter`
2. Set env var: `E2B_API_KEY=xxx`
3. Restart test runner

**Timeout Error:**
```
✗ should create Daytona sandbox
  → Test timed out in 120000ms
```
**Fix:** Increase timeout:
```bash
VITEST_TEST_TIMEOUT=180000 npm run test:sandbox
```

## Test Coverage

Each provider test includes:

| Test | Description | Time |
|------|-------------|------|
| `should create {Provider} sandbox` | Creates sandbox with default config | 10-30s |
| `should execute commands in {Provider}` | Runs basic shell commands | 5-15s |
| `should handle file operations in {Provider}` | Write/read/list files | 10-20s |

## Provider-Specific Setup

### CodeSandbox
```bash
# Install SDK
npm install @codesandbox/sdk

# Get API key from
# https://codesandbox.io/t/api
```

### E2B
```bash
# Install SDK
npm install @e2b/code-interpreter

# Get API key from
# https://e2b.dev/dashboard?tab=keys
```

### Daytona
```bash
# Install SDK
npm install @daytonaio/sdk

# Get API key from
# https://app.daytona.io
```

### Blaxel
```bash
# Install SDK
npm install @blaxel/core

# Get API key from
# https://blaxel.ai
```

### Sprites
```bash
# Part of Blaxel ecosystem
# Uses BLAXEL_API_KEY
```

### Mistral Code Interpreter
```bash
# Get API key from
# https://console.mistral.ai
```

### WebContainer
```bash
# Browser-only - skipped in Node.js tests
# No API key required
npm install @webcontainer/api
```

## Troubleshooting

### "Cannot find module" Errors
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### "API Key Invalid" Errors
1. Check key is copied correctly (no extra spaces)
2. Verify key hasn't expired
3. Check account has sandbox creation permissions

### Tests Hang Indefinitely
```bash
# Kill stuck processes
pkill -f vitest
pkill -f node

# Clear cache
rm -rf node_modules/.vite
rm -rf .vitest

# Retry with fresh start
npm run test:sandbox
```

### "No API Key Available" Warnings
This is **expected behavior** - tests skip for providers without keys.

To run tests, set at least **ONE** provider API key in `.env.local`.

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
# .github/workflows/test-sandbox-providers.yml
name: Test Sandbox Providers

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - name: Run Sandbox Provider Tests
        env:
          CODESANDBOX_API_KEY: ${{ secrets.CODESANDBOX_API_KEY }}
          E2B_API_KEY: ${{ secrets.E2B_API_KEY }}
          DAYTONA_API_KEY: ${{ secrets.DAYTONA_API_KEY }}
        run: npm run test:sandbox
```

## Performance Benchmarks

Typical test execution times:

| Provider | Cold Start | Warm Start | Total Test Time |
|----------|-----------|------------|-----------------|
| CodeSandbox | 15-30s | 5-10s | ~45s |
| E2B | 10-20s | 3-5s | ~38s |
| Daytona | 20-40s | 8-15s | ~55s |
| Blaxel | 15-25s | 5-10s | ~42s |
| Sprites | 10-20s | 3-8s | ~35s |

**Total for all providers:** ~3-4 minutes

## Next Steps

After tests pass:

1. ✅ Providers are correctly configured
2. ✅ API keys are valid
3. ✅ Sandboxes can be created and destroyed
4. ✅ Command execution works
5. ✅ File operations work

You can now:
- Use providers in production
- Run integration tests
- Deploy applications using these sandboxes

## Support

- **Documentation:** See `__tests__/README_SANDBOX_TESTS.md`
- **Provider Docs:** See individual provider files in `lib/sandbox/providers/`
- **Issues:** Check logs in `logs/` directory

## Additional Resources

- [Sandbox Provider Implementation Guide](./docs/sandbox-providers.md)
- [API Reference](./docs/api/sandbox.md)
- [Security Best Practices](./docs/sandbox-security.md)
