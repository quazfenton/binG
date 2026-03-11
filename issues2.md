
app/api/sandbox/provider/pty/route.ts
    // Parse request body
    const body = await req.json();
    const { sandboxId, sessionId } = body;

@corridor-security
corridor-security bot
2 hours ago
The endpoint issues provider-specific PTY connection URLs based only on a caller-supplied sandboxId and never validates that the authenticated user owns the referenced sandbox. This enables an authenticated attacker to enumerate/guess another user's sandboxId (e.g., e2b-..., csb-...) and obtain a PTY WebSocket URL to another user's terminal, leading to unauthorized access (IDOR).

Vulnerable flow:

export async function POST(req: NextRequest) {
  // ...
  const body = await req.json();
  const { sandboxId, sessionId } = body;
  // no ownership check here
  const providerType = detectProviderType(sandboxId);
  const ptyInfo = await handleProviderPTYRequest(sandboxId, sessionId, providerType);
  return NextResponse.json(ptyInfo);
}
Impact: High. Exposure of PTY/WebSocket URLs can give interactive shell access to other users’ sandboxes.

Remediation:

Verify sandbox ownership before returning any PTY URL. For example, look up the session by sandboxId and ensure it belongs to authResult.userId (e.g., const session = sandboxBridge.getSessionBySandboxId(sandboxId); if (!session || session.userId !== authResult.userId) return 403;).
Only proceed to detect provider and return URLs after successful ownership validation.
Consider rate limiting and auditing on this endpoint.
For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.

@quazfenton	Reply...
app/api/sandbox/devbox/route.ts
const logger = createLogger('DevBoxAPI');

export const runtime = 'nodejs';

@corridor-security
corridor-security bot
2 hours ago
This endpoint allows anonymous users to create DevBox sandboxes and write arbitrary files without authentication:

const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
const anonymousSessionId = req.headers.get('x-anonymous-session-id') || generateSecureId('anon');
const userId = authResult.userId || `anonymous:${anonymousSessionId}`;
// ... create sandbox and write user-supplied files ...
Any unauthenticated internet user can trigger sandbox creation and resource consumption, which can be abused for DoS or quota exhaustion on your provider. Sandbox creation is a privileged operation and should require authentication and ownership checks, with rate limiting.

Remediation:

Require authentication for DevBox creation (use verifyAuth or resolveRequestAuth without anonymous mode) and enforce ownership.
Add per-user rate limiting.
If anonymous use is explicitly required, tightly constrain it (strict quotas, IP-based throttling, and require a stable, validated anonymous session identifier).
Suggested change
const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.

@quazfenton	Reply...
cubic-dev-ai[bot]
cubic-dev-ai bot reviewed 2 hours ago
Contributor
cubic-dev-ai bot
left a comment
12 issues found across 53 files (changes from recent commits).

Prompt for AI agents (unresolved issues)
Reply with feedback, questions, or to request a fix. Tag @cubic-dev-ai to re-run a review.

