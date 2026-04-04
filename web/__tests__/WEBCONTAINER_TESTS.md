# WebContainer Integration Tests

Tests for WebContainer sandbox provider that run in a browser environment.

## Overview

WebContainer runs Node.js natively in the browser using WebAssembly. These tests verify:
- ✅ WebContainer boot and initialization
- ✅ Filesystem operations (read/write/list)
- ✅ Command execution (node, npm, echo)
- ✅ Package installation (npm install)
- ✅ HTTP server execution
- ✅ Error handling

## Requirements

### 1. WebContainer API Key

Get your Client ID from: https://webcontainers.io/guide

Add to `.env.local`:
```bash
NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID=wc_api_your_client_id_here
NEXT_PUBLIC_WEBCONTAINER_SCOPE=  # Optional
```

### 2. Browser Environment

WebContainer **only works in browsers** (not Node.js). Tests require:
- Chrome 91+ or Edge 91+ (Chromium-based)
- HTTPS or localhost (WebContainer requires secure context)
- `SharedArrayBuffer` enabled (requires COOP/COEP headers)

### 3. Dependencies

```bash
npm install @webcontainer/api
```

## Running Tests

### Option 1: Vitest Browser Mode (Recommended)

```bash
# Run in browser with Vitest
npm run test:webcontainer:browser
```

### Option 2: Manual Browser Testing

1. Start dev server:
```bash
npm run dev
```

2. Open browser console (F12)

3. Run tests manually:
```javascript
await import('/__tests__/webcontainer-integration.test.ts')
```

### Option 3: Playwright

Create `playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: '**/webcontainer-integration.test.ts',
  use: {
    headless: false, // WebContainer requires real browser
  },
});
```

Then run:
```bash
npx playwright test
```

## Test Coverage

### Filesystem Operations (5 tests)
- ✅ Create directory
- ✅ Write file
- ✅ Read file
- ✅ List directory
- ✅ Write/read JavaScript file

### Command Execution (5 tests)
- ✅ `node --version`
- ✅ `npm --version`
- ✅ `echo` command
- ✅ Execute JavaScript file
- ✅ Custom working directory

### Package Installation (2 tests)
- ✅ Initialize npm project
- ✅ Install npm package (lodash)

### Server Execution (1 test)
- ✅ Start HTTP server on port 3000

### Error Handling (2 tests)
- ✅ Non-existent command
- ✅ Non-zero exit code

**Total:** 15 tests

## Expected Output

### Success
```
✓ WebContainer Integration (60s)
  ✓ Filesystem Operations (5)
    ✓ should create directory 234ms
    ✓ should write file 156ms
    ✓ should read file 143ms
    ✓ should list directory 189ms
    ✓ should write and read JavaScript file 167ms
  ✓ Command Execution (5)
    ✓ should execute node --version 312ms
    ✓ should execute npm --version 298ms
    ✓ should execute echo command 87ms
    ✓ should execute JavaScript file with Node.js 423ms
    ✓ should execute command in custom working directory 156ms
  ✓ Package Installation (2)
    ✓ should initialize npm project 234ms
    ✓ should install npm package 15234ms
  ✓ Server Execution (1)
    ✓ should start HTTP server 5678ms
  ✓ Error Handling (2)
    ✓ should handle command that does not exist 45ms
    ✓ should handle command with non-zero exit code 67ms

Test Files  1 passed (1)
Tests  15 passed (15)
Duration  23.45s
```

### Skipped (Node.js Environment)
```
↓ WebContainer Integration (skipped)
  ↓ Filesystem Operations (5)
  ↓ Command Execution (5)
  ↓ Package Installation (2)
  ↓ Server Execution (1)
  ↓ Error Handling (2)

Test Files  1 skipped (1)
Tests  15 skipped (15)

Note: WebContainer tests require browser environment
```

### Failed (Missing API Key)
```
✗ WebContainer Integration
  ✗ beforeAll
    → NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID must be set

⎯⎯⎯⎯⎯⎯⎯ Failed Tests ⎯⎯⎯⎯⎯⎯⎯

 FAIL  __tests__/webcontainer-integration.test.ts > WebContainer Integration > beforeAll
Error: NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID must be set
```

## Troubleshooting

### "WebContainer tests require browser environment"

**Cause:** Running tests in Node.js instead of browser.

**Fix:** Use browser mode:
```bash
npm run test:webcontainer:browser
```

### "SharedArrayBuffer is not defined"

**Cause:** WebContainer requires `SharedArrayBuffer` which needs COOP/COEP headers.

**Fix:** Add to `next.config.js`:
```javascript
module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
}
```

### "WebContainer.boot() failed"

**Causes:**
1. Invalid Client ID
2. Browser not supported
3. HTTPS required (not available on HTTP)

**Fixes:**
1. Verify Client ID from https://webcontainers.io/guide
2. Use Chrome 91+ or Edge 91+
3. Run on `https://localhost` or `http://localhost`

### "npm install times out"

**Cause:** First npm install in WebContainer can take 30-60 seconds.

**Fix:** Increase timeout:
```bash
VITEST_TEST_TIMEOUT=120000 npm run test:webcontainer:browser
```

## Manual Testing

Test WebContainer directly in browser console:

```javascript
// 1. Import WebContainer API
const { WebContainer } = await import('@webcontainer/api');

// 2. Boot WebContainer
const wc = await WebContainer.boot();
console.log('WebContainer booted!');

// 3. Create workspace
await wc.fs.mkdir('/workspace', { recursive: true });

// 4. Write file
await wc.fs.writeFile('/workspace/test.js', `
  console.log('Hello from WebContainer!');
  console.log('Node version:', process.version);
`);

// 5. Execute
const process = await wc.spawn('node', ['test.js']);
const output = await readStreamToString(process.output);
console.log('Output:', output);

// Helper
async function readStreamToString(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output;
}
```

## Performance Benchmarks

| Operation | Typical Time |
|-----------|-------------|
| WebContainer boot | 2-5s |
| Create directory | 50-100ms |
| Write file (1KB) | 20-50ms |
| Read file (1KB) | 10-30ms |
| `node --version` | 200-400ms |
| `npm --version` | 200-400ms |
| `npm install` (1 package) | 10-30s |
| Start HTTP server | 1-3s |

## Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 91+ | ✅ Supported |
| Edge | 91+ | ✅ Supported |
| Firefox | 117+ | ⚠️ Limited support |
| Safari | 17+ | ⚠️ Limited support |

## Security Notes

WebContainer runs in a **sandboxed browser environment**:
- ✅ No host filesystem access
- ✅ No network access (except via fetch/XHR)
- ✅ Isolated process execution
- ✅ Automatic cleanup on page close

## Related Files

- Test: `__tests__/webcontainer-integration.test.ts`
- Provider: `lib/sandbox/providers/webcontainer-provider.ts`
- Spawn Provider: `lib/sandbox/providers/webcontainer-spawn-provider.ts`
- Filesystem Provider: `lib/sandbox/providers/webcontainer-filesystem-provider.ts`

## Resources

- [WebContainer Documentation](https://webcontainers.io/guide)
- [WebContainer API Reference](https://webcontainers.io/api)
- [StackBlitz Codeflow](https://stackblitz.com/codeflow)

## Next Steps

After tests pass:
1. ✅ WebContainer is correctly configured
2. ✅ Client ID is valid
3. ✅ Browser environment is supported
4. ✅ Filesystem operations work
5. ✅ Command execution works
6. ✅ Package installation works

You can now:
- Use WebContainer for browser-based code execution
- Run Node.js apps in the browser
- Test code without server infrastructure
