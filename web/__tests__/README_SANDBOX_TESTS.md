# Sandbox Provider Tests

Comprehensive tests for all sandbox providers in the codebase.

## Test Files

### 1. `sandbox-providers-create.test.ts`
Tests sandbox creation, command execution, and file operations for all providers.

**Run:**
```bash
npm test -- sandbox-providers-create.test.ts
```

### 2. `sandbox-providers-e2e.test.ts` (existing)
End-to-end tests for full sandbox lifecycles.

**Run:**
```bash
npm test -- sandbox-providers-e2e.test.ts
```

## Required API Keys

Set these environment variables in `.env.local` or your shell:

```bash
# CodeSandbox
CODESANDBOX_API_KEY=your_key_here

# E2B
E2B_API_KEY=your_key_here

# Daytona
DAYTONA_API_KEY=your_key_here

# Blaxel
BLAXEL_API_KEY=your_key_here

# Runloop
RUNLOOP_API_KEY=your_key_here

# Sprites
SPRITES_API_KEY=your_key_here

# Mistral
MISTRAL_API_KEY=your_key_here

# OpenAI (required by some providers)
OPENAI_API_KEY=your_key_here
```

## Running Tests

### Run All Provider Tests
```bash
npm test -- sandbox-providers
```

### Run Specific Provider Tests
```bash
# CodeSandbox only
npm test -- -t "CodeSandbox Provider"

# E2B only
npm test -- -t "E2B Provider"

# Daytona only
npm test -- -t "Daytona Provider"
```

### Run with Verbose Output
```bash
DEBUG=* npm test -- sandbox-providers-create.test.ts
```

### Run Single Test
```bash
npm test -- -t "should create CodeSandbox sandbox"
```

## Test Coverage

The tests cover:

### Creation Tests
- ✅ Sandbox creation with default config
- ✅ Sandbox creation with custom config
- ✅ Concurrent sandbox creation
- ✅ Provider initialization

### Execution Tests
- ✅ Basic command execution (`echo`, `pwd`, `uname`)
- ✅ Node.js version check
- ✅ Python code execution (Mistral)

### File Operations Tests
- ✅ File write
- ✅ File read
- ✅ Directory listing

### Cleanup Tests
- ✅ Automatic sandbox destruction after tests
- ✅ Error handling for failed cleanup

## Expected Output

### Success
```
✓ Sandbox Provider Creation (120s)
  ✓ CodeSandbox Provider (45s)
    ✓ should create CodeSandbox sandbox (15s)
    ✓ should execute commands in CodeSandbox (12s)
    ✓ should handle file operations in CodeSandbox (18s)
  ✓ E2B Provider (38s)
    ✓ should create E2B sandbox (12s)
    ✓ should execute commands in E2B (10s)
    ✓ should handle file operations in E2B (16s)
  ...

Test Files  1 passed (1)
     Tests  15 passed (15)
  Start at  10:30:00
  Duration  125.43s
```

### Skipped (Missing API Keys)
```
[Skip] CODESANDBOX_API_KEY not set
[Skip] E2B_API_KEY not set
↓ CodeSandbox Provider (skipped)
↓ E2B Provider (skipped)

Test Files  1 skipped (1)
     Tests  15 skipped (15)
```

### Failure
```
✗ Sandbox Provider Creation (120s)
  ✗ CodeSandbox Provider (15s)
    ✗ should create CodeSandbox sandbox (14s)
      → Failed to create sandbox: Unauthorized

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  __tests__/sandbox-providers-create.test.ts > CodeSandbox Provider > should create CodeSandbox sandbox
Error: Failed to create sandbox: Unauthorized
 ❯ CodeSandboxProvider.createSandbox lib/sandbox/providers/codesandbox-provider.ts:135:12
```

## Troubleshooting

### "Unauthorized" Errors
1. Verify API key is correct
2. Check API key hasn't expired
3. Ensure API key has sandbox creation permissions

### "Provider not configured" Errors
1. Install required SDK: `npm install @codesandbox/sdk` (or appropriate provider)
2. Set environment variable: `CODESANDBOX_API_KEY=xxx`
3. Restart test runner to load env vars

### Timeout Errors
Sandbox creation can take 30-60 seconds. If tests timeout:
```bash
# Increase timeout
VITEST_TEST_TIMEOUT=180000 npm test -- sandbox-providers-create.test.ts
```

### "No API key available" Warnings
Tests skip gracefully if API keys aren't set. This is expected behavior for local development.

## CI/CD Integration

Add to your CI pipeline:

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
      
      - run: npm ci
      
      - name: Run Sandbox Provider Tests
        env:
          CODESANDBOX_API_KEY: ${{ secrets.CODESANDBOX_API_KEY }}
          E2B_API_KEY: ${{ secrets.E2B_API_KEY }}
          DAYTONA_API_KEY: ${{ secrets.DAYTONA_API_KEY }}
        run: npm test -- sandbox-providers-create.test.ts
```

## Provider-Specific Notes

### CodeSandbox
- Requires `@codesandbox/sdk` package
- Sandboxes are ephemeral (auto-destroy after session ends)
- Preview URLs available via `getPreviewUrl()`

### E2B
- Requires `@e2b/code-interpreter` package
- Supports templates and custom environments
- PTY sessions available for interactive terminals

### Daytona
- Requires `@daytonaio/sdk` package
- Supports Docker-based workspaces
- Object storage integration available

### Blaxel
- Requires `@blaxel/core` package
- Volume templates supported
- Callback system for async operations

### WebContainer
- **Browser-only** - won't work in Node.js tests
- No API key required
- Uses `@webcontainer/api` package

## Adding New Provider Tests

1. Add provider to `SandboxProviderType` in `types.ts`
2. Implement provider in `providers/`
3. Add test suite in `sandbox-providers-create.test.ts`:

```typescript
describe('NewProvider Provider', () => {
  it('should create NewProvider sandbox', async () => {
    const apiKey = process.env.NEWPROVIDER_API_KEY;
    if (!apiKey) return;
    
    const handle = await testSandboxCreation('newprovider');
    expect(handle.id).toBeTruthy();
  });
});
```

4. Add API key to `.env.example`
5. Update this documentation

## Performance Benchmarks

Typical sandbox creation times:

| Provider | Cold Start | Warm Start |
|----------|-----------|------------|
| CodeSandbox | 15-30s | 5-10s |
| E2B | 10-20s | 3-5s |
| Daytona | 20-40s | 8-15s |
| Blaxel | 15-25s | 5-10s |
| Sprites | 10-20s | 3-8s |

## Support

For issues or questions:
1. Check provider documentation
2. Review error logs in `logs/`
3. Enable debug logging: `DEBUG=* npm test`
