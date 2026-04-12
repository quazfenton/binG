const localWorkspaceDir = `${tempDir}\\workspace\\users\\${userId}\\sessions\\${convId}`;
      3 const promptFile = `${tempDir}\\opencode-v2-prompt-${Date.now()}.json`;
      4
      5 // Write prompt
      6 await this.writeLocalFile(promptFile, JSON.stringify({
      7   prompt: userMessage,
      8   tools: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
      9   systemPrompt,
     10   sessionId: this.currentSession.id,
     11   mcpServerUrl: this.currentSession.mcpServerUrl,
     12 }));
     13
     14 // Execute locally (NO sandbox)
     15 const command = `cmd /c "type ${promptFile} | npx opencode chat --json ${modelFlag}"`;
     16 const result = await this.executeLocalCommand(command, localWorkspaceDir, timeout);

    NDJSON Parsing:

      1 const lines = result.output.split('\n').filter(Boolean);
      2
      3 for (const line of lines) {
      4   const parsed = JSON.parse(line);
      5
      6   // Text response
      7   if (parsed.text) {
      8     finalResponse += parsed.text;
      9     onStreamChunk?.(parsed.text);
     10   }
     11
     12   // Tool invocation
     13   if (parsed.tool || parsed.name) {
     14     const toolName = parsed.tool || parsed.name;
     15     const toolArgs = parsed.args || {};
     16     const toolResult = await executeTool(toolName, toolArgs);
     17     onToolExecution?.(toolName, toolArgs, toolResult);
     18   }
     19
     20   // Completion
     21   if (parsed.done || parsed.complete) {
     22     finalResponse = parsed.response ?? parsed.text ?? finalResponse;
     23   }
     24 }

    ---

    5. lib/sandbox/providers/index.ts

    Purpose: Central registry for all sandbox providers with lazy initialization

    Provider Registry:

      1 const providerRegistry = new Map<SandboxProviderType, ProviderEntry>();
      2
      3 providerRegistry.set('daytona', {
      4   provider: null,
      5   priority: 1,  // Highest priority (default)
      6   enabled: true,
      7   available: false,
      8   healthy: false,
      9   asyncFactory: async () => {
     10     const { DaytonaProvider } = await import('./daytona-provider');
     11     return new DaytonaProvider();
     12   },
     13 });
     14
     15 providerRegistry.set('e2b', { priority: 2, ... });
     16 providerRegistry.set('sprites', { priority: 6, ... });
     17 providerRegistry.set('codesandbox', { priority: 7, ... });
     18 // ... 15+ providers total

    Provider Selection:

      1 export async function getSandboxProvider(type?: SandboxProviderType): Promise<SandboxProvider> {
      2   const providerType = type || (process.env.SANDBOX_PROVIDER as SandboxProviderType) || 'daytona';
      3
      4   // 1. Check circuit breaker
      5   if (!circuitBreaker.canExecute()) {
      6     throw new Error(`Provider ${providerType} unavailable (circuit breaker ${state})`);
      7   }
      8
      9   // 2. Check health checker
     10   if (healthStatus && !healthStatus.healthy && consecutiveFailures >= 3) {
     11     throw new Error(`Provider ${providerType} is unhealthy`);
     12   }
     13
     14   // 3. Return if already initialized
     15   if (entry.provider && entry.healthy) {
     16     return entry.provider;
     17   }
     18
     19   // 4. Initialize with retry (3 attempts, exponential backoff)
     20   for (let attempt = 1; attempt <= 3; attempt++) {
     21     try {
     22       entry.provider = await entry.asyncFactory();
     23       entry.healthy = true;
     24       return entry.provider;
     25     } catch (error) {
     26       await delay(Math.pow(2, attempt) * 100);  // 200ms, 400ms, 800ms
     27     }
     28   }
     29
     30   throw new Error(`Failed to initialize ${providerType} after 3 attempts`);
     31 }

    Fallback Chain:

      1 export async function getSandboxProviderWithFallback(
      2   preferredType?: SandboxProviderType,
      3 ): Promise<{ provider: SandboxProvider; type: SandboxProviderType }> {
      4   // Build ordered list: preferred first, then by priority
      5   const ordered = [preferredType, ...sortedByPriority].filter(Boolean);
      6
      7   for (const providerType of ordered) {
      8     // Skip if circuit breaker OPEN
      9     if (!providerCircuitBreakers.isAvailable(providerType)) {
     10       continue;
     11     }
     12
     13     try {
     14       const provider = await getSandboxProvider(providerType);
     15       return { provider, type: providerType };
     16     } catch (error) {
     17       errors.push(`${providerType}: ${error.message}`);
     18     }
     19   }
     20
     21   throw new Error(`All providers failed:\n${errors.join('\n')}`);
     22 }

    ---

    6. lib/sandbox/provider-router.ts

    Purpose: Intelligent provider selection based on task type and requirements

    Task Types:

      1 type TaskType =
      2   | 'code-interpreter'    // Python/Node.js execution
      3   | 'agent'               // Autonomous AI agent (AMP, Codex)
      4   | 'fullstack-app'       // Full-stack application
      5   | 'frontend-app'        // Frontend-only (React, Vue)
      6   | 'batch-job'           // Parallel/batch execution
      7   | 'computer-use'        // Desktop automation
      8   | 'lsp-intelligence'    // Code completion, hover
      9   | 'persistent-service'  // Long-running with state
     10   | 'ci-cd'               // Testing, CI/CD
     11   | 'ml-training'         // GPU optional
     12   | 'general';

    Provider Profiles:

      1 const PROVIDER_PROFILES: ProviderProfile[] = [
      2   {
      3     type: 'e2b',
      4     services: ['pty', 'preview', 'agent', 'desktop'],
      5     bestFor: ['code-interpreter', 'agent', 'ml-training'],
      6     costTier: 'medium',
      7     latencyTier: 'low',
      8     persistenceSupport: false,
      9   },
     10   {
     11     type: 'daytona',
     12     services: ['pty', 'preview', 'computer-use', 'lsp', 'object-storage'],
     13     bestFor: ['fullstack-app', 'computer-use', 'lsp-intelligence', 'general'],
     14     costTier: 'medium',
     15     latencyTier: 'low',
     16     persistenceSupport: false,
     17   },
     18   {
     19     type: 'sprites',
     20     services: ['pty', 'preview', 'snapshot', 'persistent-fs', 'auto-suspend', 'services'],
     21     bestFor: ['persistent-service', 'fullstack-app', 'general'],
     22     costTier: 'low',
     23     latencyTier: 'medium',
     24     persistenceSupport: true,  // ✓ Has persistence
     25   },
     26   {
     27     type: 'codesandbox',
     28     services: ['pty', 'preview', 'snapshot', 'batch', 'services'],
     29     bestFor: ['frontend-app', 'fullstack-app', 'batch-job', 'ci-cd'],
     30     costTier: 'medium',
     31     latencyTier: 'low',
     32     persistenceSupport: true,  // ✓ Has persistence
     33   },
     34 ];

    Selection Algorithm:

      1 private async evaluateProviders(context: TaskContext): Promise<ProviderSelectionResult> {
      2   const scores: Array<{ provider: SandboxProviderType; score: number; reasons: string[] }> = [];
      3
      4   for (const profile of PROVIDER_PROFILES) {
      5     let score = 0;
      6     const reasons: string[] = [];
      7
      8     // Task type match (40 points)
      9     if (profile.bestFor.includes(context.type)) {
     10       score += 40;
     11       reasons.push(`Optimized for ${context.type}`);
     12     }
     13
     14     // Service match (30 points)
     15     if (context.needsServices) {
     16       const matchedServices = context.needsServices.filter(s => profile.services.includes(s));
     17       const matchRatio = matchedServices.length / context.needsServices.length;
     18       score += Math.round(30 * matchRatio);
     19     }
     20
     21     // Persistence requirement (10 points)
     22     if (context.requiresPersistence && profile.persistenceSupport) {
     23       score += 10;
     24       reasons.push('Supports persistence');
     25     }
     26
     27     // Quota check (soft penalty)
     28     const quotaCheck = quotaManager.checkQuota(profile.type);
     29     if (!quotaCheck.allowed) {
     30       score -= 20;
     31       reasons.push('Quota exceeded (will fallback)');
     32     }
     33
     34     scores.push({ provider: profile.type, score, reasons });
     35   }
     36
     37   // Sort by score, return top provider
     38   scores.sort((a, b) => b.score - a.score);
     39   return { provider: scores[0].provider, confidence: score / 100, ... };
     40 }

   
      Provider Priority Chain
        - daytona (priority 1) → Default, best for general use
        - e2b (priority 2) → Best for agents (AMP/Codex)
        - sprites (priority 6) → Best for persistence
        - codesandbox (priority 7) → Best for batch jobs

     3. Circuit Breaker Protection
        - Tracks consecutive failures per provider
        - Opens circuit after 5 failures in 1 minute
        - Attempts recovery after 30 seconds
        - Prevents cascading failures

     4. Health Checker Integration
        - Background health monitoring
        - Skips unhealthy providers (3+ consecutive failures)
        - Automatic recovery when health restored

     5. Quota Management
        - quotaManager.checkQuota(provider) before selection
        - Soft penalty in scoring  (doesn't disqualify)
        - Prevents quota exhaustion



───────────────────────────────────────────────────────────────────────────┐
       2 │                            USER REQUEST                                      │
       3 │                    /api/chat or /api/agent                                   │
       4 └────────────────────────────────┬────────────────────────────────────────────┘
       5                                  │
       6                                  ▼
       7 ┌─────────────────────────────────────────────────────────────────────────────┐
       8 │                         V2 EXECUTOR                                           │
       9 │                    (lib/agent/v2-executor.ts)                                 │
      10 │                                                                               │
      11 │  - Sends immediate 'init' SSE event                                          │
      12 │  - Routes to OpenCode (default) or Nullclaw (explicit)                       │
      13 │  - Streams: token, tool_invocation, step, filesystem, diffs, done            │
      14 └────────────────────────────────┬─────────────────────────────────────────────┘
      15                                  │
      16                 ┌────────────────┴────────────────┐
      17                 │                                 │
      18                 ▼                                 ▼
      19     ┌─────────────────────┐           ┌─────────────────────┐
      20     │   TASK ROUTER       │           │   NULLCLAW          │
      21     │ (task-router.ts)    │           │   (messaging/       │
      22     │ - Analyzes task     │           │    browsing/        │
      23     │ - Coding → OpenCode │           │    automation)      │
      24     │ - Messaging →       │           │                     │
      25     │   Nullclaw          │           │                     │
      26     └──────────┬──────────┘           └─────────────────────┘
      27                │
      28                │ preferredAgent: 'opencode' (default)
      29                ▼
      30 ┌─────────────────────────────────────────────────────────────────────────────┐
      31 │                    AGENT SESSION MANAGER                                      │
      32 │              (lib/agent/agent-session-manager.ts)                             │
      33 │                                                                               │
      34 │  Session Configuration:                                                       │
      35 │  - cloudSandbox: true (DEFAULT - local execution)                                │
      36 │  - cloudSandbox: false (cloud sandbox for risky code/terminal/possible spawns of other CLI agents like Codex)                   │
      37 │                                                                               │
      38 │  Workspace: /workspace/users/{userId}/sessions/{conversationId}               │
      39 │  TTL: 30 minutes idle timeout                                                 │
      40 │  Cleanup: Every 5 minutes                                                     │
      41 └──────────┬────────────────────────────────────────────────────────────────────┘
      42            │
      43            ├──────────────────────────────────────────┐
      44            │                                          │
      45            │ cloudSandbox: false (DEFAULT)                │ cloudSandbox: true
      46            │ OpenCode runs normally                    │ Cloud sandbox created
      47            │                                          │ via getSandboxProvider()
      48            ▼                                          ▼
      49 ┌─────────────────────────────────┐     ┌─────────────────────────────────────┐
      50 │   OPENCODE V2 PROVIDER          │     │   SANDBOX PROVIDER                  │
      51 │   (opencode-v2-provider.ts)     │     │   (providers/index.ts)              │
      52 │    communicates with opencode which                             │     │                                     │
      53 │ runs as worker index.ts in a  
         Docker container +  REDIS url

         EXECUTION service               │     │ Provider Chain:                     │
      54 │ - Windows:                      │     │ 1. daytona (priority 1)             │
      55 │   C:\temp\workspace\…  │     │ 2. e2b (priority 2)                 │
      56 │ - Linux:                        │     │ 3. sprites (priority 6)             │
      57 │   /home/user/workspace/…        │     │ 4. codesandbox (priority 7)         │
      58 │ - Command:                      │     │ ... (15+ providers)                 │
      59 │   this.process = ... ? 'cmd' : 'sh',
       args, {
        cwd: this.config.workspaceDir,
        env: {
                │     │                                     │
      60 │                                 │     │ Circuit Breaker Protection          │
      61 │ NDJSON Parsing:                 │     │ Health Checker Integration          │
      62 │ - text → stream to client       │     │ Quota Management                    │
      63 │ - tool → execute via MCP        │     └──────────────┬──────────────────────┘
      64 │ - done → final response         │                    │
      65 └──────────┬──────────────────────┘                    │
      66            │                                           │
      67            │         ┌─────────────────────────────────┘
      68            │         │
      69            ▼         ▼
      70 ┌──────────────────────────────────────────────────────────────────────────────┐
      71 │                         MCP TOOLS (localhost:8888)                            │
      72 │               (lib/mcp/architecture-integration.ts)                           │
      73 │                                                                               │
      74 │  - filesystem_*  → File read/write/edit/delete                               │
      75 │  - memory_*      → Entity/relation/observation management                     │
      76 │  - nullclaw_*    → Discord, Telegram, browse, automate, external agency                        │
      77 │  - blaxel_*      → Code search, file discovery                                │
      78 │  - arcade_*      → 1000+ pre-built tools with OAuth                           │
      79 │  - e2b_*, daytona_*, sprites_* → Cloud sandbox operations                    │
      80 └──────────────────────────────────────────────────────────────────────────────┘
      81            │
      82            │ Heavy Preview Requests
      83            ▼
      84 ┌──────────────────────────────────────────────────────────────────────────────┐
      85 │                      PREVIEW OFFLOADER                                        │
      86 │                 (lib/sandbox/preview-offloader.ts)                            │
      87 │                                                                               │
      88 │  Decision Tree:                                                               │
      89 │  - GUI indicators → Daytona (desktop environment)                             │
      90 │  - Heavy framework + large project → Daytona                                  │
      91 │  - Heavy framework only → Daytona                                             │
      92 │  - Large project (>50 files) → Daytona                                        │
      93 │  - Default → Local Sandpack                                                   │
      94 │                                                                               │
      95 │  Providers:                                                                   │
      96 │  - local: Sandpack (lightweight)                                              │
      97 │  - daytona: Full desktop, GUI apps, recordings                                │
      98 │  - codesandbox: Batch jobs, parallel testing                                  │
      99 │  - vercel: Production deployments (TODO)                                      │
     100 └──────────────────────────────────────────────────────────────────────────────┘
     101            │
     102            │ Resource Monitoring
     103            ▼
     104 ┌──────────────────────────────────────────────────────────────────────────────┐
     105 │                      RESOURCE MONITOR                                         │
     106 │                (lib/sandbox/resource-monitor.ts)                              │
     107 │                                                                               │
     108 │  Metrics Collected:                                                           │
     109 │  - CPU usage (%)                                                              │
     110 │  - Memory usage (MB)                                                          │
     111 │  - Disk usage (MB)                                                            │
     112 │  - Network bytes sent/received                                                │
     113 │                                                                               │
     114 │  Alerts:                                                                      │
     115 │  - CPU warning: >70%, critical: >90%                                          │
     116 │  - Memory warning: >70%, critical: >90%                                       │
     117 │                                                                               │
     118 │  Scaling Recommendations:                                                     │
     119 │  - scale_up: avg CPU >80% or memory >80%                                      │
     120 │  - scale_down: avg CPU <20% and memory <20%                                   │
     121 │  - no_change: normal range                                                    │
     122 └──────────────────────────────────────────────────────────────────────────────┘

    ---

    File-by-File Deep Dive

    ---

    1. lib/agent/task-router.ts

    Purpose: Intelligent task routing between OpenCode and Nullclaw agents

    Task Type Detection:

      1 // Keyword-based scoring system
      2 private readonly CODING_KEYWORDS = [
      3   'code', 'program', 'function', 'class', 'variable', 'import', 'export',
      4   'file', 'directory', 'bash', 'shell', 'command', 'terminal',
      5   'npm', 'pnpm', 'yarn', 'pip', 'typescript', 'javascript', 'python',
      6   'api', 'endpoint', 'route', 'server', 'database', 'query', 'schema',
      7 ];
      8
      9 private readonly MESSAGING_KEYWORDS = [
     10   'discord', 'telegram', 'slack', 'message', 'send', 'chat', 'notify',
     11   'channel', 'user', 'bot', 'webhook', 'mention', 'ping',
     12 ];
     13
     14 private readonly BROWSING_KEYWORDS = [
     15   'browse', 'website', 'url', 'http', 'https', 'scrape', 'crawl',
     16   'fetch', 'download', 'webpage', 'search', 'google',
     17 ];
     18
     19 private readonly AUTOMATION_KEYWORDS = [
     20   'automate', 'schedule', 'cron', 'repeat', 'daily', 'hourly',
     21   'server', 'deploy', 'restart', 'backup', 'monitor', 'alert',
     22 ];

    Routing Logic:

      1 analyzeTask(task: string): TaskRoutingResult {
      2   const scores = {
      3     coding: this.scoreKeywords(task, CODING_KEYWORDS),
      4     messaging: this.scoreKeywords(task, MESSAGING_KEYWORDS),
      5     browsing: this.scoreKeywords(task, BROWSING_KEYWORDS),
      6     automation: this.scoreKeywords(task, AUTOMATION_KEYWORDS),
      7   };
      8
      9   // Find highest scoring category
     10   const maxScore = Math.max(...Object.values(scores));
     11   const primaryType = Object.entries(scores)
     12     .find(([_, score]) => score === maxScore)?.[0] as TaskType || 'unknown';
     13
     14   // Determine target agent
     15   if (primaryType === 'coding') {
     16     target = 'opencode';
     17     reasoning = 'Task involves coding, file operations, or shell commands';
     18   } else if (primaryType === 'messaging' || primaryType === 'browsing') {
     19     target = 'nullclaw';
     20     reasoning = `Task involves ${primaryType} which requires external API access`;
     21   } else if (primaryType === 'automation') {
     22     // Automation with coding → OpenCode, otherwise → Nullclaw
     23     if (scores.coding > 0) {
     24       target = 'opencode';
     25       reasoning = 'Automation task with coding components';
     26     } else {
     27       target = 'nullclaw';
     28       reasoning = 'Automation task requiring external services';
     29     }
     30   } else {
     31     target = 'opencode';  // Default
     32     reasoning = 'Unknown task type, defaulting to coding agent';
     33   }
     34
     35   return { type: primaryType, confidence, target, reasoning };
     36 }

    Execution Flow:

      1 async executeTask(request: TaskRequest): Promise<any> {
      2   // Check for explicit agent preference
      3   if (request.preferredAgent) {
      4     routing = { target: request.preferredAgent, ... };
      5   } else {
      6     routing = this.analyzeTask(request.task);
      7   }
      8
      9   if (routing.target === 'opencode') {
     10     return this.executeWithOpenCode(request);
     11   } else if (routing.target === 'nullclaw') {
     12     return this.executeWithNullclaw(request, routing.type);
     13   } else {
     14     return this.executeWithCliAgent(request);
     15   }
     16 }

    OpenCode Execution (V2):

      1 private async executeWithOpenCode(request: TaskRequest): Promise<any> {
      2   // Check if V2 is enabled
      3   const useV2 = process.env.OPENCODE_CONTAINERIZED === 'true' ||
      4                 process.env.V2_AGENT_ENABLED === 'true';
      5
      6   if (!useV2) {
      7     // Fallback to local OpenCode engine (deprecated)
      8     const engine = createOpenCodeEngine({ ... });
      9     return engine.execute(request.task);
     10   }
     11
     12   // V2 execution with noSandbox: true (local execution)
     13   const session = await agentSessionManager.getOrCreateSession(
     14     request.userId,
     15     request.conversationId,
     16     { enableMCP: true, enableNullclaw: true, mode: 'hybrid', noSandbox: true },
     17   );
     18
     19   const provider = new OpencodeV2Provider({ session, sandboxHandle: session.sandboxHandle });
     20   const tools = await getMCPToolsForAI_SDK(request.userId);
     21
     22   const result = await provider.runAgentLoop({
     23     userMessage: request.task,
     24     tools: tools.map(t => ({ name: t.function.name, ... })),
     25     systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
     26     maxSteps: parseInt(process.env.OPENCODE_MAX_STEPS || '15', 10),
     27     onStreamChunk: request.onStreamChunk,
     28     onToolExecution: request.onToolExecution,
     29     executeTool: async (name, args) => {
     30       return callMCPToolFromAI_SDK(name, args, request.userId);
     31     },
     32   });
     33
     34   // Extract file changes from steps
     35   const fileChanges = [];
     36   for (const step of result.steps) {
     37     if (['write_file', 'read_file', 'delete_file', 'edit_file', 'Bash'].includes(step.toolName)) {
     38       fileChanges.push({ path: step.args.path, action: 'modify', operation: 'write' });
     39     }
     40   }
     41
     42   return {
     43     success: true,
     44     response: result.response,
     45     steps: result.steps,
     46     fileChanges,
     47     agent: 'opencode',
     48   };
     49 }

    ---

    2. lib/sandbox/preview-offloader.ts

    Purpose: Routes heavy preview requests to cloud providers

    Decision Tree:

      1 const HEAVY_FRAMEWORKS = [
      2   'next', 'next.js', 'nuxt', 'nuxt.js', 'remix',
      3   'django', 'flask', 'fastapi', 'rails', 'laravel',
      4   'nest', 'express-server', 'koa',
      5 ];
      6
      7 const GUI_INDICATORS = [
      8   'electron', 'tauri', 'nw.js', 'neutralino',
      9   '.desktop', 'gtk', 'qt', 'wingui',
     10 ];
     11
     12 const LARGE_PROJECT_THRESHOLD = {
     13   files: 50,
     14   nodeModulesMB: 5,
     15 };
     16
     17 decide(request: PreviewRequest): PreviewDecision {
     18   const { files, framework, dependencies = {} } = request;
     19   const fileCount = Object.keys(files).length;
     20   const frameworkLower = (framework || '').toLowerCase();
     21
     22   const isHeavyFramework = HEAVY_FRAMEWORKS.some(f => frameworkLower.includes(f));
     23   const isGUI = GUI_INDICATORS.some(g => frameworkLower.includes(g) || Object.keys(files).some(f => f.includes(g)));
     24   const isLargeProject = fileCount > LARGE_PROJECT_THRESHOLD.files;
     25
     26   // Decision logic
     27   if (isGUI) {
     28     return {
     29       recommendedProvider: 'daytona',
     30       reason: 'GUI/Desktop application detected - requires full desktop environment',
     31       estimatedCost: 0.05,  // $0.05/min
     32       estimatedDuration: 60,
     33     };
     34   }
     35
     36   if (isHeavyFramework && isLargeProject) {
     37     return {
     38       recommendedProvider: 'daytona',
     39       reason: `Heavy framework (${framework}) with large project detected`,
     40       estimatedCost: 0.05,
     41       estimatedDuration: 120,
     42     };
     43   }
     44
     45   if (isHeavyFramework) {
     46     return {
     47       recommendedProvider: 'daytona',
     48       reason: `Heavy framework (${framework}) requires backend services`,
     49       estimatedCost: 0.03,
     50       estimatedDuration: 60,
     51     };
     52   }
     53
     54   if (isLargeProject) {
     55     return {
     56       recommendedProvider: 'daytona',
     57       reason: `Large project (${fileCount} files) exceeds local preview capacity`,
     58       estimatedCost: 0.02,
     59       estimatedDuration: 45,
     60     };
     61   }
     62
     63   // Default to local Sandpack
     64   return {
     65     recommendedProvider: 'local',
     66     reason: 'Lightweight application suitable for local Sandpack preview',
     67     estimatedCost: 0,
     68     estimatedDuration: 5,
     69   };
     70 }

    Provider Execution:

      1 async execute(request: PreviewRequest): Promise<PreviewResult> {
      2   const decision = this.decide(request);
      3   const startTime = Date.now();
      4
      5   switch (decision.recommendedProvider) {
      6     case 'daytona':
      7       return this.executeDaytona(request, startTime);
      8     case 'codesandbox':
      9       return this.executeCodeSandbox(request, startTime);
     10     case 'vercel':
     11       return this.executeVercel(request, startTime);  // TODO
     12     default:
     13       return { success: true, provider: 'local', url: undefined };
     14   }
     15 }
     16
     17 private async executeDaytona(request: PreviewRequest, startTime: number): Promise<PreviewResult> {
     18   const provider = await getSandboxProvider('daytona');
     19   const handle = await provider.createSandbox({ language: 'typescript', envVars: request.envVars });
     20
     21   // Write files
     22   for (const [path, content] of Object.entries(request.files)) {
     23     await handle.writeFile(path, content);
     24   }
     25
     26   // Install dependencies
     27   if (request.dependencies && Object.keys(request.dependencies).length > 0) {
     28     const deps = Object.entries(request.dependencies)
     29       .map(([name, version]) => `${name}@${version}`)
     30       .join(' ');
     31     await handle.executeCommand(`npm install ${deps}`);
     32   }
     33
     34   // Start preview server
     35   const entryPoint = request.entryPoint || 'npm run dev';
     36   await handle.executeCommand(entryPoint);
     37
     38   // Get preview URL
     39   const previewInfo = await handle.getPreviewLink?.(3000);
     40
     41   return {
     42     success: true,
     43     provider: 'daytona',
     44     url: previewInfo?.url,
     45     metadata: { sandboxId: handle.id, duration: Date.now() - startTime },
     46   };
     47 }

    Cost Estimation:

     1 getCostEstimate(provider: 'daytona' | 'codesandbox' | 'vercel', durationMinutes: number): number {
     2   const rates: Record<string, number> = {
     3     daytona: 0.05,      // $0.05/min
     4     codesandbox: 0.02,  // $0.02/min
     5     vercel: 0.01,       // $0.01/min (serverless)
     6   };
     7   return (rates[provider] || 0) * durationMinutes;
     8 }

    ---

    3. lib/sandbox/resource-monitor.ts

    Purpose: Real-time sandbox resource monitoring with alerts and scaling recommendations

    Metrics Collection:

      1 interface ResourceMetrics {
      2   sandboxId: string;
      3   cpuUsage: number;        // 0-100%
      4   memoryUsage: number;     // MB
      5   memoryLimit: number;     // MB
      6   diskUsage: number;       // MB
      7   diskLimit: number;       // MB
      8   networkSent: number;     // bytes
      9   networkReceived: number; // bytes
     10   timestamp: number;
     11 }

    Provider Integration - Actual Metric Collection:

      1 private async collectMetricsFromSandbox(sandbox: any): Promise<ResourceMetrics> {
      2   const workspaceDir = sandbox.workspaceDir || '/workspace';
      3   const timestamp = Date.now();
      4
      5   // CPU usage from top
      6   const cpuResult = await sandbox.executeCommand(
      7     "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1",
      8     workspaceDir,
      9     5000
     10   );
     11   const cpuUsage = parseFloat(cpuResult.output.trim()) || 0;
     12
     13   // Memory usage from free
     14   const memResult = await sandbox.executeCommand(
     15     "free -m | grep Mem | awk '{print $3, $2}'",
     16     workspaceDir,
     17     5000
     18   );
     19   const [used, total] = memResult.output.trim().split(/\s+/).map(Number);
     20   const memoryUsage = used || 0;
     21   const memoryLimit = total || 2048;
     22
     23   // Disk usage from df
     24   const diskResult = await sandbox.executeCommand(
     25     `df -m ${workspaceDir} | tail -1 | awk '{print $3, $2}'`,
     26     workspaceDir,
     27     5000
     28   );
     29   const [diskUsed, diskTotal] = diskResult.output.trim().split(/\s+/).map(Number);
     30   const diskUsage = diskUsed || 0;
     31   const diskLimit = diskTotal || 10000;
     32
     33   // Network stats from /proc/net/dev
     34   const netResult = await sandbox.executeCommand(
     35     "cat /proc/net/dev | grep eth0 | awk '{print $2, $10}'",
     36     workspaceDir,
     37     5000
     38   );
     39   const [rx, tx] = netResult.output.trim().split(/\s+/).map(Number);
     40   const networkReceived = rx || 0;
     41   const networkSent = tx || 0;
     42
     43   return {
     44     sandboxId: sandbox.id,
     45     cpuUsage,
     46     memoryUsage,
     47     memoryLimit,
     48     diskUsage,
     49     diskLimit,
     50     networkSent,
     51     networkReceived,
     52     timestamp,
     53   };
     54 }

    Threshold Checking & Alerts:

      1 private checkThresholds(metrics: ResourceMetrics): void {
      2   // CPU checks
      3   const cpuPercentage = metrics.cpuUsage;
      4   if (cpuPercentage >= this.config.cpuCriticalThreshold) {  // 90%
      5     this.generateAlert(metrics.sandboxId, 'cpu_high', 'critical', cpuPercentage, 90);
      6   } else if (cpuPercentage >= this.config.cpuWarningThreshold) {  // 70%
      7     this.generateAlert(metrics.sandboxId, 'cpu_high', 'warning', cpuPercentage, 70);
      8   }
      9
     10   // Memory checks
     11   const memoryPercentage = (metrics.memoryUsage / metrics.memoryLimit) * 100;
     12   if (memoryPercentage >= this.config.memoryCriticalThreshold) {  // 90%
     13     this.generateAlert(metrics.sandboxId, 'memory_high', 'critical', memoryPercentage, 90);
     14   } else if (memoryPercentage >= this.config.memoryWarningThreshold) {  // 70%
     15     this.generateAlert(metrics.sandboxId, 'memory_high', 'warning', memoryPercentage, 70);
     16   }
     17 }
     18
     19 private generateAlert(sandboxId: string, type: AlertType, severity: 'warning' | 'critical', currentValue: number, threshold: number):
        void {
     20   // 1 minute cooldown - don't generate duplicate alerts
     21   const recentAlert = this.alerts.find(
     22     a => a.sandboxId === sandboxId && a.type === type && Date.now() - a.timestamp < 60000
     23   );
     24
     25   if (recentAlert) return;
     26
     27   const alert: ResourceAlert = {
     28     id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
     29     sandboxId,
     30     type,
     31     severity,
     32     currentValue,
     33     threshold,
     34     timestamp: Date.now(),
     35   };
     36
     37   this.alerts.push(alert);
     38   this.emit('alert', alert);  // EventEmitter for real-time notifications
     39 }

    Scaling Recommendations:

      1 getScalingRecommendation(sandboxId: string): ScalingRecommendation {
      2   const metrics = this.getHistoricalMetrics(sandboxId, 300000);  // Last 5 minutes
      3
      4   if (metrics.length === 0) {
      5     return { sandboxId, action: 'no_change', reason: 'No metrics available', confidence: 0 };
      6   }
      7
      8   // Calculate averages
      9   const avgCpu = metrics.reduce((sum, m) => sum + m.cpuUsage, 0) / metrics.length;
     10   const avgMemory = metrics.reduce((sum, m) => sum + m.memoryUsage, 0) / metrics.length;
     11   const avgMemoryPercentage = (avgMemory / metrics[0].memoryLimit) * 100;
     12
     13   // Determine action
     14   let action: 'scale_up' | 'scale_down' | 'no_change' = 'no_change';
     15   let reason = 'Resource usage within normal range';
     16   let recommendedCpu: number | undefined;
     17   let recommendedMemory: number | undefined;
     18
     19   if (avgCpu > 80 || avgMemoryPercentage > 80) {
     20     action = 'scale_up';
     21     reason = `High resource usage: CPU ${avgCpu.toFixed(1)}%, Memory ${avgMemoryPercentage.toFixed(1)}%`;
     22     recommendedCpu = avgCpu > 80 ? 2 : undefined;
     23     recommendedMemory = avgMemoryPercentage > 80 ? 4096 : undefined;
     24     confidence = 0.9;
     25   } else if (avgCpu < 20 && avgMemoryPercentage < 20) {
     26     action = 'scale_down';
     27     reason = `Low resource usage: CPU ${avgCpu.toFixed(1)}%, Memory ${avgMemoryPercentage.toFixed(1)}%`;
     28     recommendedCpu = 0.5;
     29     recommendedMemory = 512;
     30     confidence = 0.7;
     31   }
     32
     33   return { sandboxId, action, reason, recommendedCpu, recommendedMemory, confidence };
     34 }

    Monitoring Lifecycle:

      1 startMonitoring(sandboxId: string, providerType?: SandboxProviderType): void {
      2   // Initialize metrics array
      3   this.metrics.set(sandboxId, []);
      4
      5   // Start monitoring interval (every 5 seconds by default)
      6   const interval = setInterval(() => {
      7     this.collectMetrics(sandboxId);
      8   }, this.config.monitoringInterval);
      9
     10   this.monitoringIntervals.set(sandboxId, interval);
     11   this.emit('monitoring-started', sandboxId);
     12 }
     13
     14 stopMonitoring(sandboxId: string): void {
     15   const interval = this.monitoringIntervals.get(sandboxId);
     16   if (interval) {
     17     clearInterval(interval);
     18     this.monitoringIntervals.delete(sandboxId);
     19     this.emit('monitoring-stopped', sandboxId);
     20   }
     21 }

    ---

    Integration Points

    Task Router → V2 Executor

      1 // In v2-executor.ts
      2 if (options.preferredAgent === 'nullclaw') {
      3   const { taskRouter } = await import('./task-router');
      4   result = await taskRouter.executeTask({
      5     id: `task-${Date.now()}`,
      6     userId: options.userId,
      7     conversationId: options.conversationId,
      8     task: taskWithContext,
      9     stream: false,
     10     preferredAgent: 'nullclaw',
     11   });
     12 } else {
     13   const { runOpenCodeDirect } = await import('./opencode-direct');
     14   result = await runOpenCodeDirect({
     15     userId: options.userId,
     16     conversationId: options.conversationId,
     17     task: taskWithContext,
     18     onChunk: (chunk) => { /* stream to client */ },
     19     onTool: (toolName, args, result) => { /* track tool invocations */ },
     20   });
     21 }

    Preview Offloader → Sandbox Provider

      1 // In preview-offloader.ts
      2 const provider = await getSandboxProvider('daytona');
      3 const handle = await provider.createSandbox({ language: 'typescript' });
      4
      5 // Write files, install deps, start server
      6 for (const [path, content] of Object.entries(request.files)) {
      7   await handle.writeFile(path, content);
      8 }
      9 await handle.executeCommand('npm install');
     10 await handle.executeCommand('npm run dev');
     11
     12 const previewInfo = await handle.getPreviewLink?.(3000);

    Resource Monitor → Sandbox Provider

     1 // In resource-monitor.ts
     2 const provider = await getSandboxProvider(providerType);
     3 const sandbox = await provider.getSandbox(sandboxId);
     4
     5 // Execute monitoring commands inside sandbox
     6 const cpuResult = await sandbox.executeCommand("top -bn1 | grep 'Cpu(s)'...", workspaceDir, 5000);
     7 const memResult = await sandbox.executeCommand("free -m | grep Mem...", workspaceDir, 5000);
     8 const diskResult = await sandbox.executeCommand(`df -m ${workspaceDir}...`, workspaceDir, 5000);

    ---

     1. Lazy Provider Initialization - Providers are initialized on-demand via async factories
     2. Circuit Breaker Protection - Prevents cascading failures when providers are unhealthy
     3. EventEmitter Architecture - Resource monitor emits events for real-time monitoring
     4. Strategy Pattern - Preview offloader selects provider based on task characteristics
     5. Fallback Chain - Multiple fallback levels (V2 → V1 → regular LLM chat)