lib/virtual-filesystem/refresh-scheduler.ts
  };

  const schedule = (detail?: TDetail) => {
    pendingDetail = detail ?? pendingDetail;
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P1: schedule() calls made during an in-flight run are lost when no detail is provided because undefined is used as both “no payload” and “no pending run” state.

Prompt for AI agents
Fix with Cubic
@quazfenton	Reply...
app/api/sandbox/webcontainer/route.ts

export async function POST(req: NextRequest) {
  try {
    if (typeof window === 'undefined') {
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P1: window is always undefined in this server route, so this guard will always return 501 and the endpoint will never succeed.

Prompt for AI agents
Fix with Cubic
@quazfenton	Reply...
lib/agent/agent-session-manager.ts
      } as SandboxCreateConfig);

      // Ensure workspace directory exists
      const safeWorkspacePath = workspacePath.replace(/"/g, '\\"');
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P1: Escaping only " does not make this shell command safe; $()/backticks can still execute inside double quotes.

Prompt for AI agents
Suggested change
      const safeWorkspacePath = workspacePath.replace(/"/g, '\\"');
      const safeWorkspacePath = workspacePath.replace(/(["\\$`])/g, '\\$1');
Fix with Cubic
@quazfenton	Reply...
lib/utils.ts
Comment on lines +116 to +120
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    headers['x-anonymous-session-id'] = getOrCreateAnonymousSessionId();
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P2: Guard token lookup with try/catch; direct localStorage access here can throw and break API requests in restricted browser storage contexts.

Prompt for AI agents
Suggested change
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    headers['x-anonymous-session-id'] = getOrCreateAnonymousSessionId();
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // localStorage unavailable; continue without auth token
    }
    headers['x-anonymous-session-id'] = getOrCreateAnonymousSessionId();
Fix with Cubic
@quazfenton	Reply...
config/features.ts
Comment on lines +86 to +87
    warn: (...args: any[]) => console.warn(`[${tag} WARN]`, ...args),
    error: (...args: any[]) => console.error(`[${tag} ERROR]`, ...args),
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P2: warn/error bypass the debug flag and always log. Gate them with isEnabled() so the logger behavior matches its documented flag-controlled contract.

Prompt for AI agents
Suggested change
    warn: (...args: any[]) => console.warn(`[${tag} WARN]`, ...args),
    error: (...args: any[]) => console.error(`[${tag} ERROR]`, ...args),
    warn: (...args: any[]) => { if (isEnabled()) console.warn(`[${tag} WARN]`, ...args); },
    error: (...args: any[]) => { if (isEnabled()) console.error(`[${tag} ERROR]`, ...args); },
Fix with Cubic
@quazfenton	Reply...
2 hidden conversations
Load more…
components/conversation-interface.tsx
      if (state.inFlight) return;
      state.inFlight = true;
      try {
        const refreshed = await refreshAttachedFiles(attachedFilesystemFiles, filesystemScopePath);
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P2: The delayed refresh uses a stale attachedFilesystemFiles closure, so newer attachments can be overwritten when the timer callback commits setAttachedFilesystemFiles(refreshed).

Prompt for AI agents
Fix with Cubic
@quazfenton	Reply...
lib/virtual-filesystem/context-pack-service.ts

    if (opts.maxTotalSize && totalSize > opts.maxTotalSize) {
      // Truncate bundle to roughly maxTotalSize bytes
      bundle = bundle.slice(0, opts.maxTotalSize);
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P2: Byte-limit truncation is incorrect: slice(0, maxTotalSize) truncates characters, not UTF-8 bytes, so bundles with multibyte text can still exceed maxTotalSize.

Prompt for AI agents
Suggested change
      bundle = bundle.slice(0, opts.maxTotalSize);
      let end = bundle.length;
      while (end > 0 && encoder.encode(bundle.slice(0, end)).length > opts.maxTotalSize) {
        end--;
      }
      bundle = bundle.slice(0, end);
Fix with Cubic
@quazfenton	Reply...
lib/virtual-filesystem/scope-utils.ts
  raw = raw.replace(/^\/+/, '');

  if (raw === scope || raw.startsWith(`${scope}/`)) {
    return raw;
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P2: Paths that match the scope or start with it bypass multiple-slash normalization, leading to inconsistent path formats.

Prompt for AI agents
Fix with Cubic
@quazfenton	Reply...
app/api/stateful-agent/route.ts
Comment on lines +229 to +232
          return NextResponse.json(
            { error: 'Sandbox provider not recognized' },
            { status: 400 }
          );
Contributor
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
• 
P2: This catch block swallows provider initialization errors, returning a misleading 400 'not recognized' error instead of a 500.

Prompt for AI agents
Suggested change
          return NextResponse.json(
            { error: 'Sandbox provider not recognized' },
            { status: 400 }
          );
          const isUnknown = error?.message?.includes('Unknown sandbox provider');
          return NextResponse.json(
            { error: isUnknown ? 'Sandbox provider not recognized' : 'Failed to initialize sandbox provider' },
            { status: isUnknown ? 400 : 500 }
          );
codeant-ai bot reviewed 3 hours ago
lib/agent/nullclaw-integration.ts
Comment on lines +319 to +337
  async executeTask(
    userId: string,
    conversationId: string,
    task: NullclawTask,
  ): Promise<NullclawTask> {
    const sessionKey = `${userId}:${conversationId}`;
    const containerId = this.sessionContainers.get(sessionKey);
    const container = containerId ? this.containers.get(containerId) : undefined;

    if (!container) {
      throw new Error(
        `No Nullclaw container assigned for session ${sessionKey}. Call initializeForSession first.`
      );
    }

    if (container.status !== 'ready' && container.status !== 'running') {
      throw new Error(
        `Nullclaw container status is ${container.status}. Cannot execute tasks.`
      );
Contributor
@codeant-ai
codeant-ai bot
3 hours ago
Suggestion: The updated task execution now strictly requires a sessionContainers mapping and throws when it's missing, but the MCP bridge starts Nullclaw containers via startContainer without ever registering them in sessionContainers, so executeTask will throw "No Nullclaw container assigned…" even though a ready container exists; adding a fallback to pick any ready container from this.containers preserves per‑session behavior while keeping the MCP bridge path working. [logic error]

Severity Level: Major ⚠️
Suggested change
  async executeTask(
    userId: string,
    conversationId: string,
    task: NullclawTask,
  ): Promise<NullclawTask> {
    const sessionKey = `${userId}:${conversationId}`;
    const containerId = this.sessionContainers.get(sessionKey);
    const container = containerId ? this.containers.get(containerId) : undefined;
    if (!container) {
      throw new Error(
        `No Nullclaw container assigned for session ${sessionKey}. Call initializeForSession first.`
      );
    }
    if (container.status !== 'ready' && container.status !== 'running') {
      throw new Error(
        `Nullclaw container status is ${container.status}. Cannot execute tasks.`
      );
  async executeTask(
    userId: string,
    conversationId: string,
    task: NullclawTask,
  ): Promise<NullclawTask> {
    const sessionKey = `${userId}:${conversationId}`;
    const containerId = this.sessionContainers.get(sessionKey);
    let container = containerId ? this.containers.get(containerId) : undefined;
    // Fallback for callers that manage containers externally (e.g. MCP bridge)
    if (!container) {
      container = Array.from(this.containers.values()).find(
        (c) => c.status === 'ready' || c.status === 'running',
      );
    }
    if (!container) {
      throw new Error(
        `No Nullclaw container available for session ${sessionKey}. Call initializeForSession or start a container first.`
      );
    }
    if (container.status !== 'ready' && container.status !== 'running') {
      throw new Error(
        `Nullclaw container status is ${container.status}. Cannot execute tasks.`
      );
    }
Steps of Reproduction ✅
Prompt for AI Agent 🤖
👍 | 👎
@quazfenton	Reply...
@codeant-ai
Contributor
codeant-ai bot
commented
3 hours ago
CodeAnt AI Incremental review completed.

corridor-security[bot]
corridor-security bot reviewed 3 hours ago
corridor-security bot
left a comment
Security Issues

Improper access control and secret exposure in GitHub Actions workflow (Critical, CWE-284/CWE-200): .github/workflows/jarvis.yml is triggered by any pull_request_review_comment containing a magic phrase (on.pull_request_review_comment.*). The job runs with elevated permissions (permissions: contents: write) and exposes repository secrets (e.g., GEMINI_API_KEY, MISTRAL_API_KEY, OPENCODE_API_KEY via env/secrets). Because PR review comments can be posted by untrusted users (including forks), this is a realistic path to arbitrary privileged code execution, secret exfiltration, and malicious pushes to branches.
Missing authentication on sandbox creation API (High, CWE-306/CWE-400): Route POST /api/sandbox/devbox explicitly allows anonymous access (allowAnonymous: true). Unauthenticated clients can provision CodeSandbox devboxes, write arbitrary files into the shared “anonymous” space, and consume backend/cloud resources without limits. No rate limiting or request size limits are enforced, enabling DoS/cost amplification and cross-user interference.
Missing authentication on session clearing API (High, CWE-306): Route POST /api/sandbox/clear-sessions allows anonymous callers to clear user sessions and trigger global stale-session cleanup. An unauthenticated attacker can repeatedly invoke this to disrupt active users (DoS).
IDOR/missing authorization in PTY provider API (Critical, CWE-639): Route POST /api/sandbox/provider/pty returns provider-specific PTY/WebSocket URLs for any supplied sandboxId without verifying ownership against the authenticated user. An attacker who guesses or learns a sandboxId can obtain a live terminal URL for another user’s sandbox (authorization bypass).
Missing authentication on WebContainer creation API (High, CWE-306): Route POST /api/sandbox/webcontainer allows anonymous access (allowAnonymous: true) and defaults to userId='anonymous'. This permits unauthenticated users to create and run server-side sandboxes, consuming resources and potentially exposing preview URLs.
Missing authorization on WebSocket terminal access (Critical, CWE-639): In the WebSocketTerminalServer handler (server-side WS “connection”/“message” flow), the JWT is validated but the code does not verify that the authenticated user owns the requested sandboxId before establishing the PTY session. Any valid token holder can attach to another user’s terminal by providing a foreign sandboxId, leading to unauthorized interactive shell access.
Unauthenticated DoS via oversized WebSocket messages (High, CWE-400/CWE-20): In the WebSocket server (server.ts, WS “message” handler), the code calls JSON.parse(message.toString()) before validating payload size. A client can send a very large frame that is fully buffered and parsed, causing high CPU/memory usage and potential crashes. No protocol-level max payload (e.g., ws maxPayload) is configured.
Recommendations

Harden the GitHub Actions workflow:
Gate execution to trusted actors: add an explicit author_association check (OWNER/MEMBER/COLLABORATOR) in job if: and/or require a maintainer-applied label; alternatively switch to workflow_dispatch with required reviewers for protected environments.
Default to least privilege: set permissions: contents: read at the workflow level; grant contents: write only in a maintainer-approved, separate job/environment.
Do not expose secrets to untrusted triggers: remove secrets/env from jobs reachable by pull_request_review_comment; split into two workflows—an unprivileged collector and a privileged maintainer-triggered executor (reusable workflow via workflow_call) that receives sanitized inputs.
Protect secret-using steps with environment protection rules and required reviewers; block execution for forked PR events.
Enforce authentication and per-resource authorization on all sandbox operations:
Remove allowAnonymous: true from POST /api/sandbox/devbox, /api/sandbox/clear-sessions, and /api/sandbox/webcontainer. Require a valid authenticated session/JWT for all create/clear actions (401 on missing/invalid auth).
Implement ownership checks for sensitive resources: before returning PTY/WebSocket URLs (POST /api/sandbox/provider/pty) or accepting a WS terminal connection, look up the sandbox by sandboxId and verify it belongs to the authenticated user; return 403 or close the WS (e.g., code 4003) on mismatch and log the event.
Issue short-lived, user- and sandbox-scoped tokens (pre-signed URLs) for PTY/WebSocket access; validate them server-side before session establishment to prevent replay and cross-user access.
Add abuse and DoS safeguards:
Apply strict rate limiting, per-IP/per-user quotas, and concurrency caps on sandbox-creating and session-clearing endpoints; enforce payload/content-size limits server-side.
For WebSocket handlers, check payload length before parsing; configure protocol-level limits (e.g., ws maxPayload, max frame size), enable backpressure, and disconnect on over-limit frames.
Set resource TTLs and quotas for “anonymous” or trial workflows if any remain; isolate anonymous workspaces from authenticated users to prevent cross-user file clobbering.
Validate inputs and improve operational visibility:
Validate sandboxId format server-side and reject invalid identifiers early.
Add structured audit logs for authorization failures, denied WS connections, PTY URL issuance, and session clears; alert on anomalous rates.
Add unit/integration tests that cover authn/authz on all affected routes and WS flows (positive and negative cases).
.github/workflows/jarvis.yml
  pull_request_review_comment:
    types: [created]

jobs:
@corridor-security
corridor-security bot
3 hours ago
This workflow is triggered by any PR review comment containing a specific phrase, which enables untrusted users to start a privileged job. The same workflow later runs with contents: write permissions and uses repository secrets for external calls. This creates a realistic supply-chain risk where an attacker can trigger code that pushes commits to a repo branch and interacts with third-party services using your secrets.

Vulnerable trigger:

on:
  pull_request_review_comment:
    types: [created]
...
jobs:
  collect-comments:
    if: contains(github.event.comment.body, 'Prompt for AI Agent') || contains(github.event.comment.body, 'Prompt for AI agent')
Privileged permissions and secrets later in the workflow:

jobs:
  multi-iteration-fix:
    permissions:
      contents: write
      pull-requests: write
      actions: write
    steps:
      - name: Multi-Iteration Agent Execution & Fallback Routing
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          MISTRAL_API_KEY: ${{ secrets.MISTRAL_API_KEY }}
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
Impact: Any PR commenter (including from forks) can trigger a workflow run that has repository write access and receives secrets in the environment, enabling unauthorized code modifications and potential secret exposure via job steps or third-party requests.

Remediation:

Restrict triggering to trusted actors by also checking author_association (OWNER/MEMBER/COLLABORATOR) or require a maintainer-applied label/workflow_dispatch.
Lower default permissions to read and move write operations to a maintainer-approved job/environment.
Do not pass secrets into jobs that can be initiated by untrusted input; use protected environments with required reviewers.
Suggested change
jobs:
    if: (contains(github.event.comment.body, 'Prompt for AI Agent') || contains(github.event.comment.body, 'Prompt for AI agent')) && (github.event.comment.author_association == 'OWNER' || github.event.comment.author_association == 'MEMBER' || github.event.comment.author_association == 'COLLABORATOR')
For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.

@quazfenton	Reply...
app/api/sandbox/devbox/route.ts
Outdated
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';
@corridor-security
corridor-security bot
3 hours ago
This endpoint permits anonymous access to create a cloud development sandbox and write arbitrary files, which can be abused to consume provider resources (DoS/cost amplification) and interfere with the shared 'anonymous' session.

Vulnerable code:

const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
const userId = authResult.userId || 'anonymous';
...
const session = await sandboxBridge.getOrCreateSession(userId, {
  language: template === 'docker' ? 'docker' : 'typescript',
  template: template === 'docker' ? 'docker' : 'node',
});
...
for (const [filePath, content] of Object.entries(files)) {
  await sandbox.writeFile(filePath, content as string);
}
Impact:

Unauthenticated users can create/modify sandbox environments, potentially incurring cost and exhausting capacity (DoS).
All anonymous users share the same logical userId ('anonymous'), allowing cross-user overwrites of the same session/sandbox.
No rate limiting or input size checks on files payload.
Remediation:

Require authentication and bind sessions to the authenticated user.
Add rate limiting and input size limits (e.g., max files/bytes).
Validate/normalize file paths and restrict templates.
Suggested change
    const userId = authResult.userId || 'anonymous';
const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.

@quazfenton	Reply...
app/api/sandbox/provider/pty/route.ts
    }

    logger.debug('Provider PTY request', {
      sandboxId,
@corridor-security
corridor-security bot
3 hours ago
The endpoint returns PTY/WebSocket URLs for a supplied sandboxId without verifying ownership. This creates an IDOR: an authenticated attacker can enumerate or guess other users' sandbox IDs and obtain a PTY URL to connect to their terminal.

Vulnerable flow:

// No ownership/authorization check for the provided sandboxId
const { sandboxId, sessionId } = body;
...
const ptyInfo = await handleProviderPTYRequest(sandboxId, sessionId, providerType);
return NextResponse.json(ptyInfo);
Impact: Disclosure of PTY/WebSocket URLs allowing terminal attachment to another user's environment (authorization bypass).

Remediation:

Verify that the authenticated user owns the sandbox before returning any PTY/WS URL. For example, look up the session via sandboxBridge.getSessionByUserId(authResult.userId) and ensure session.sandboxId === sandboxId (and optionally validate sessionId).
Return 403 if ownership doesn't match.
Perform this check before any provider calls.
For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.

@quazfenton	Reply...
app/api/sandbox/webcontainer/route.ts
Outdated
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';
@corridor-security
corridor-security bot
3 hours ago
This endpoint allows anonymous access to create and run WebContainer sandboxes by using allowAnonymous: true and defaulting userId to 'anonymous'. This bypasses the project's requirement that sandbox operations be authenticated and can be abused to consume resources or expose preview endpoints.

Vulnerable code:

const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
const userId = authResult.userId || 'anonymous';
Remediation: Require authentication and remove the anonymous fallback.

Suggested change
    const userId = authResult.userId || 'anonymous';
const authResult = await resolveRequestAuth(req);
For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.

@quazfenton	Reply...
cubic-dev-ai[bot]
cubic-dev-ai bot reviewed 3 hours ago
Contributor
cubic-dev-ai bot
left a comment
3 issues found across 4 files (changes from recent commits).

Prompt for AI agents (unresolved issues)
Reply with feedback, questions, or to request a fix. Tag @cubic-dev-ai to re-run a review.

.github/workflows/jarvis.yml
Outdated
Comment on lines +260 to +266
          cat > /tmp/base_prompt.txt << 'BASE_PROMPT_EOF'
You are an expert Staff Engineer. Analyze the whole repo context.
Here is the CodeRabbit review context: ${{ steps.context.outputs.suggestions }}

Apply these fixes, ensure Postgres/Terraform logic is intact, and verify type safety.
Group related changes together logically.
BASE_PROMPT_EOF
Contributor
@cubic-dev-ai
cubic-dev-ai bot
3 hours ago
• 
P0: Avoid interpolating GitHub Actions expressions directly into shell scripts, as this can lead to script injection vulnerabilities if the content contains the heredoc delimiter.

Prompt for AI agents
Suggested change
          cat > /tmp/base_prompt.txt << 'BASE_PROMPT_EOF'
You are an expert Staff Engineer. Analyze the whole repo context.
Here is the CodeRabbit review context: ${{ steps.context.outputs.suggestions }}
Apply these fixes, ensure Postgres/Terraform logic is intact, and verify type safety.
Group related changes together logically.
BASE_PROMPT_EOF
          {
            echo "You are an expert Staff Engineer. Analyze the whole repo context."
            echo "Here is the CodeRabbit review context: "
            cat /tmp/suggestions.txt
            echo ""
            echo "Apply these fixes, ensure Postgres/Terraform logic is intact, and verify type safety."
            echo "Group related changes together logically."
          } > /tmp/base_prompt.txt
Fix with Cubic
@quazfenton	Reply...
.github/workflows/jarvis.yml

          # Parse changed files and format as markdown list with links
          # Write to file to avoid heredoc delimiter issues
          echo '${{ steps.commit.outputs.changed_files }}' | jq -r '.[]' > /tmp/files_list.txt
Contributor
@cubic-dev-ai
cubic-dev-ai bot
3 hours ago
• 
P1: Directly interpolating action outputs into bash strings can cause script injection if the content contains single quotes. Use the raw text file already generated by the previous step instead.

Prompt for AI agents
Suggested change
          echo '${{ steps.commit.outputs.changed_files }}' | jq -r '.[]' > /tmp/files_list.txt
          cp /tmp/changed_files.txt /tmp/files_list.txt
