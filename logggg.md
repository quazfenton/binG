) { authSuccess: true }
2026-03-18T05:36:02.310Z [DEBUG] Chat API [req:chat_1773812162304_x3h3AK08f]: Request body validated {
  messageCount: 1,
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free',
  stream: true,
  userId: 'anon:anon_1773812144948_7QplguZZn'
}
[ChatRequestLogger] Database initialized
2026-03-18T05:36:02.313Z [DEBUG] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Selected provider { supportsStreaming: true }
2026-03-18T05:36:02.318Z [DEBUG] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Validation passed, routing through priority chain {
  requestId: 'chat_1773812162304_x3h3AK08f',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
[2026-03-18T05:36:06.213Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 0, errors: 0, avgDurationMs: 0 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T05:36:07.329Z [ERROR] Chat API [req:chat_1773812162304_x3h3AK08f]: V2 execution failed, falling back to v1 {
  error: 'fetch failed',
  stack: 'TypeError: fetch failed\n' +
    '    at node:internal/deps/undici/undici:14902:13\n' +
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n' +
    '    at async handleGatewayStreaming (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\app_api_chat_route_ts_827fe458._.js:1283:25)\n' +
    '    at async POST (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\app_api_chat_route_ts_827fe458._.js:306:28)\n' +
    '    at async AppRouteRouteModule.do (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:37866)\n' +
    '    at async AppRouteRouteModule.handle (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:45156)\n' +
    '    at async responseGenerator (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_df1334e6._.js:15355:38)\n' +
    '    at async AppRouteRouteModule.handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:1:191938)\n' +
    '    at async handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_df1334e6._.js:15418:32)\n' +
    '    at async Module.handler (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_df1334e6._.js:15471:13)\n' +
    '    at async DevServer.renderToResponseWithComponentsImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1442:9)\n' +
    '    at async DevServer.renderPageComponent (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1494:24)\n' +
    '    at async DevServer.renderToResponseImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1544:32)\n' +
    '    at async DevServer.pipeImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1038:25)\n' +
    '    at async NextNodeServer.handleCatchallRenderRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\next-server.js:395:17)\n' +
    '    at async DevServer.handleRequestImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:929:17)\n' +
    '    at async C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:387:20\n' +
    '    at async Span.traceAsyncFn (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\trace\\trace.js:157:20)\n' +
    '    at async DevServer.handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:383:24)\n' +
    '    at async invokeRender (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:248:21)\n' +
    '    at async handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:447:24)\n' +
    '    at async requestHandlerImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:496:13)\n' +
    '    at async Server.requestListener (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\start-server.js:226:13)'
}
2026-03-18T05:36:07.329Z [INFO] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Using v1 fallback path after V2 failure {
  requestId: 'chat_1773812162304_x3h3AK08f',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
2026-03-18T05:36:07.330Z [DEBUG] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Routing request through priority chain {
  requestType: 'chat',
  enableTools: undefined,
  enableSandbox: undefined,
  enableComposio: undefined
}
[2026-03-18T05:36:07.333Z] [DEBUG] [API:ResponseRouter] Routing to original-system
2026-03-18T05:36:07.334Z [DEBUG] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: false,
  enableSandbox: false,
  fallbackProviders: undefined
}
2026-03-18T05:36:07.335Z [DEBUG] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Calling provider { messageCount: 2, temperature: 0.7, maxTokens: 100096 }
2026-03-18T05:36:07.335Z [DEBUG] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM generateResponse called { messageCount: 2, temperature: 0.7, maxTokens: 100096 }
[2026-03-18T05:36:11.221Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 0, errors: 0, avgDurationMs: 0 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T05:36:11.597Z [INFO] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM provider response generated {
  latencyMs: 4261,
  tokensUsed: 1964,
  finishReason: 'stop',
  contentLength: 1223
}
2026-03-18T05:36:11.598Z [DEBUG] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider call completed { latencyMs: 4263, tokensUsed: 1964, finishReason: 'stop' }
2026-03-18T05:36:11.598Z [INFO] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider request completed { latencyMs: 4264, tokensUsed: 1964, finishReason: 'stop' }
2026-03-18T05:36:11.600Z [INFO] Chat API [req:chat_1773812162304_x3h3AK08f provider:original-system model:nvidia/nemotron-3-nano-30b-a3b:free]: Request handled by response router { source: 'original-system', priority: 1, fallbackChain: undefined }
[2026-03-18T05:36:11.605Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/onecm/package.json v1
[2026-03-18T05:36:11.611Z] [INFO] [GitVFS] [GitVFS] Committed 0 files: Write project/sessions/onecm/package.json
[2026-03-18T05:36:11.612Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/onecm/next.config.js v2
[2026-03-18T05:36:11.616Z] [INFO] [GitVFS] [GitVFS] Committed 0 files: Write project/sessions/onecm/next.config.js
[2026-03-18T05:36:11.617Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/onecm/pages/index.js v3
[2026-03-18T05:36:11.621Z] [INFO] [GitVFS] [GitVFS] Committed 0 files: Write project/sessions/onecm/pages/index.js
[2026-03-18T05:36:11.623Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: create project/sessions/onecm/styles/globals.css v4
[2026-03-18T05:36:11.627Z] [INFO] [GitVFS] [GitVFS] Committed 0 files: Write project/sessions/onecm/styles/globals.css
[VFS] Potential concurrent modification: project/sessions/onecm/next.config.js { timeSinceLastWrite: 16, previousVersion: 1 }
[2026-03-18T05:36:11.629Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onecm/next.config.js v5
[2026-03-18T05:36:11.633Z] [INFO] [GitVFS] [GitVFS] Committed 0 files: Write project/sessions/onecm/next.config.js
[VFS] Potential concurrent modification: project/sessions/onecm/pages/index.js { timeSinceLastWrite: 17, previousVersion: 1 }
[2026-03-18T05:36:11.634Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onecm/pages/index.js v6
[2026-03-18T05:36:11.639Z] [INFO] [GitVFS] [GitVFS] Committed 0 files: Write project/sessions/onecm/pages/index.js
[VFS] Potential concurrent modification: project/sessions/onecm/styles/globals.css { timeSinceLastWrite: 18, previousVersion: 1 }
[2026-03-18T05:36:11.641Z] [DEBUG] [GitVFS] [GitVFS] Buffered change: update project/sessions/onecm/styles/globals.css v7
[2026-03-18T05:36:11.645Z] [INFO] [GitVFS] [GitVFS] Committed 0 files: Write project/sessions/onecm/styles/globals.css
2026-03-18T05:36:11.653Z [INFO] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Starting streaming response { eventsCount: 6, hasFilesystemEdits: true }
2026-03-18T05:36:11.954Z [INFO] Chat API [req:chat_1773812162304_x3h3AK08f provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Stream completed successfully { chunkCount: 6, latencyMs: 302, eventsCount: 6 }
 POST /api/chat 200 in 15.5s (compile: 5.8s, proxy.ts: 7ms, render: 9.7s)
[2026-03-18T05:36:16.224Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS SNAPSHOT] [pidr9i] GET /api/filesystem/snapshot path="project/sessions/onecm" (polling=false, count=1)
[VFS SNAPSHOT] [pidr9i] Snapshot: 4 files in 1ms (total workspace: 4 files)
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm 200 in 23ms (compile: 7ms, proxy.ts: 8ms, render: 8ms)
[VFS LIST] [g2pdvg] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [g2pdvg] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [g2pdvg] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 37ms (compile: 20ms, proxy.ts: 9ms, render: 8ms)
[VFS LIST] [gg3rjv] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=2)
[VFS LIST] [gg3rjv] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [gg3rjv] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 27ms (compile: 16ms, proxy.ts: 3ms, render: 7ms)
[VFS LIST] [c7lwg8] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=3)
[VFS LIST] [c7lwg8] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [c7lwg8] Listed 4 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 14ms (compile: 3ms, proxy.ts: 3ms, render: 8ms)
[VFS LIST WARN] POLLING DETECTED: 4 requests in 222ms for path "project/sessions/onecm"
[VFS LIST] [7q7ch3] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=4)
[VFS LIST] [7q7ch3] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [7q7ch3] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 16ms (compile: 4ms, proxy.ts: 5ms, render: 7ms)
[VFS LIST] [c8wzcc] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [c8wzcc] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [c8wzcc] Listed 1 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 23ms (compile: 6ms, proxy.ts: 7ms, render: 11ms)
 POST /api/filesystem/read 200 in 272ms (compile: 263ms, proxy.ts: 4ms, render: 5ms)
[VFS LIST] [iwpmyl] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=1)
[VFS LIST] [iwpmyl] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [iwpmyl] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 13ms (compile: 4ms, proxy.ts: 3ms, render: 6ms)
 POST /api/filesystem/read 200 in 10ms (compile: 3ms, proxy.ts: 4ms, render: 4ms)
 POST /api/filesystem/read 200 in 10ms (compile: 3ms, proxy.ts: 3ms, render: 4ms)
 POST /api/filesystem/read 200 in 14ms (compile: 3ms, proxy.ts: 6ms, render: 6ms)
[2026-03-18T05:36:21.229Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:36:26.237Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:36:31.248Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:36:36.249Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:36:41.251Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:36:46.262Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:36:51.271Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:36:56.274Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:01.274Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:06.287Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:11.297Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:16.311Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:21.328Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
 GET /webcontainer/connect/8669d46c 404 in 499ms (compile: 423ms, proxy.ts: 5ms, render: 71ms)
 POST /api/auth/validate 401 in 11ms (compile: 3ms, proxy.ts: 3ms, render: 4ms)
[2026-03-18T05:37:26.337Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [ufigrn] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [ufigrn] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [ufigrn] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 12ms (compile: 3ms, proxy.ts: 4ms, render: 5ms)
[2026-03-18T05:37:31.342Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:36.357Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:41.371Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [fquks3] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [fquks3] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [fquks3] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 12ms (compile: 3ms, proxy.ts: 3ms, render: 6ms)
[2026-03-18T05:37:46.373Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:51.386Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:37:56.386Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [2qpl7t] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [2qpl7t] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [2qpl7t] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 13ms (compile: 3ms, proxy.ts: 3ms, render: 7ms)
[VFS SNAPSHOT] [syie7f] GET /api/filesystem/snapshot path="project/sessions/onecm" (polling=false, count=1)
[VFS SNAPSHOT] [syie7f] Snapshot: 4 files in 1ms (total workspace: 4 files)
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm 200 in 17ms (compile: 6ms, proxy.ts: 4ms, render: 8ms)
[VFS LIST] [gb46xu] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=2)
[VFS LIST] [gb46xu] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [gb46xu] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 26ms (compile: 14ms, proxy.ts: 4ms, render: 8ms)
[VFS LIST] [8vuqn2] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=3)
[VFS LIST] [8vuqn2] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [8vuqn2] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 20ms (compile: 7ms, proxy.ts: 5ms, render: 8ms)
[VFS LIST WARN] POLLING DETECTED: 4 requests in 326ms for path "project/sessions/onecm"
[VFS LIST] [nqfgpz] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=4)
[VFS LIST] [nqfgpz] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [nqfgpz] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 14ms (compile: 4ms, proxy.ts: 4ms, render: 6ms)
[VFS LIST] [61yzka] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [61yzka] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [61yzka] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 17ms (compile: 4ms, proxy.ts: 5ms, render: 8ms)
 POST /api/filesystem/read 200 in 14ms (compile: 3ms, proxy.ts: 6ms, render: 5ms)
[VFS LIST] [qlvngx] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=1)
[VFS LIST] [qlvngx] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [qlvngx] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 13ms (compile: 3ms, proxy.ts: 4ms, render: 6ms)
 POST /api/filesystem/read 200 in 11ms (compile: 3ms, proxy.ts: 4ms, render: 4ms)
 POST /api/filesystem/read 200 in 17ms (compile: 5ms, proxy.ts: 6ms, render: 6ms)
 POST /api/filesystem/read 200 in 17ms (compile: 4ms, proxy.ts: 9ms, render: 4ms)
[VFS LIST WARN] POLLING DETECTED: 5 requests in 1952ms for path "project/sessions/onecm"
[VFS LIST] [ejet0w] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=5)
[VFS LIST] [ejet0w] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [ejet0w] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 13ms (compile: 3ms, proxy.ts: 5ms, render: 6ms)
[VFS LIST] [156f5x] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=2)
[VFS LIST] [156f5x] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [156f5x] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 11ms (compile: 3ms, proxy.ts: 3ms, render: 5ms)
 POST /api/filesystem/read 200 in 11ms (compile: 4ms, proxy.ts: 3ms, render: 4ms)
[2026-03-18T05:38:01.396Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
 POST /api/filesystem/read 200 in 12ms (compile: 3ms, proxy.ts: 4ms, render: 4ms)
 POST /api/filesystem/read 200 in 12ms (compile: 5ms, proxy.ts: 3ms, render: 5ms)
[2026-03-18T05:38:06.403Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [jqgy1l] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [jqgy1l] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [jqgy1l] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 11ms (compile: 4ms, proxy.ts: 3ms, render: 4ms)
[2026-03-18T05:38:11.405Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:16.406Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:17.609Z] [INFO] [DevBoxAPI] Creating DevBox {
  userId: 'anon:anon_1773812144948_7QplguZZn',
  template: 'node',
  fileCount: 4,
  rateLimitRemaining: 4
}
[2026-03-18T05:38:17.613Z] [DEBUG] [SandboxProviders] getSandboxProvider called with type: codesandbox
[2026-03-18T05:38:17.616Z] [DEBUG] [SandboxProviders] Starting initialization for provider codesandbox
[2026-03-18T05:38:17.616Z] [DEBUG] [SandboxProviders] Provider codesandbox initialization attempt 1/3
[2026-03-18T05:38:17.617Z] [INFO] [SandboxProviders] Provider codesandbox initialized successfully in 0.001s
[QuotaManager] Loaded 10 provider quotas from database
[CodeSandbox] Using template: node for language: node
[CodeSandbox] Creating sandbox - User: anon:anon_1773812144948_7QplguZZn, Template: node, Privacy: public-hosts
[CodeSandbox] Create options: {
  "id": "node",
  "tags": [
    "sdk",
    "user:anon:anon_1773812144948_7QplguZZn"
  ],
  "privacy": "public-hosts",
  "hibernationTimeoutSeconds": 86400,
  "automaticWakeupConfig": {
    "http": true,
    "websocket": true
  }
}
[CodeSandbox] Failed to create sandbox: Error: Failed to fork sandbox node: Unauthorized
    at async CodeSandboxProvider.createSandbox (lib\sandbox\providers\codesandbox-provider.ts:143:35)
    at async POST (app\api\sandbox\devbox\route.ts:122:27)
  141 |       console.log('[CodeSandbox] Create options:', JSON.stringify(createOpts, null, 2))
  142 |
> 143 |       const sandbox: CSBSandbox = await sdk.sandboxes.create(createOpts)
      |                                   ^
  144 |       console.log(`[CodeSandbox] ✓ Created sandbox ${sandbox.id}`)
  145 |
  146 |       const client: CSBClient = await sandbox.connect()
[CodeSandbox] Error details: {
  "message": "Failed to fork sandbox node: Unauthorized",
  "stack": "Error: Failed to fork sandbox node: Unauthorized\n    at handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_a66774b3._.js:8914:15)\n    at API.forkSandbox (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_a66774b3._.js:14574:16)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n    at async C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_a66774b3._.js:13842:29\n    at async CodeSandboxProvider.createSandbox (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\lib_sandbox_81e201c8._.js:4792:29)\n    at async POST (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\[root-of-the-server]__a7b3e052._.js:5243:31)\n    at async AppRouteRouteModule.do (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:37866)\n    at async AppRouteRouteModule.handle (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:45156)\n    at async responseGenerator (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_9df0670c._.js:15350:38)\n    at async AppRouteRouteModule.handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:1:191938)\n    at async handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_9df0670c._.js:15413:32)\n    at async Module.handler (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_9df0670c._.js:15466:13)\n    at async DevServer.renderToResponseWithComponentsImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1442:9)\n    at async DevServer.renderPageComponent (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1494:24)\n    at async DevServer.renderToResponseImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1544:32)\n    at async DevServer.pipeImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1038:25)\n    at async NextNodeServer.handleCatchallRenderRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\next-server.js:395:17)\n    at async DevServer.handleRequestImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:929:17)\n    at async C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:387:20\n    at async Span.traceAsyncFn (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\trace\\trace.js:157:20)\n    at async DevServer.handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:383:24)\n    at async invokeRender (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:248:21)\n    at async handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:447:24)\n    at async requestHandlerImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:496:13)\n    at async Server.requestListener (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\start-server.js:226:13)",
  "name": "Error"
}
[2026-03-18T05:38:18.175Z] [ERROR] [DevBoxAPI] Failed to create DevBox:
[2026-03-18T05:38:18.175Z] [ERROR] [DevBoxAPI] DevBox error: AUTH_FAILED
 POST /api/sandbox/devbox 401 in 2.2s (compile: 1663ms, proxy.ts: 4ms, render: 574ms)
[2026-03-18T05:38:21.408Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:26.410Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:31.425Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:36.438Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:41.448Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:46.452Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:51.455Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:38:56.456Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:01.467Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:06.479Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:11.482Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:16.482Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:21.491Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:26.497Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:31.510Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:36.510Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:41.514Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:46.518Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:51.520Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:39:56.531Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:01.540Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:06.547Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:11.562Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:16.573Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:21.579Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:26.583Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
Finding changed files: 41.112ms
Reading changed files: 37.426ms
Sorting candidates: 2.559ms
Generate rules: 6.084ms
Build stylesheet: 8.2ms
Potential classes:  1878
JIT TOTAL: 204.857ms
✓ Compiled in 339ms
[VFS SNAPSHOT] [oex8bs] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS SNAPSHOT] [oex8bs] Snapshot: 4 files in 1ms (total workspace: 4 files)
 GET /api/filesystem/snapshot?path=project 200 in 15ms (compile: 4ms, proxy.ts: 4ms, render: 8ms)
[2026-03-18T05:40:31.594Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
 GET /api/gateway/git/session-anon_1773812142026_3DjpUhFgH/versions?limit=20 404 in 107ms (compile: 47ms, proxy.ts: 4ms, render: 55ms)
[2026-03-18T05:40:36.595Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:41.610Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:46.622Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:51.632Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:40:56.645Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:41:01.649Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T05:41:06.217Z [DEBUG] Chat API [req:chat_1773812466216_5cVrDGnv0 user:anon:anon_1773812144948_7QplguZZn]: Anonymous request (no auth token/session) { authSuccess: true }
2026-03-18T05:41:06.220Z [DEBUG] Chat API [req:chat_1773812466216_5cVrDGnv0]: Request body validated {
  messageCount: 3,
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free',
  stream: true,
  userId: 'anon:anon_1773812144948_7QplguZZn'
}
2026-03-18T05:41:06.223Z [DEBUG] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Selected provider { supportsStreaming: true }
2026-03-18T05:41:06.227Z [DEBUG] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Validation passed, routing through priority chain {
  requestId: 'chat_1773812466216_5cVrDGnv0',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
[2026-03-18T05:41:06.658Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T05:41:11.220Z [ERROR] Chat API [req:chat_1773812466216_5cVrDGnv0]: V2 execution failed, falling back to v1 {
  error: 'fetch failed',
  stack: 'TypeError: fetch failed\n' +
    '    at node:internal/deps/undici/undici:14902:13\n' +
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n' +
    '    at async handleGatewayStreaming (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\app_api_chat_route_ts_827fe458._.js:1283:25)\n' +
    '    at async POST (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\app_api_chat_route_ts_827fe458._.js:306:28)\n' +
    '    at async AppRouteRouteModule.do (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:37866)\n' +
    '    at async AppRouteRouteModule.handle (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:5:45156)\n' +
    '    at async responseGenerator (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_df1334e6._.js:15355:38)\n' +
    '    at async AppRouteRouteModule.handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\compiled\\next-server\\app-route-turbo.runtime.dev.js:1:191938)\n' +
    '    at async handleResponse (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_df1334e6._.js:15418:32)\n' +
    '    at async Module.handler (C:\\Users\\ceclabs\\Downloads\\binG\\.next\\dev\\server\\chunks\\node_modules_next_df1334e6._.js:15471:13)\n' +
    '    at async DevServer.renderToResponseWithComponentsImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1442:9)\n' +
    '    at async DevServer.renderPageComponent (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1494:24)\n' +
    '    at async DevServer.renderToResponseImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1544:32)\n' +
    '    at async DevServer.pipeImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:1038:25)\n' +
    '    at async NextNodeServer.handleCatchallRenderRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\next-server.js:395:17)\n' +
    '    at async DevServer.handleRequestImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\base-server.js:929:17)\n' +
    '    at async C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:387:20\n' +
    '    at async Span.traceAsyncFn (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\trace\\trace.js:157:20)\n' +
    '    at async DevServer.handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\dev\\next-dev-server.js:383:24)\n' +
    '    at async invokeRender (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:248:21)\n' +
    '    at async handleRequest (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:447:24)\n' +
    '    at async requestHandlerImpl (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\router-server.js:496:13)\n' +
    '    at async Server.requestListener (C:\\Users\\ceclabs\\Downloads\\binG\\node_modules\\next\\dist\\server\\lib\\start-server.js:226:13)'
}
2026-03-18T05:41:11.221Z [INFO] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Using v1 fallback path after V2 failure {
  requestId: 'chat_1773812466216_5cVrDGnv0',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
2026-03-18T05:41:11.222Z [DEBUG] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Routing request through priority chain {
  requestType: 'chat',
  enableTools: undefined,
  enableSandbox: undefined,
  enableComposio: undefined
}
[2026-03-18T05:41:11.226Z] [DEBUG] [API:ResponseRouter] Routing to original-system
2026-03-18T05:41:11.228Z [DEBUG] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: false,
  enableSandbox: false,
  fallbackProviders: undefined
}
2026-03-18T05:41:11.228Z [DEBUG] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Calling provider { messageCount: 4, temperature: 0.7, maxTokens: 100096 }
2026-03-18T05:41:11.229Z [DEBUG] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM generateResponse called { messageCount: 4, temperature: 0.7, maxTokens: 100096 }
[2026-03-18T05:41:11.662Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:41:16.678Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 1, errors: 0, avgDurationMs: 4269 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T05:41:17.746Z [INFO] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM provider response generated {
  latencyMs: 6517,
  tokensUsed: 2690,
  finishReason: 'stop',
  contentLength: 1376
}
2026-03-18T05:41:17.746Z [DEBUG] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider call completed { latencyMs: 6518, tokensUsed: 2690, finishReason: 'stop' }
2026-03-18T05:41:17.747Z [INFO] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider request completed { latencyMs: 6520, tokensUsed: 2690, finishReason: 'stop' }
2026-03-18T05:41:17.749Z [INFO] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:original-system model:nvidia/nemotron-3-nano-30b-a3b:free]: Request handled by response router { source: 'original-system', priority: 1, fallbackChain: undefined }
2026-03-18T05:41:17.754Z [INFO] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Starting streaming response { eventsCount: 3, hasFilesystemEdits: true }
2026-03-18T05:41:17.874Z [INFO] Chat API [req:chat_1773812466216_5cVrDGnv0 provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Stream completed successfully { chunkCount: 3, latencyMs: 121, eventsCount: 3 }
 POST /api/chat 200 in 11.7s (compile: 38ms, proxy.ts: 6ms, render: 11.7s)
[2026-03-18T05:41:21.678Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 2, errors: 0, avgDurationMs: 5398 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:41:26.682Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 2, errors: 0, avgDurationMs: 5398 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
Finding changed files: 51.234ms
Reading changed files: 40.854ms
Sorting candidates: 2.316ms
Generate rules: 4.533ms
Build stylesheet: 0.013ms
JIT TOTAL: 218.45ms
✓ Compiled in 316ms
[VFS SNAPSHOT] [w5peg7] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS SNAPSHOT] [w5peg7] Snapshot: 4 files in 2ms (total workspace: 4 files)
[VFS SNAPSHOT WARN] [w5peg7] STALE SNAPSHOT: last updated 319s ago
 GET /api/filesystem/snapshot?path=project 200 in 26ms (compile: 5ms, proxy.ts: 7ms, render: 14ms)
[2026-03-18T05:41:31.696Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
2026-03-18T05:41:54.286Z [INFO] Chat API [req:chat_1773812509295_259vSy5Ih provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Using v1 fallback path after V2 failure {
  requestId: 'chat_1773812509295_259vSy5Ih',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
2026-03-18T05:41:54.288Z [DEBUG] Chat API [req:chat_1773812509295_259vSy5Ih provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Routing request through priority chain {
  requestType: 'chat',
  enableTools: undefined,
  enableSandbox: undefined,
  enableComposio: undefined
}
[2026-03-18T05:41:54.289Z] [DEBUG] [API:ResponseRouter] Routing to original-system
2026-03-18T05:41:54.289Z [DEBUG] Chat API [req:chat_1773812509295_259vSy5Ih provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: false,
  enableSandbox: false,
  fallbackProviders: undefined
}
2026-03-18T05:41:54.290Z [DEBUG] Chat API [req:chat_1773812509295_259vSy5Ih provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Calling provider { messageCount: 5, temperature: 0.7, maxTokens: 100096 }
2026-03-18T05:41:54.290Z [DEBUG] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM generateResponse called { messageCount: 5, temperature: 0.7, maxTokens: 100096 }
[2026-03-18T05:41:56.742Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 2, errors: 0, avgDurationMs: 5398 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
Finding changed files: 52.696ms
Reading changed files: 43.5ms
Sorting candidates: 2.678ms
Generate rules: 4.578ms
Build stylesheet: 0.015ms
JIT TOTAL: 241.232ms
✓ Compiled in 351ms
[2026-03-18T05:42:01.754Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 2, errors: 0, avgDurationMs: 5398 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T05:42:05.237Z [INFO] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM provider response generated {
  latencyMs: 10946,
  tokensUsed: 2492,
  finishReason: 'stop',
  contentLength: 8442
}
2026-03-18T05:42:05.239Z [DEBUG] Chat API [req:chat_1773812509295_259vSy5Ih provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider call completed { latencyMs: 10949, tokensUsed: 2492, finishReason: 'stop' }
2026-03-18T05:42:05.241Z [INFO] Chat API [req:chat_1773812509295_259vSy5Ih provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider request completed { latencyMs: 10952, tokensUsed: 2492, finishReason: 'stop' }
2026-03-18T05:42:05.243Z [INFO] Chat API [req:chat_1773812509295_259vSy5Ih provider:original-system model:nvidia/nemotron-3-nano-30b-a3b:free]: Request handled by response router { source: 'original-system', priority: 1, fallbackChain: undefined }
2026-03-18T05:42:05.250Z [INFO] Chat API [req:chat_1773812509295_259vSy5Ih provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Starting streaming response { eventsCount: 245, hasFilesystemEdits: false }
Finding changed files: 46.618ms
Reading changed files: 43.68ms
Sorting candidates: 1.678ms
Generate rules: 3.418ms
Build stylesheet: 0.009ms
JIT TOTAL: 206.82ms
✓ Compiled in 300ms
[2026-03-18T05:42:06.767Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS SNAPSHOT] [1ih9ac] GET /api/filesystem/snapshot path="project" (polling=false, count=1)
[VFS SNAPSHOT] [1ih9ac] Snapshot: 4 files in 2ms (total workspace: 4 files)
[VFS SNAPSHOT WARN] [1ih9ac] STALE SNAPSHOT: last updated 358s ago
 GET /api/filesystem/snapshot?path=project 200 in 24ms (compile: 6ms, proxy.ts: 9ms, render: 10ms)
[2026-03-18T05:42:11.781Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
Finding changed files: 51.032ms
Reading changed files: 51.159ms
Sorting candidates: 1.551ms
Generate rules: 3.696ms
Build stylesheet: 0.011ms
JIT TOTAL: 249.582ms
✓ Compiled in 361ms
[2026-03-18T05:42:16.786Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T05:42:20.114Z [INFO] Chat API [req:chat_1773812509295_259vSy5Ih provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Stream completed successfully { chunkCount: 245, latencyMs: 14865, eventsCount: 245 }
 POST /api/chat 200 in 30.9s (compile: 28ms, proxy.ts: 4ms, render: 30.8s)
[2026-03-18T05:42:21.796Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:42:26.807Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:42:31.812Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
Finding changed files: 39.522ms
Reading changed files: 35.861ms
Sorting candidates: 1.787ms
Generate rules: 4.697ms
Build stylesheet: 0.012ms
JIT TOTAL: 201.006ms
 GET / 200 in 39ms (compile: 8ms, proxy.ts: 3ms, render: 29ms)
 GET /api/providers 200 in 38ms (compile: 21ms, proxy.ts: 12ms, render: 5ms)
 GET /api/auth/session 200 in 44ms (compile: 25ms, proxy.ts: 12ms, render: 6ms)
 GET /api/gateway/git/session-anon_1773812142026_3DjpUhFgH/versions?limit=20 404 in 136ms (compile: 13ms, proxy.ts: 5ms, render: 118ms)
[2026-03-18T05:42:36.825Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:42:41.837Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:42:46.840Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [nln5sz] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [nln5sz] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [nln5sz] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 19ms (compile: 5ms, proxy.ts: 5ms, render: 9ms)
[VFS SNAPSHOT] [pnw6aw] GET /api/filesystem/snapshot path="project/sessions/onecm" (polling=false, count=1)
[VFS SNAPSHOT] [pnw6aw] Snapshot: 4 files in 1ms (total workspace: 4 files)
[VFS SNAPSHOT WARN] [pnw6aw] STALE SNAPSHOT: last updated 396s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm 200 in 23ms (compile: 6ms, proxy.ts: 9ms, render: 8ms)
[VFS LIST] [ah9wy1] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=2)
[VFS LIST] [ah9wy1] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [ah9wy1] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 30ms (compile: 17ms, proxy.ts: 8ms, render: 5ms)
[VFS LIST] [0areq9] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=3)
[VFS LIST] [0areq9] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [0areq9] Listed 4 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 28ms (compile: 9ms, proxy.ts: 4ms, render: 15ms)
[VFS LIST WARN] POLLING DETECTED: 4 requests in 607ms for path "project/sessions/onecm"
[VFS LIST] [x5p2l5] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=4)
[VFS LIST] [x5p2l5] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [x5p2l5] Listed 4 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 20ms (compile: 6ms, proxy.ts: 5ms, render: 9ms)
[VFS LIST] [hg60iy] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [hg60iy] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [hg60iy] Listed 1 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 19ms (compile: 3ms, proxy.ts: 5ms, render: 11ms)
 POST /api/filesystem/read 200 in 19ms (compile: 8ms, proxy.ts: 5ms, render: 5ms)
[VFS LIST] [1x1flc] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=1)
[VFS LIST] [1x1flc] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [1x1flc] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 15ms (compile: 4ms, proxy.ts: 3ms, render: 8ms)
 POST /api/filesystem/read 200 in 16ms (compile: 5ms, proxy.ts: 7ms, render: 4ms)
 POST /api/filesystem/read 200 in 35ms (compile: 9ms, proxy.ts: 17ms, render: 9ms)
 POST /api/filesystem/read 200 in 33ms (compile: 14ms, proxy.ts: 9ms, render: 10ms)
[VFS LIST WARN] POLLING DETECTED: 5 requests in 1978ms for path "project/sessions/onecm"
[VFS LIST] [088siu] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=5)
[VFS LIST] [088siu] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [088siu] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 16ms (compile: 3ms, proxy.ts: 6ms, render: 7ms)
[2026-03-18T05:42:51.848Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:42:56.859Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:01.860Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:06.873Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:11.882Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:16.883Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [za6sor] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=1)
[VFS LIST] [za6sor] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [za6sor] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 15ms (compile: 3ms, proxy.ts: 3ms, render: 9ms)
[VFS LIST] [qs1f7u] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [qs1f7u] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [qs1f7u] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 15ms (compile: 3ms, proxy.ts: 5ms, render: 7ms)
[2026-03-18T05:43:21.891Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:26.897Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:31.908Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:36.917Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:41.919Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:46.920Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:51.922Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:43:56.927Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:01.930Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:06.943Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:11.950Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:16.956Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:21.959Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:26.965Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:31.976Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:36.986Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:42.001Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:47.010Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:52.024Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:44:57.025Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:02.025Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:07.036Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:12.043Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:17.051Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:22.056Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [ko1uyv] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [ko1uyv] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [ko1uyv] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 20ms (compile: 9ms, proxy.ts: 6ms, render: 6ms)
[VFS SNAPSHOT] [wiz206] GET /api/filesystem/snapshot path="project/sessions/onecm" (polling=false, count=1)
[VFS SNAPSHOT] [wiz206] Snapshot: 4 files in 1ms (total workspace: 4 files)
[VFS SNAPSHOT WARN] [wiz206] STALE SNAPSHOT: last updated 555s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm 200 in 28ms (compile: 16ms, proxy.ts: 6ms, render: 6ms)
[VFS LIST] [5jmvh6] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=2)
[VFS LIST] [5jmvh6] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [5jmvh6] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 28ms (compile: 7ms, proxy.ts: 8ms, render: 13ms)
[VFS LIST] [3sreh8] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=3)
[VFS LIST] [3sreh8] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [3sreh8] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 18ms (compile: 4ms, proxy.ts: 5ms, render: 9ms)
[VFS LIST WARN] POLLING DETECTED: 4 requests in 247ms for path "project/sessions/onecm"
[VFS LIST] [5r7fhu] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=4)
[VFS LIST] [5r7fhu] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [5r7fhu] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 19ms (compile: 5ms, proxy.ts: 4ms, render: 9ms)
[VFS LIST] [dq3ewa] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [dq3ewa] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [dq3ewa] Listed 1 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 24ms (compile: 5ms, proxy.ts: 7ms, render: 13ms)
[2026-03-18T05:45:27.057Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
 POST /api/filesystem/read 200 in 24ms (compile: 4ms, proxy.ts: 8ms, render: 12ms)
[VFS LIST] [hgfmn4] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=1)
[VFS LIST] [hgfmn4] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [hgfmn4] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 13ms (compile: 3ms, proxy.ts: 5ms, render: 5ms)
 POST /api/filesystem/read 200 in 16ms (compile: 4ms, proxy.ts: 5ms, render: 6ms)
 POST /api/filesystem/read 200 in 13ms (compile: 2ms, proxy.ts: 7ms, render: 4ms)
 POST /api/filesystem/read 200 in 14ms (compile: 3ms, proxy.ts: 6ms, render: 5ms)
[2026-03-18T05:45:32.065Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:37.072Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:42.079Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:47.087Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:45:52.098Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [x34mzg] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [x34mzg] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [x34mzg] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 22ms (compile: 7ms, proxy.ts: 6ms, render: 8ms)
[VFS SNAPSHOT] [0yfpnt] GET /api/filesystem/snapshot path="project/sessions/onecm" (polling=false, count=1)
[VFS SNAPSHOT] [0yfpnt] Cache hit (age: 27s)
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm 200 in 28ms (compile: 16ms, proxy.ts: 6ms, render: 5ms)
[VFS LIST] [zdrsbq] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=2)
[VFS LIST] [zdrsbq] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [zdrsbq] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 15ms (compile: 3ms, proxy.ts: 6ms, render: 6ms)
[VFS LIST] [9esb5v] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=3)
[VFS LIST] [9esb5v] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [9esb5v] Listed 4 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 17ms (compile: 3ms, proxy.ts: 5ms, render: 9ms)
[VFS LIST WARN] POLLING DETECTED: 4 requests in 202ms for path "project/sessions/onecm"
[VFS LIST] [q878ro] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=4)
[VFS LIST] [q878ro] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [q878ro] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 18ms (compile: 6ms, proxy.ts: 3ms, render: 9ms)
[VFS LIST] [yefonz] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [yefonz] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [yefonz] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 16ms (compile: 5ms, proxy.ts: 6ms, render: 5ms)
 POST /api/filesystem/read 200 in 16ms (compile: 4ms, proxy.ts: 6ms, render: 7ms)
[VFS LIST] [vpgjkq] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=1)
[VFS LIST] [vpgjkq] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [vpgjkq] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 15ms (compile: 3ms, proxy.ts: 5ms, render: 6ms)
 POST /api/filesystem/read 200 in 15ms (compile: 6ms, proxy.ts: 6ms, render: 4ms)
 POST /api/filesystem/read 200 in 13ms (compile: 3ms, proxy.ts: 5ms, render: 5ms)
 POST /api/filesystem/read 200 in 18ms (compile: 5ms, proxy.ts: 6ms, render: 7ms)
[VFS LIST WARN] POLLING DETECTED: 5 requests in 1419ms for path "project/sessions/onecm"
[VFS LIST] [vt0xyd] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=5)
[VFS LIST] [vt0xyd] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [vt0xyd] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 10ms (compile: 3ms, proxy.ts: 3ms, render: 5ms)
[VFS LIST] [aqgmgr] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=2)
[VFS LIST] [aqgmgr] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [aqgmgr] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 10ms (compile: 2ms, proxy.ts: 3ms, render: 6ms)
[2026-03-18T05:45:57.102Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
 POST /api/filesystem/read 200 in 12ms (compile: 3ms, proxy.ts: 4ms, render: 5ms)
[2026-03-18T05:46:02.106Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:07.117Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:12.122Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [an9vbi] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [an9vbi] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [an9vbi] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 14ms (compile: 4ms, proxy.ts: 5ms, render: 5ms)
[VFS LIST] [lioy4t] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [lioy4t] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [lioy4t] Listed 1 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 13ms (compile: 3ms, proxy.ts: 4ms, render: 6ms)
[2026-03-18T05:46:17.136Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:22.141Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
✓ Compiled in 53ms
[VFS SNAPSHOT] [2o08vw] GET /api/filesystem/snapshot path="project/sessions/onecm" (polling=false, count=1)
[VFS SNAPSHOT] [2o08vw] Snapshot: 4 files in 1ms (total workspace: 4 files)
[VFS SNAPSHOT WARN] [2o08vw] STALE SNAPSHOT: last updated 615s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm 200 in 16ms (compile: 4ms, proxy.ts: 4ms, render: 8ms)
[2026-03-18T05:46:27.144Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:32.146Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:37.150Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:42.157Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:47.161Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:52.166Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:46:57.167Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:47:02.178Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:47:07.180Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:47:12.187Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:47:17.199Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [mkt653] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [mkt653] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [mkt653] Listed 1 entries in 3ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 15ms (compile: 3ms, proxy.ts: 5ms, render: 7ms)
[VFS LIST] [d69una] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=2)
[VFS LIST] [d69una] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [d69una] Listed 1 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 14ms (compile: 3ms, proxy.ts: 5ms, render: 6ms)
[VFS LIST] [8mkp70] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=3)
[VFS LIST] [8mkp70] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [8mkp70] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 13ms (compile: 4ms, proxy.ts: 3ms, render: 6ms)
[2026-03-18T05:47:22.207Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [c6oito] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [c6oito] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [c6oito] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 11ms (compile: 3ms, proxy.ts: 4ms, render: 5ms)
[2026-03-18T05:47:27.211Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
✓ Compiled in 45ms
[VFS SNAPSHOT] [pg8oo4] GET /api/filesystem/snapshot path="project/sessions/onecm" (polling=false, count=1)
[VFS SNAPSHOT] [pg8oo4] Snapshot: 4 files in 1ms (total workspace: 4 files)
[VFS SNAPSHOT WARN] [pg8oo4] STALE SNAPSHOT: last updated 678s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm 200 in 15ms (compile: 5ms, proxy.ts: 5ms, render: 5ms)
[2026-03-18T05:47:32.218Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [k4o7yk] GET /api/filesystem/list path="project/sessions" (polling=false, count=1)
[VFS LIST] [k4o7yk] Listing directory: "project/sessions" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [k4o7yk] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 16ms (compile: 5ms, proxy.ts: 5ms, render: 6ms)
[VFS LIST] [zuzxuc] GET /api/filesystem/list path="project" (polling=false, count=1)
[VFS LIST] [zuzxuc] Listing directory: "project" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [zuzxuc] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project 200 in 20ms (compile: 7ms, proxy.ts: 5ms, render: 8ms)
[VFS LIST] [bboec8] GET /api/filesystem/list path="project/sessions" (polling=false, count=2)
[VFS LIST] [bboec8] Listing directory: "project/sessions" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [bboec8] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions 200 in 16ms (compile: 5ms, proxy.ts: 3ms, render: 8ms)
[VFS LIST] [y4o8nq] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [y4o8nq] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [y4o8nq] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 19ms (compile: 4ms, proxy.ts: 4ms, render: 10ms)
[VFS LIST] [vdg6g2] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=1)
[VFS LIST] [vdg6g2] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [vdg6g2] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 15ms (compile: 3ms, proxy.ts: 5ms, render: 7ms)
[2026-03-18T05:47:37.218Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [rq36bc] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [rq36bc] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [rq36bc] Listed 4 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 14ms (compile: 3ms, proxy.ts: 4ms, render: 7ms)
[2026-03-18T05:47:42.223Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:47:47.235Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:47:52.235Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
Finding changed files: 52.601ms
Reading changed files: 77.421ms
Sorting candidates: 3.75ms
Generate rules: 5.537ms
Build stylesheet: 0.035ms
Potential classes:  3833
JIT TOTAL: 278.428ms
✓ Compiled in 400ms
[2026-03-18T05:47:57.237Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:48:02.239Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T05:48:06.146Z [DEBUG] Chat API [req:chat_1773812886144_bYH2LuZTk user:anon:anon_1773812144948_7QplguZZn]: Anonymous request (no auth token/session) { authSuccess: true }
2026-03-18T05:48:06.148Z [DEBUG] Chat API [req:chat_1773812886144_bYH2LuZTk]: Request body validated {
  messageCount: 7,
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free',
  stream: true,
  userId: 'anon:anon_1773812144948_7QplguZZn'
}
2026-03-18T05:48:06.149Z [DEBUG] Chat API [req:chat_1773812886144_bYH2LuZTk provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Selected provider { supportsStreaming: true }
2026-03-18T05:48:06.151Z [DEBUG] Chat API [req:chat_1773812886144_bYH2LuZTk provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Validation passed, routing through priority chain {
  requestId: 'chat_1773812886144_bYH2LuZTk',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
 POST /api/chat 401 in 53ms (compile: 28ms, proxy.ts: 8ms, render: 17ms)
[2026-03-18T05:48:07.241Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T05:48:12.248Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [0jsjya] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=1)
[VFS LIST] [0jsjya] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [0jsjya] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 216ms (compile: 68ms, proxy.ts: 11ms, render: 138ms)
[VFS SNAPSHOT] [yux870] GET /api/filesystem/snapshot path="project/sessions/onecm" (polling=false, count=1)
[VFS SNAPSHOT] [yux870] Snapshot: 4 files in 3ms (total workspace: 4 files)
[VFS SNAPSHOT WARN] [yux870] STALE SNAPSHOT: last updated 723s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm 200 in 268ms (compile: 226ms, proxy.ts: 12ms, render: 30ms)
[VFS LIST] [o2b1kv] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=2)
[VFS LIST] [o2b1kv] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [o2b1kv] Listed 4 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 20ms (compile: 5ms, proxy.ts: 8ms, render: 7ms)
[VFS LIST] [11fj6p] GET /api/filesystem/list path="project/sessions/onecm" (polling=false, count=3)
[VFS LIST] [11fj6p] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [11fj6p] Listed 4 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 24ms (compile: 5ms, proxy.ts: 7ms, render: 12ms)
[VFS LIST WARN] POLLING DETECTED: 4 requests in 281ms for path "project/sessions/onecm"
[VFS LIST] [6a31z3] GET /api/filesystem/list path="project/sessions/onecm" (polling=true, count=4)
[VFS LIST] [6a31z3] Listing directory: "project/sessions/onecm" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [6a31z3] Listed 4 entries in 4ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm 200 in 31ms (compile: 8ms, proxy.ts: 8ms, render: 16ms)
[VFS LIST] [rapm8n] GET /api/filesystem/list path="project/sessions/onecm/pages" (polling=false, count=1)
[VFS LIST] [rapm8n] Listing directory: "project/sessions/onecm/pages" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [rapm8n] Listed 1 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages 200 in 22ms (compile: 5ms, proxy.ts: 8ms, render: 8ms)
 POST /api/filesystem/read 200 in 54ms (compile: 27ms, proxy.ts: 7ms, render: 21ms)
[VFS LIST] [ohx18t] GET /api/filesystem/list path="project/sessions/onecm/styles" (polling=false, count=1)
[VFS LIST] [ohx18t] Listing directory: "project/sessions/onecm/styles" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [ohx18t] Listed 1 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles 200 in 21ms (compile: 8ms, proxy.ts: 5ms, render: 8ms)
 POST /api/filesystem/read 200 in 20ms (compile: 7ms, proxy.ts: 4ms, render: 9ms)
 POST /api/filesystem/read 200 in 20ms (compile: 4ms, proxy.ts: 5ms, render: 10ms)
 POST /api/filesystem/read 200 in 20ms (compile: 6ms, proxy.ts: 7ms, render: 7ms)
[2026-03-18T05:48:17.252Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 3, errors: 0, avgDurationMs: 7250 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
Finding changed files: 43.655ms












New request for a Nuxt app in Docker also failed to preview. it returns a nuxt app with dockerfile/compose yml but isnt detected for codesandbox preview , and sandpack also fails to gather or bundle its files seemingly:

2026-03-18T06:10:55.647Z [INFO] Chat API [req:chat_1773814250659_D1C4rhCHK provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Using v1 fallback path after V2 failure {
  requestId: 'chat_1773814250659_D1C4rhCHK',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-nano-30b-a3b:free'
}
2026-03-18T06:10:55.647Z [DEBUG] Chat API [req:chat_1773814250659_D1C4rhCHK provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Routing request through priority chain {
  requestType: 'chat',
  enableTools: undefined,
  enableSandbox: undefined,
  enableComposio: undefined
}
[2026-03-18T06:10:55.649Z] [DEBUG] [API:ResponseRouter] Routing to original-system
2026-03-18T06:10:55.650Z [DEBUG] Chat API [req:chat_1773814250659_D1C4rhCHK provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Enhanced LLM service processing request {
  task: undefined,
  enableTools: false,
  enableSandbox: false,
  fallbackProviders: undefined
}
2026-03-18T06:10:55.651Z [DEBUG] Chat API [req:chat_1773814250659_D1C4rhCHK provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Calling provider { messageCount: 4, temperature: 0.7, maxTokens: 100096 }
2026-03-18T06:10:55.651Z [DEBUG] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM generateResponse called { messageCount: 4, temperature: 0.7, maxTokens: 100096 }
[2026-03-18T06:10:59.360Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 4, errors: 0, avgDurationMs: 8830 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[2026-03-18T06:11:04.373Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 4, errors: 0, avgDurationMs: 8830 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
2026-03-18T06:11:05.729Z [INFO] Chat API [provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: LLM provider response generated {
  latencyMs: 10077,
  tokensUsed: 4115,
  finishReason: 'stop',
  contentLength: 9923
}
2026-03-18T06:11:05.730Z [DEBUG] Chat API [req:chat_1773814250659_D1C4rhCHK provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider call completed { latencyMs: 10079, tokensUsed: 4115, finishReason: 'stop' }
2026-03-18T06:11:05.730Z [INFO] Chat API [req:chat_1773814250659_D1C4rhCHK provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Provider request completed { latencyMs: 10080, tokensUsed: 4115, finishReason: 'stop' }
2026-03-18T06:11:05.731Z [INFO] Chat API [req:chat_1773814250659_D1C4rhCHK provider:original-system model:nvidia/nemotron-3-nano-30b-a3b:free]: Request handled by response router { source: 'original-system', priority: 1, fallbackChain: undefined }
2026-03-18T06:11:05.735Z [INFO] Chat API [req:chat_1773814250659_D1C4rhCHK provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Starting streaming response { eventsCount: 19, hasFilesystemEdits: true }
2026-03-18T06:11:06.832Z [INFO] Chat API [req:chat_1773814250659_D1C4rhCHK provider:openrouter model:nvidia/nemotron-3-nano-30b-a3b:free]: Stream completed successfully { chunkCount: 19, latencyMs: 1097, eventsCount: 19 }
[VFS LIST] [5suaa6] GET /api/filesystem/list path="project/sessions/threeqq" (polling=false, count=1)
[VFS LIST] [5suaa6] Listing directory: "project/sessions/threeqq" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [5suaa6] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq 200 in 18ms (compile: 7ms, proxy.ts: 5ms, render: 6ms)
[VFS SNAPSHOT] [mpup4s] GET /api/filesystem/snapshot path="project/sessions/threeqq" (polling=false, count=1)
[VFS SNAPSHOT] [mpup4s] Snapshot: 12 files in 1ms (total workspace: 16 files)
[VFS SNAPSHOT WARN] [mpup4s] STALE SNAPSHOT: last updated 728s ago
 GET /api/filesystem/snapshot?path=project%2Fsessions%2Fthreeqq 200 in 24ms (compile: 13ms, proxy.ts: 5ms, render: 7ms)
[VFS LIST] [xd7oq6] GET /api/filesystem/list path="project/sessions/threeqq" (polling=false, count=2)
[VFS LIST] [xd7oq6] Listing directory: "project/sessions/threeqq" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [xd7oq6] Listed 1 entries in 2ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq 200 in 21ms (compile: 6ms, proxy.ts: 4ms, render: 10ms)
[VFS LIST] [92hfua] GET /api/filesystem/list path="project/sessions/threeqq" (polling=false, count=3)
[VFS LIST] [92hfua] Listing directory: "project/sessions/threeqq" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [92hfua] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq 200 in 11ms (compile: 3ms, proxy.ts: 3ms, render: 5ms)
[2026-03-18T06:11:59.462Z] [INFO] [Telemetry:ResponseRouter] Metrics Summary {
  requests: { total: 5, errors: 0, avgDurationMs: 9080 },
  v2Gateway: { submissions: 0, completions: 0, failures: 0, avgDurationMs: 0 },
  circuitBreaker: { trips: 0, states: {} },
  tools: { executions: 0, errors: 0 }
}
[VFS LIST] [a9jac9] GET /api/filesystem/list path="project/sessions/threeqq/nuxt-app" (polling=false, count=1)
[VFS LIST] [a9jac9] Listing directory: "project/sessions/threeqq/nuxt-app" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [a9jac9] Listed 10 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq%2Fnuxt-app 200 in 14ms (compile: 3ms, proxy.ts: 4ms, render: 7ms)
[VFS LIST] [gnde0n] GET /api/filesystem/list path="project/sessions/threeqq/nuxt-app/public" (polling=false, count=1)
[VFS LIST] [gnde0n] Listing directory: "project/sessions/threeqq/nuxt-app/public" for owner="anon:anon_1773812144948_7QplguZZn"
[VFS LIST] [gnde0n] Listed 1 entries in 1ms
 GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq%2Fnuxt-app%2Fpublic 200 in 11ms (compile: 2ms, proxy.ts: 3ms, render: 5ms)


...
(more. and yes, I correctly have api keys set)

Failed to load resource: the server responded with a status of 401 (Unauthorized)Understand this error
headless?version=1.6.1:1 The resource https://w-corp-staticblitz.com/fetch.worker.8669d46c.js was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally.Understand this warning
 [Contextify] [WARNING] running source code in new context
(anonymous) @ blitz.8669d46c.js:19
_0x12d1ec @ blitz.8669d46c.js:31
runInContext @ blitz.8669d46c.js:31
runInContext @ iframe.main.8669d46c.js:343
runInNewContext @ iframe.main.8669d46c.js:343
runInNewContext @ iframe.main.8669d46c.js:343
getInternalGlobal @ iframe.main.8669d46c.js:275
getCrossRealmRegex @ iframe.main.8669d46c.js:275
SideEffectFreeRegExpPrototypeSymbolReplace @ iframe.main.8669d46c.js:275
lazyWritableReleasedError @ iframe.main.8669d46c.js:305
writableStreamDefaultWriterRelease @ iframe.main.8669d46c.js:305
finalize @ iframe.main.8669d46c.js:301
(anonymous) @ iframe.main.8669d46c.js:301
(anonymous) @ blitz.8669d46c.js:31Understand this warning
headless?version=1.6.1:1 The resource https://w-corp-staticblitz.com/fetch.worker.8669d46c.js was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally.Understand this warning
headless?version=1.6.1:1 The resource https://w-corp-staticblitz.com/fetch.worker.8669d46c.js was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally.Understand this warning
:3000/api/sandbox/devbox:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)Understand this error
:3000/api/gateway/git/session-anon_1773812142026_3DjpUhFgH/versions?limit=20:1  Failed to load resource: the server responded with a status of 404 (Not Found)Understand this error
:3000/api/gateway/git/session-anon_1773812142026_3DjpUhFgH/versions?limit=20:1  Failed to load resource: the server responded with a status of 404 (Not Found)Understand this error
14forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project/sessions/onecm", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm
forward-logs-shared.ts:95 [Fast Refresh] done in 61ms
forward-logs-shared.ts:95 [useVFS] request: response status=200
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
118forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm/pages"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm/pages", 1 entries
6forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm/pages"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm/pages", 1 entries
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm/pages"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm/pages", 1 entries
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/onecm" -> "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm", 4 entries
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project/sessions/onecm", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm
forward-logs-shared.ts:95 [Fast Refresh] done in 60ms
forward-logs-shared.ts:95 [useVFS] request: response status=200
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions" -> "project/sessions"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions", 1 entries
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project" -> "project"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project", 1 entries
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions" -> "project/sessions"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions", 1 entries
6forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/onecm" -> "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm", 4 entries
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/onecm/styles" -> "project/sessions/onecm/styles"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm/styles"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm/styles", 1 entries
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/onecm" -> "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm", 4 entries
12forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [Fast Refresh] done in 439ms
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 0
forward-logs-shared.ts:95 Result: Object
:3000/api/chat:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)Understand this error
forward-logs-shared.ts:95 Streaming session display-assistant-1773812886102-1773812886348 completed
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 96
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 [useVFS WARN] OPFS not supported in this browser - using server-only mode
warn @ forward-logs-shared.ts:95Understand this warning
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm
forward-logs-shared.ts:95 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project/sessions/onecm", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
forward-logs-shared.ts:95 [useVFS WARN] OPFS not supported in this browser - using server-only mode
warn @ forward-logs-shared.ts:95Understand this warning
forward-logs-shared.ts:95 [useVFS] getSnapshot: joining in-flight request for "project/sessions/onecm"
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm", 4 entries
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [Fast Refresh] done in 230ms
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Normalized 4 -> 4 (filtered) -> 4 (scope strip)
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm", 4 entries
forward-logs-shared.ts:95 [CodePreviewPanel] [autoLoadPreview] files detected, loading preview automatically
forward-logs-shared.ts:95 [Manual Preview] Loading files from: project/sessions/onecm
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm", 4 entries
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm", 4 entries
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm/pages"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fpages
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm/pages", 1 entries
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/onecm/pages/index.js"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/onecm/styles"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fonecm%2Fstyles
forward-logs-shared.ts:95 [Fast Refresh] done in 142ms
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/onecm/styles", 1 entries
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/onecm/styles/globals.css"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/onecm/next.config.js"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/onecm/package.json"
forward-logs-shared.ts:95 [CodePreviewPanel] [handleManualPreview] detected root="", files normalized from 4 to 4
forward-logs-shared.ts:95 [2026-03-18T05:48:15.112Z] [DEBUG] [Previews:LivePreview] [detectProject] framework=next, bundler=unknown, previewMode=nextjs, files=4, shouldOffload=false
forward-logs-shared.ts:95 [CodePreviewPanel] [handleManualPreview] Detected via live-preview-offloading: framework=next, bundler=unknown, mode=nextjs, root=""
forward-logs-shared.ts:95 [CodePreviewPanel] [handleManualPreview] mode="nextjs", execution="local", root=""
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [Fast Refresh] done in 110ms
4forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project/sessions/onecm", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fonecm
forward-logs-shared.ts:95 [Fast Refresh] done in 428ms
forward-logs-shared.ts:95 [useVFS] request: response status=200
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
6forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
2forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache hit for "project/sessions/onecm" (fresh: true)
forward-logs-shared.ts:95 [Fast Refresh] done in 350ms
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="pages/index.js", previewModeHint="vite"
186forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [Fast Refresh] done in 319ms
66forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Detected entry file: /pages/index.js
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [TerminalPanel] isOpen is false, skipping VFS sync
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 0 entries
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 0
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 38
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 117
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 178
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 211
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 241
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 277
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 310
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 350
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 391
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 435
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 467
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 513
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 520
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 520
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Streaming session display-assistant-1773813570766-1773813570884 completed
forward-logs-shared.ts:95 [useVFS WARN] OPFS not supported in this browser - using server-only mode
warn @ forward-logs-shared.ts:95Understand this warning
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project/sessions/threeqq", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
forward-logs-shared.ts:95 [useVFS WARN] OPFS not supported in this browser - using server-only mode
warn @ forward-logs-shared.ts:95Understand this warning
forward-logs-shared.ts:95 [useVFS] getSnapshot: joining in-flight request for "project/sessions/threeqq"
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 1 entries
forward-logs-shared.ts:95 [useVFS] request: response status=200
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Normalized 12 -> 12 (filtered) -> 12 (scope strip)
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 1 entries
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 1 entries
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/threeqq/nuxt-app" -> "project/sessions/threeqq/nuxt-app"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq/nuxt-app"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq%2Fnuxt-app
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq/nuxt-app", 10 entries
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: attempting to open "project/sessions/threeqq/nuxt-app/docker-compose.yml"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: reading from normalized path "project/sessions/threeqq/nuxt-app/docker-compose.yml"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/threeqq/nuxt-app/docker-compose.yml"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: successfully read file, path="project/sessions/threeqq/nuxt-app/docker-compose.yml", language="yaml", contentLength=428
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: completed (loading=false)
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/threeqq" -> "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 1 entries
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/threeqq/nuxt-app" -> "project/sessions/threeqq/nuxt-app"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq/nuxt-app"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq%2Fnuxt-app
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq/nuxt-app", 10 entries
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: attempting to open "project/sessions/threeqq/nuxt-app/nuxt.config.ts~"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: reading from normalized path "project/sessions/threeqq/nuxt-app/nuxt.config.ts~"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/threeqq/nuxt-app/nuxt.config.ts~"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: successfully read file, path="project/sessions/threeqq/nuxt-app/nuxt.config.ts~", language="text", contentLength=88
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: completed (loading=false)
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: attempting to open "project/sessions/threeqq/nuxt-app/Dockerfile"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: reading from normalized path "project/sessions/threeqq/nuxt-app/Dockerfile"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/threeqq/nuxt-app/Dockerfile"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: successfully read file, path="project/sessions/threeqq/nuxt-app/Dockerfile", language="text", contentLength=1169
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: completed (loading=false)
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: attempting to open "project/sessions/threeqq/nuxt-app/docker-compose.yml"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: reading from normalized path "project/sessions/threeqq/nuxt-app/docker-compose.yml"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/threeqq/nuxt-app/docker-compose.yml"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: successfully read file, path="project/sessions/threeqq/nuxt-app/docker-compose.yml", language="yaml", contentLength=428
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: completed (loading=false)
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: attempting to open "project/sessions/threeqq/nuxt-app/.dockerignore"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: reading from normalized path "project/sessions/threeqq/nuxt-app/.dockerignore"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/threeqq/nuxt-app/.dockerignore"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: successfully read file, path="project/sessions/threeqq/nuxt-app/.dockerignore", language="text", contentLength=160
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: completed (loading=false)
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: attempting to open "project/sessions/threeqq/nuxt-app/nuxt.config.ts"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: reading from normalized path "project/sessions/threeqq/nuxt-app/nuxt.config.ts"
forward-logs-shared.ts:95 [useVFS] readFile: OPFS cache hit for "project/sessions/threeqq/nuxt-app/nuxt.config.ts"
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: successfully read file, path="project/sessions/threeqq/nuxt-app/nuxt.config.ts", language="typescript", contentLength=718
forward-logs-shared.ts:95 [CodePreviewPanel] selectFilesystemFile: completed (loading=false)
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project/sessions/threeqq", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [Fast Refresh] done in 658ms
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [useVFS] request: response status=200
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [Fast Refresh] done in 222ms
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache hit for "project/sessions/threeqq" (fresh: true)
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [Fast Refresh] done in 91ms
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project/sessions/threeqq", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [Fast Refresh] done in 45ms
forward-logs-shared.ts:95 [useVFS] request: response status=200
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache hit for "project/sessions/threeqq" (fresh: true)
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [Fast Refresh] done in 29ms
:3000/api/gateway/git/session-anon_1773812142026_3DjpUhFgH/versions?limit=20:1  Failed to load resource: the server responded with a status of 404 (Not Found)Understand this error
intercept-console-error.ts:42 Failed to fetch version history: Error: Failed to fetch versions
    at VersionHistoryPanel.useCallback[fetchVersions] (version-history-panel.tsx:51:31)
error @ intercept-console-error.ts:42Understand this error
:3000/api/chat:1  Failed to load resource: the server responded with a status of 400 (Bad Request)Understand this error
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project
forward-logs-shared.ts:95 [Fast Refresh] done in 402ms
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache hit for "project" (fresh: true)
forward-logs-shared.ts:95 [Fast Refresh] done in 365ms
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/threeqq/nuxt-app/components" -> "project/sessions/threeqq/nuxt-app/components"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq/nuxt-app/components"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq%2Fnuxt-app%2Fcomponents
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq/nuxt-app/components", 3 entries
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 1 entries
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 0
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Clipboard copy failed, using fallback: NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Write permission denied.
warn @ forward-logs-shared.ts:95Understand this warning
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 45
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 89
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 120
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 157
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 194
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 225
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 261
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 296
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 334
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 365
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 405
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 444
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 477
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 517
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 551
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 582
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Content Processing Debug - assistant
forward-logs-shared.ts:95 Context: Object
forward-logs-shared.ts:95 Content length: 611
forward-logs-shared.ts:95 Result: Object
forward-logs-shared.ts:95 Streaming session display-assistant-1773814250624-1773814250655 completed
forward-logs-shared.ts:95 [useVFS WARN] OPFS not supported in this browser - using server-only mode
warn @ forward-logs-shared.ts:95Understand this warning
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [CodePreviewPanel] [autoLoadPreview] panel opened, checking if preview should load
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project/sessions/threeqq", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
forward-logs-shared.ts:95 [useVFS WARN] OPFS not supported in this browser - using server-only mode
warn @ forward-logs-shared.ts:95Understand this warning
forward-logs-shared.ts:95 [useVFS] getSnapshot: joining in-flight request for "project/sessions/threeqq"
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] registered filesystem-updated event listener
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 1 entries
forward-logs-shared.ts:95 [useVFS] request: response status=200
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [CodePreviewPanel] [Sandpack] Normalized 12 -> 12 (filtered) -> 12 (scope strip)
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 1 entries
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq", 1 entries
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/threeqq/nuxt-app" -> "project/sessions/threeqq/nuxt-app"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq/nuxt-app"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq%2Fnuxt-app
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq/nuxt-app", 10 entries
forward-logs-shared.ts:95 [CodePreviewPanel] openFilesystemDirectory: "project/sessions/threeqq/nuxt-app/public" -> "project/sessions/threeqq/nuxt-app/public"
forward-logs-shared.ts:95 [useVFS] listDirectory: loading "project/sessions/threeqq/nuxt-app/public"
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/list?path=project%2Fsessions%2Fthreeqq%2Fnuxt-app%2Fpublic
2forward-logs-shared.ts:95 [CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"
forward-logs-shared.ts:95 [useVFS] request: response status=200
forward-logs-shared.ts:95 [useVFS] listDirectory: loaded "project/sessions/threeqq/nuxt-app/public", 1 entries
forward-logs-shared.ts:95 [CodePreviewPanel] [CodePreviewPanel] removed filesystem-updated event listener
forward-logs-shared.ts:95 [Fast Refresh] rebuilding
forward-logs-shared.ts:95 [useVFS] getSnapshot: cache miss for "project", fetching from API
forward-logs-shared.ts:95 [useVFS] request: GET /api/filesystem/snapshot?path=project
forward-logs-shared.ts:95 [Fast Refresh] done in 275ms
forward-logs-shared.ts:95 [useVFS] request: response status=200
headless?version=1.6.1:1 The resource https://w-corp-staticblitz.com/fetch.worker.8669d46c.js was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally.


--------------------------




Bug 1 — VFS doesn't write diffs on edit requests (Request 3: your main issue)
Root cause: In response-router.ts, extractCommands() only parses content that contains the literal sentinel string === COMMANDS_START === / === COMMANDS_END ===. When the LLM responds to your edit request, it writes free-form markdown code blocks — not the structured command block format. So commands comes back as undefined and hasFilesystemEdits in the stream is false.
Proof in the log:
Request 1 stream: { eventsCount: 6, hasFilesystemEdits: true } — works because initial generation triggered VFS writes
Request 3 stream: { eventsCount: 3, hasFilesystemEdits: true } on the initial path but then the actual content stream: { eventsCount: 245, hasFilesystemEdits: false } — 245 chunks, zero edits written
The model is clearly outputting markdown code blocks, but because they're not inside the COMMANDS_START/COMMANDS_END sentinel block, extractCommands() returns undefined. The write_diffs array is never populated. Nothing ever calls writeFilesystemFile.
Fix: You need to either (a) reliably instruct the model to use the command block format in your system prompt, or (b) add a fallback parser in extractCommands() that detects raw code blocks with filenames (```tsx path/to/file.tsx) and promotes them into write_diffs entries.

Bug 2 — Confirmation components never show because polledDiffs/commandsByFile are never populated
Root cause: The confirmation UI in code-preview-panel.tsx (the "Pending Diffs" and "Polled Changes" panels at lines 5236–5373) only renders when pendingFiles.length > 0 or polledDiffs && polledDiffs.length > 0. pendingFiles is derived from commandsByFile prop, and polledDiffs comes from a useDiffsPoller hook — both of which are upstream of the panel. Since Bug 1 means commands.write_diffs is always empty, the streaming event that would populate commandsByFile is never emitted, so both arrays stay empty and the confirmation UI never renders.

Bug 3 — VFS commit logs "0 files" on every write
Root cause in logs:
[GitVFS] Committed 0 files: Write project/sessions/onecm/package.json

Every GitVFS commit reports 0 files committed. This means files are buffered but the flush/commit is not gathering them. This is likely because the batch is flushed immediately after a single Buffered change, so the commit window closes before other changes accumulate — it's committing an empty delta. The VFS API itself returns 200 OK, so data does persist, but the git-layer versioning is broken. This is why GET /api/gateway/git/session-.../versions?limit=20 always returns 404 — there are no committed versions.

Bug 4 — Stale snapshot cache never invalidated during edit flow
The log shows:
[VFS SNAPSHOT WARN] STALE SNAPSHOT: last updated 555s ago
[VFS SNAPSHOT WARN] STALE SNAPSHOT: last updated 723s ago

After Request 3's edits (even the ones that do write), the snapshot cache is served stale for minutes. The CodePreviewPanel reads the snapshot to drive Sandpack and visualEditorProjectData — so even if writes did occur, the preview would show old data. The cache invalidation is not being triggered by write events. You need emitFilesystemUpdated in your write path to bust the snapshot cache, or lower the cache TTL.

Bug 5 — Polling storm after every response
[VFS LIST WARN] POLLING DETECTED: 4 requests in 222ms for path "project/sessions/onecm"
[VFS LIST WARN] POLLING DETECTED: 5 requests in 1978ms for path "project/sessions/onecm"

The filesystem list endpoint is being hit 4–5 times in rapid succession after every message. Something is triggering listFilesystemDirectory in a feedback loop — likely multiple useEffect hooks depending on overlapping state, each triggering a re-render that re-fires the effect. This creates unnecessary server load and compounds the cache staleness issue.

Bug 6 — Nuxt app: wrong entryFile selected, wrong preview mode
Root cause in logs:
[CodePreviewPanel] [visualEditorProjectData] bundler="vite", entryFile="nuxt-app/.dockerignore", previewModeHint="vite"

The entryFile is .dockerignore — a non-code file. This happens because in buildProjectStructure(), the entryCandidates list (line 1944) doesn't include any Nuxt-specific entry points (app.vue, nuxt.config.ts), and the fallback || Object.keys(files)[0] picks whichever key happens to sort first — which is .dockerignore.
With .dockerignore as the entry, Sandpack has no idea what to bundle. The previewModeHint="vite" is also wrong — Nuxt uses its own runtime, not plain Vite, and Sandpack cannot bundle a Nuxt app at all.
Fix: Add app.vue, nuxt.config.ts, pages/index.vue to entryCandidates. More importantly, when framework detection returns "nuxt", the preview path should route to "codesandbox" or "devbox" mode, not Sandpack/Vite — Nuxt requires a real Node.js runtime.

Bug 7 — CodeSandbox detection never triggers for Docker projects
The livePreviewOffloading.detectProject() function doesn't appear to inspect for Dockerfile or docker-compose.yml presence and route to "codesandbox" mode. So a Docker-based Nuxt project falls through to the Vite/Sandpack path, which cannot run it. You need to add a Docker detection branch that sets previewMode = "codesandbox" (or "devbox").

Bug 8 — write_diffs diff parser is fragile
Even when the command block format IS used, the regex at line 964:
const diffsMatch = block.match(/write_diffs:\s*\[([\s\S]*?)\]/)

uses a non-greedy *? on [\s\S] which will cut off at the first ] encountered inside a diff string (very common in code — e.g. array literals, JSX closing tags). This means diffs containing ] in their content will be silently truncated.

Bug 9 — hasFilesystemEdits: true on Request 2 but only 3 events
Request 2 log:
Starting streaming response { eventsCount: 3, hasFilesystemEdits: true }
Stream completed successfully { chunkCount: 3, latencyMs: 121, eventsCount: 3 }

Only 3 events for a response with hasFilesystemEdits: true — 3 events is the bare minimum (start, content, end). There are no actual filesystem write events in this stream. This suggests the hasFilesystemEdits flag is being set based on detecting code blocks in the content (incorrectly), not on whether writes were actually queued.

Summary Table
#
Bug
Location
Symptom
1
LLM edit responses not parsed into write_diffs
response-router.ts extractCommands()
Edits never written to VFS
2
Confirmation UI never renders
code-preview-panel.tsx + upstream prop chain
No confirm/deny for edits
3
GitVFS commits 0 files
GitVFS flush logic
Git versioning broken, 404 on versions endpoint
4
Snapshot cache not invalidated after writes
VFS snapshot layer
Preview shows stale files
5
Polling storm on every response
Multiple useEffect in panel
Unnecessary load, compounds staleness
6
Wrong entryFile and preview mode for Nuxt
buildProjectStructure() entry candidate list
Sandpack gets .dockerignore as entry
7
Docker/Nuxt not routed to cloud preview
livePreviewOffloading.detectProject()
Sandpack tries to bundle un-bundleable app
8
write_diffs regex cuts off at first ]
extractCommands() line ~964
Diffs with arrays silently truncated
9
hasFilesystemEdits: true set incorrectly
Streaming event builder
False positive, misleading logs




