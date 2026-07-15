# E2E Agent Testing - Findings & Issues

## Test Date
2026-07-15

## Server Status
- **Process**: Running (PID 2874703, 90.6% CPU, 16.9% memory)
- **Uptime**: ~10 hours
- **HTTP Status**: HUNG - Not responding to requests
- **Last Activity**: 2026-07-14 22:47:12 (hours ago)

## Issues Found

### 1. MCP Gateway Timeout (CRITICAL)
**File**: `/opt/bing/.env`
**Issue**: MCP_GATEWAY_URL set to `http://localhost:8261/mcp` but no gateway running
**Impact**: Every chat request times out waiting for MCP tools (4 seconds delay)
**Evidence**:
```
"[CHAT-ROUTE] MCP tools unavailable — continuing without them"
"error":"MCP tools route timeout after 4000ms (abort signal 1000ms)"
```
**Fix**: Comment out in `.env`:
```bash
# MCP_GATEWAY_URL=http://localhost:8261/mcp
# MCP_CLI_PORT=8888
```

### 2. Server Hang/Deadlock (CRITICAL)
**Symptom**: Server alive but all HTTP requests timeout
**Evidence**:
- Health check: timeout after 5s
- Login endpoint: timeout after 120s
- Process consuming 90.6% CPU continuously
**Possible Causes**:
- Infinite loop in request handling
- Deadlock in async operation
- Memory leak causing GC thrashing
- Blocking operation never completing

### 3. MCPorter Refresh Timeout (WARNING)
**Evidence**: 
```
"Failed to refresh mcporter tools: mcporter refresh timed out after 30000ms"
```
**Impact**: Additional 30s delay on initialization

### 4. Logger Migration Issues (FIXED)
**Status**: ✅ Fixed in this session
- `safe-exec.ts`: 10 pino-style logger calls → centralized logger
- `vercel-provider.ts`: 3-arg logger call → 2-arg
- `mistral-provider.ts`: Missing interface methods + 5x 3-arg calls → fixed
- `tool-authorization-manager.ts`: Duplicate property → removed
- `route.ts`: Type mismatches → fixed

## VFS Tools Status
**File**: `/opt/bing/web/lib/mcp/vfs-mcp-tools.ts`
**Status**: ✅ Exists with correct exports
- `write_file` ✅
- `read_file` ✅  
- `list_files` ✅

**Cannot test actual execution** due to server hang

## File Edit Parser Status
**File**: `/opt/bing/web/lib/tools/file-edit-parser.ts`
**Status**: ⚠️ File not found at expected path
**Impact**: Fallback regex parsing may not work

## Recommended Next Steps

### Immediate (Server Restart Required)
1. Comment out MCP gateway vars in `.env`
2. Restart Next.js server to clear hung state
3. Re-run E2E tests

### Testing After Restart
Run comprehensive workflow tests:

```javascript
// Test 1: File Creation
"Create a file hello.py that prints Hello World"

// Test 2: Multi-file Project  
"Create an Express.js API with server.js, routes.js, package.json"

// Test 3: Code Execution
"Create fibonacci.py and run it to calculate fib(10)"

// Test 4: File Modification
"Read hello.py and change it to print 'Hello from binG'"

// Test 5: Auto-Continue
"Create a todo app with HTML, CSS, JS files, then list all files"
```

### Code Fixes Needed
1. **MCP timeout handling**: Increase `CHAT_MCP_TOOLS_TIMEOUT_MS` or make HTTP transport honor abort signals
2. **File edit parser**: Verify location and functionality
3. **Deadlock prevention**: Add request-level timeout guards
4. **Health monitoring**: Add HTTP response time monitoring

## Test Scripts Created
- `/opt/bing/e2e-agent-test.mjs` - Full E2E workflow tests
- `/opt/bing/test-minimal-agent.mjs` - Module verification
- `/opt/bing/test-agent-direct.mjs` - Direct curl-based tests

## Files Modified This Session
1. `/opt/bing/web/lib/security/safe-exec.ts` - Logger fixes
2. `/opt/bing/web/lib/image-generation/providers/vercel-provider.ts` - Logger fix
3. `/opt/bing/web/lib/image-generation/providers/mistral-provider.ts` - Interface + logger fixes
4. `/opt/bing/web/lib/tools/tool-authorization-manager.ts` - Duplicate property fix
5. `/opt/bing/web/app/api/chat/route.ts` - Type fixes
6. `/opt/bing/web/lib/mcp/http-transport.ts` - Debug logging added
7. `/opt/bing/web/lib/mcp/architecture-integration.ts` - Debug logging added

## Summary
**Blocker**: Server is hung and cannot process requests
**Root Cause**: Likely combination of MCP gateway timeout + request handling deadlock
**Can't Verify**: Agentic workflows, tool execution, file operations
**Next Action**: Server restart required to continue testing
