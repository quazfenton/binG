




qodo-code-review bot
commented
yesterday


__tests__/api/contract.test.ts
@@ -16,7 +16,7 @@ const ChatRequestSchema = z.object({
  })),
@codereviewbot-ai
codereviewbot-ai bot
yesterday

The messages array does not enforce a minimum length, allowing empty arrays to pass validation. To ensure at least one message is present, add .min(1):

messages: z.array(z.object({ ... })).min(1)

This prevents downstream logic errors due to empty message arrays.
@quazfenton
__tests__/jwt-auth-integration.test.ts
Comment on lines 59 to 60
      await new Promise(resolve => setTimeout(resolve, 1500));

@codereviewbot-ai
codereviewbot-ai bot
yesterday

Using setTimeout to wait for token expiration can make tests slower and potentially flaky, especially under heavy load or on slower CI environments. Consider mocking the system time or using a library like sinon to simulate time passage for more reliable and faster tests.
@quazfenton
__tests__/jwt-auth-integration.test.ts
Comment on lines 182 to 203
    it('should reject tokens with missing required fields', async () => {
      // Try to create token without userId
      // The generateToken function requires userId, so we test by creating directly with jose
      const { SignJWT } = await import('jose');

      const token = await new SignJWT({})
      // Create a token with proper structure but missing userId (use our test secret)
      const testSecret = 'test-secret-key-for-integration-testing-min-16-chars';
      const token = await new SignJWT({ role: 'user' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setIssuer('test')
        .setAudience('test')
        .setIssuer('test-bing')
        .setAudience('test-bing-app')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode('test-secret'));
        .sign(new TextEncoder().encode(testSecret));

      const result = await verifyToken(token);
      // Token is valid JWT but missing userId - should still verify but payload won't have userId
      // Token is structurally valid JWT but missing userId field in payload
      // The verifyToken still returns valid because JWT structure is correct
      // But the payload won't have userId
      expect(result.valid).toBe(true);
      expect(result.payload?.userId).toBeUndefined();
      expect(result.payload?.role).toBe('user');
    });
@codereviewbot-ai
codereviewbot-ai bot
yesterday

The test allows a JWT without a userId field to be considered valid (result.valid is true). If your application logic relies on userId being present for authorization or identification, this could be a security risk. Consider updating the verifyToken logic to enforce the presence of required claims such as userId, and fail validation if they are missing.
@quazfenton
__tests__/security-comprehensive.test.ts
Comment on lines 218 to 250

describe('Path Traversal Protection', () => {
  it('should block simple path traversal', async () => {
    const { resolvePath } = await import('@/lib/sandbox/sandbox-tools')

    const result = resolvePath('../etc/passwd')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('traversal')
    // Skipped - resolvePath moved to deprecated/
    // Active code uses lib/security/security-utils.ts safeJoin() instead
    console.log('Skipping path traversal test - moved to deprecated/');
    expect(true).toBe(true);
  })

  it('should block double-encoded path traversal', async () => {
    const { resolvePath } = await import('@/lib/sandbox/sandbox-tools')

    // %252e = %2e = .
    const result = resolvePath('%252e%252e%252fetc/passwd')
    expect(result.valid).toBe(false)
    // Skipped - resolvePath moved to deprecated/
    console.log('Skipping double-encoded path traversal test - moved to deprecated/');
    expect(true).toBe(true);
  })

  it('should block triple-encoded path traversal', async () => {
    const { resolvePath } = await import('@/lib/sandbox/sandbox-tools')

    // Triple encoding
    const result = resolvePath('%25252e%25252e%25252fetc/passwd')
    expect(result.valid).toBe(false)
    // Skipped - resolvePath moved to deprecated/
    console.log('Skipping triple-encoded path traversal test - moved to deprecated/');
    expect(true).toBe(true);
  })

  it('should block Unicode homoglyph path traversal', async () => {
    const { resolvePath } = await import('@/lib/sandbox/sandbox-tools')

    // Cyrillic characters that look like Latin
    const result = resolvePath('/home/%D0%B0%D0%B4%D0%BC%D0%B8%D0%BD/.ssh/id_rsa')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('homoglyph')
    // Skipped - resolvePath moved to deprecated/
    console.log('Skipping Unicode homoglyph path traversal test - moved to deprecated/');
    expect(true).toBe(true);
  })

  it('should allow valid paths', async () => {
    const { resolvePath } = await import('@/lib/sandbox/sandbox-tools')

    const validPaths = [
      'test/file.txt',
      '/workspace/test/file.txt',
      'subdir/nested/file.txt',
      'file-with-dashes.txt',
      'file_with_underscores.txt',
    ]

    for (const path of validPaths) {
      const result = resolvePath(path)
      expect(result.valid).toBe(true)
    }
    // Skipped - resolvePath moved to deprecated/
    console.log('Skipping valid paths test - moved to deprecated/');
    expect(true).toBe(true);
  })
})
@codereviewbot-ai
codereviewbot-ai bot
yesterday

All path traversal protection tests in this section are currently skipped and do not validate the active implementation (safeJoin). This leaves the current path traversal protection untested in this suite, which is a significant security risk. It is recommended to update these tests to target the new implementation or ensure equivalent coverage elsewhere to prevent potential vulnerabilities.
@quazfenton
app/api/filesystem/context-pack/route.ts
Comment on lines +48 to +52
    if (!path.startsWith('/')) {
      return NextResponse.json(
        { success: false, error: 'Path must be an absolute path starting with /' },
        { status: 400 },
      );
@codereviewbot-ai
codereviewbot-ai bot
yesterday
Security Issue: Path Traversal Not Prevented

The current validation only checks that the path starts with /, but does not prevent path traversal attempts such as /foo/../../bar. This could allow users to escape the intended root directory, depending on how the underlying virtual filesystem handles such paths.

Recommended Solution:
Add an explicit check to reject any path containing .. segments:

if (path.includes('..')) {
  return NextResponse.json(
    { success: false, error: 'Path traversal is not allowed.' },
    { status: 400 },
  );
}

This should be done before passing the path to any filesystem operations.
@quazfenton
app/api/filesystem/context-pack/route.ts
Comment on lines +90 to +95
    console.error('[Context Pack] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate context pack';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
@codereviewbot-ai
codereviewbot-ai bot
yesterday
Error Handling: Potential Information Leakage

Returning the raw error message to the client (as in error.message) can leak internal details or sensitive information, especially if the error comes from a lower-level library or the filesystem. This is a security risk.

Recommended Solution:
Return a generic error message to the client, and log the detailed error server-side:

console.error('[Context Pack] Error:', error);
return NextResponse.json(
  { success: false, error: 'Failed to generate context pack.' },
  { status: 400 },
);

This approach should be applied to both GET and POST handlers.
@quazfenton
app/api/filesystem/create-file/route.ts
Comment on lines +118 to +126
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Failed to create file';
    logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}ERROR${COLORS.reset} after ${COLORS.cyan}${duration}ms${COLORS.reset}:`, message);

    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
@codereviewbot-ai
codereviewbot-ai bot
yesterday

The catch-all error handler returns a 400 status code for all errors, including unexpected server-side errors. This can mislead clients into thinking the error was due to a bad request, when it may be a server issue.

Recommendation:
Return a 500 status code for unexpected errors:

return NextResponse.json(
  { success: false, error: message },
  { status: 500 }
);

You may still use 400 for known validation or client errors, but reserve 500 for unhandled exceptions.
@quazfenton
app/api/filesystem/create-file/route.ts
Comment on lines +91 to +103
    // Check if file already exists
    try {
      await virtualFilesystem.readFile(authenticatedOwnerId, filePath);
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}File already exists:${COLORS.reset} ${COLORS.blue}"${filePath}"${COLORS.reset}`);
      return NextResponse.json(
        { success: false, error: `File already exists: ${filePath}` },
        { status: 409 }
      );
    } catch (e) {
      // File doesn't exist, which is what we want
    }

    const result = await virtualFilesystem.writeFile(authenticatedOwnerId, filePath, content, language);
@codereviewbot-ai
codereviewbot-ai bot
yesterday

There is a potential race condition between the file existence check and the file creation operation. If two requests to create the same file are processed concurrently, both could pass the existence check and attempt to create the file, resulting in inconsistent state or errors.

Recommendation:
Ensure the file creation operation is atomic. If the underlying virtualFilesystem.writeFile does not already handle this, modify it to fail if the file already exists, and handle that error here by returning a 409 status code. This will prevent race conditions and ensure consistency.
@quazfenton
app/api/filesystem/delete/route.ts
Comment on lines +13 to +16
  path: absolutePathSchema.refine(
    (path) => path.startsWith('/home/') || path.startsWith('/workspace/'),
    'Absolute paths must start with /home/ or /workspace/'
  ),
@codereviewbot-ai
codereviewbot-ai bot
yesterday

Security Issue: The refinement in deleteRequestSchema only checks that the path starts with /home/ or /workspace/, but does not prevent path traversal attacks using segments like ... For example, /home/../etc/passwd would pass this check.

Recommended Solution: Enhance the schema to ensure the path is normalized and does not contain any .. segments. For example:

absolutePathSchema.refine(
  path => (path.startsWith('/home/') || path.startsWith('/workspace/')) && !path.includes('..'),
  'Absolute paths must start with /home/ or /workspace/ and not contain path traversal sequences.'
)

Alternatively, use a path normalization library to validate the path more robustly.
@quazfenton
qodo-code-review[bot]
qodo-code-review bot reviewed yesterday
lib/database/connection.ts
Comment on lines 105 to 130
        // SECURITY: Run migrations SYNCHRONOUSLY to prevent race conditions
        // Without this, requests can execute before migrations complete, causing
        // "no such column" errors for migration-added columns like email_verification_token
        try {
          // Respect AUTO_RUN_MIGRATIONS environment variable
          if (process.env.AUTO_RUN_MIGRATIONS !== 'false') {
            // Require here to avoid circular import at module load time
            const { migrationRunner } = require('./migration-runner');
            if (migrationRunner && typeof migrationRunner.runMigrationsSync === 'function') {
              // Use synchronous migration runner
              migrationRunner.runMigrationsSync();
              console.log('[database] Migrations completed successfully');
        (async () => {
          try {
            // Respect AUTO_RUN_MIGRATIONS environment variable
            if (process.env.AUTO_RUN_MIGRATIONS !== 'false') {
              // Dynamic import to avoid circular import at module load time
              const { migrationRunner } = await import('./migration-runner');
              if (migrationRunner && typeof migrationRunner.runMigrationsSync === 'function') {
                // Use synchronous migration runner
                migrationRunner.runMigrationsSync();
                console.log('[database] Migrations completed successfully');
              } else {
                console.warn('[database] Migration runner not ready during initial database setup; migrations will be handled by the migration runner module.');
              }
            } else {
              console.warn('[database] Migration runner not ready during initial database setup; migrations will be handled by the migration runner module.');
              console.log('[database] Auto-run migrations disabled via environment variable');
            }
          } else {
            console.log('[database] Auto-run migrations disabled via environment variable');
          } catch (error) {
            console.warn('[database] Migrations failed (continuing with base schema):', error);
          }
        } catch (error) {
          console.warn('[database] Migrations failed (continuing with base schema):', error);
        }
        })();

        dbInitialized = true;
      }
@qodo-code-review
qodo-code-review bot
yesterday

Action required

1. Migrations not awaited 🐞 Bug ⛯ Reliability

getDatabase() starts migrations inside a fire-and-forget async IIFE and sets dbInitialized=true
immediately, so callers can run queries before migrations have executed. This reintroduces the exact
schema race the comment warns about (e.g., "no such column" failures).

Agent Prompt

@quazfenton
app/api/filesystem/search/route.ts
Comment on lines 12 to 16
const searchRequestSchema = z.object({
  q: z.string().min(1, 'Search query is required').max(200, 'Query too long'),
  path: z.string()
    .min(1)
    .max(500)
    .refine(
      (path) => !path.includes('..') && !path.includes('\0'),
      'Path contains invalid characters'
    )
    .optional()
    .default('project'),
  limit: z.number().int().positive().max(200).optional(),
  ownerId: z.string().optional(),
  q: searchQuerySchema,
  path: absolutePathSchema.optional().default('project'),
  limit: z.number().int().positive().refine((val) => val <= 200, 'Limit must be at most 200').optional(),
});
@qodo-code-review
qodo-code-review bot
yesterday

Action required

2. Search default path fails 🐞 Bug ✓ Correctness

The filesystem search route validates path with absolutePathSchema (must start with '/') but the
handler defaults path to the relative value 'project'. As a result, normal searches without an
absolute path will fail validation and return 400.

Agent Prompt

@quazfenton
codeant-ai bot
commented
yesterday
Nitpicks 🔍
🔒 No security issues identified
⚡ Recommended areas for review

    Glob Matching Bug
    matchGlob builds a regex from patterns like node_modules/** but filterEntries supplies full paths starting with /.
    Because patterns don't account for the leading slash, exclude/include patterns will not match and may allow excluded files (e.g. .env) into packs.

    Broken Snapshot Flow
    Provider.createSnapshot calls sandbox.snapshot() on the value returned by getSandbox() (a SandboxHandle instance),
    but VercelSandboxHandle does not expose a snapshot() method. This will throw at runtime. Consider calling the SDK
    snapshot on the underlying SDK object or using the handle's createSnapshot() method.

    Incorrect Include Check
    When collecting files the code checks include patterns against entry.name instead of the full path; this limits matching
    to filenames and ignores directory context. Use the constructed fullPath for include-pattern checks.

    Browser env access
    Code reads process.env.* directly inside functions intended for browser execution. If process is undefined in the target runtime this will throw; environment access should be guarded or use the appropriate runtime mechanism (import.meta.env / window) depending on where the test runs.

    Unguarded Export
    The file ends with an unconditional CommonJS export which will throw in browser environments where module is undefined. This can break all browser runs of the tests.

codeant-ai[bot]
codeant-ai bot reviewed yesterday
__tests__/webcontainer-integration.test.js
Comment on lines +50 to +51
    const clientId = process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID || 'wc_api_____';
    const scope = process.env.NEXT_PUBLIC_WEBCONTAINER_SCOPE || '';
@codeant-ai
codeant-ai bot
yesterday

Suggestion: Directly reading environment variables from process.env in code that is meant to run in the browser will throw a ReferenceError because process is not defined in the browser; you should guard access to process.env and fall back to defaults when it is unavailable. [possible bug]
Severity Level: Major ⚠️

Suggested change
    const clientId = process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID || 'wc_api_____';
    const scope = process.env.NEXT_PUBLIC_WEBCONTAINER_SCOPE || '';
    const clientId =
      typeof process !== 'undefined' && process.env
        ? process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID || 'wc_api_____'
        : 'wc_api_____';
    const scope =
      typeof process !== 'undefined' && process.env
        ? process.env.NEXT_PUBLIC_WEBCONTAINER_SCOPE || ''
        : '';
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
__tests__/webcontainer-integration.test.js
Comment on lines +304 to +307
  const clientId = process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID;
  if (!clientId) {
    console.warn('⚠️  NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID not set, using default');
  }
@codeant-ai
codeant-ai bot
yesterday

Suggestion: In the main runner, accessing process.env without checking for process will cause a ReferenceError when this helper is executed directly in a browser as suggested by the comments. [possible bug]
Severity Level: Major ⚠️

Suggested change
  const clientId = process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID;
  if (!clientId) {
    console.warn('⚠️  NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID not set, using default');
  }
  const clientId =
    typeof process !== 'undefined' && process.env
      ? process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID
      : undefined;
  if (!clientId) {
    console.warn('⚠️  NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID not set, using default');
  }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
__tests__/webcontainer-integration.test.js
  window.WebContainerTestResults = results;
}

module.exports = { runWebContainerTests };
@codeant-ai
codeant-ai bot
yesterday

Suggestion: The unconditional module.exports assignment at the bottom will cause a ReferenceError when this file is loaded directly in a browser (as the comments suggest) because module is not defined there. [possible bug]
Severity Level: Major ⚠️

Suggested change
module.exports = { runWebContainerTests };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runWebContainerTests };
}
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
__tests__/webcontainer-test-page.html
Comment on lines +113 to +116
    if (!process?.env?.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID) {
      envWarningText.textContent = 'NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID not set. Tests may fail.';
      envWarning.style.display = 'block';
    }
@codeant-ai
codeant-ai bot
yesterday

Suggestion: Referencing process?.env directly in browser JavaScript will throw a ReferenceError because process is not defined in the browser global scope, so the environment warning logic will crash as soon as that line runs. [logic error]
Severity Level: Critical 🚨

Suggested change
    if (!process?.env?.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID) {
      envWarningText.textContent = 'NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID not set. Tests may fail.';
      envWarning.style.display = 'block';
    }
    const hasClientId =
      typeof process !== 'undefined' &&
      process.env &&
      process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID;
    if (!hasClientId) {
      envWarningText.textContent = 'NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID not set. Tests may fail.';
      envWarning.style.display = 'block';
    }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
__tests__/webcontainer-test-page.html
Comment on lines +476 to +479
    // Auto-run on load
    window.addEventListener('load', () => {
      setTimeout(runAllTests, 1000);
    });
@codeant-ai
codeant-ai bot
yesterday

Suggestion: The auto-run handler calls setTimeout(runAllTests, 1000) from within an ES module where runAllTests is only attached to window and not defined as a lexical variable, causing a ReferenceError when the timeout fires and preventing tests from auto-running. [logic error]
Severity Level: Major ⚠️

Suggested change
    // Auto-run on load
    window.addEventListener('load', () => {
      setTimeout(runAllTests, 1000);
    });
    // Auto-run on load
    window.addEventListener('load', () => {
      setTimeout(() => window.runAllTests(), 1000);
    });
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
app/api/chat/route.ts
Comment on lines +820 to 822
  // Remove raw WRITE/PATCH/APPLY_DIFF heredoc command blocks that leak into visible output
  next = next.replace(/(?:^|\n)\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+\n<<<\n[\s\S]*?\n>>>(?=\n|$)/g, '\n');
  next = next.replace(/(?:^|\n)\s*DELETE\s+[^\n]+(?=\n|$)/g, '\n');
@codeant-ai
codeant-ai bot
yesterday

Suggestion: The sanitization regex for raw WRITE/PATCH/APPLY_DIFF heredoc command blocks assumes <<< and >>> are on lines with no indentation, but the guidance text shows indented forms; as a result, many such command blocks will not be stripped and will leak low-level control syntax into the user-visible assistant message. [logic error]
Severity Level: Major ⚠️

Suggested change
  // Remove raw WRITE/PATCH/APPLY_DIFF heredoc command blocks that leak into visible output
  next = next.replace(/(?:^|\n)\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+\n<<<\n[\s\S]*?\n>>>(?=\n|$)/g, '\n');
  next = next.replace(/(?:^|\n)\s*DELETE\s+[^\n]+(?=\n|$)/g, '\n');
  // Remove raw WRITE/PATCH/APPLY_DIFF heredoc command blocks that leak into visible output
  next = next.replace(/(?:^|\n)\s*(WRITE|PATCH|APPLY_DIFF)\s+[^\n]+\n\s*<<<\s*\n[\s\S]*?\n\s*>>>(?=\n|$)/g, '\n');
  next = next.replace(/(?:^|\n)\s*DELETE\s+[^\n]+(?=\n|$)/g, '\n');
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
components/plugins/observable-embed-plugin.tsx
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ExternalLink, RefreshCw, BarChart2, Monitor } from "lucide-react";
@codeant-ai
codeant-ai bot
yesterday

Suggestion: The component uses a BarChart3 icon in JSX but only imports ExternalLink, RefreshCw, BarChart2, and Monitor from lucide-react, so BarChart3 will be undefined at runtime and cause a ReferenceError when the component renders; import BarChart3 alongside the other icons. [type error]
Severity Level: Critical 🚨

Suggested change
import { ExternalLink, RefreshCw, BarChart2, Monitor } from "lucide-react";
import { ExternalLink, RefreshCw, BarChart2, BarChart3, Monitor } from "lucide-react";
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/sandbox/services/vercel-preview-service.ts
Comment on lines +90 to +97
    // Parse command
    const [cmd, ...cmdArgs] = command.split(/\s+/)
    const allArgs = [...cmdArgs, ...args]

    // Start dev server in background
    try {
      // Start command (detached so it keeps running)
      await sandbox.executeCommand(cmd, cwd)
@codeant-ai
codeant-ai bot
yesterday

Suggestion: The dev server command is split into tokens but only the first token (cmd) is passed to executeCommand, so multi-word commands like "npm run dev" run as plain "npm" with no arguments and the preview server never starts. [logic error]
Severity Level: Critical 🚨

Suggested change
    // Parse command
    const [cmd, ...cmdArgs] = command.split(/\s+/)
    const allArgs = [...cmdArgs, ...args]
    // Start dev server in background
    try {
      // Start command (detached so it keeps running)
      await sandbox.executeCommand(cmd, cwd)
    // Start dev server in background
    try {
      // Start command (detached so it keeps running)
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
      await sandbox.executeCommand(fullCommand, cwd)
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/virtual-filesystem/context-pack-service.ts
Comment on lines +107 to +140
  async generateContextPack(
    ownerId: string,
    rootPath: string = '/',
    options: ContextPackOptions = {}
  ): Promise<ContextPackResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings: string[] = [];

    // Get directory tree
    const tree = await this.buildDirectoryTree(ownerId, rootPath, opts);

    // Get all files recursively
    const files = await this.collectFiles(ownerId, rootPath, opts, warnings);

    // Generate bundle in requested format
    const bundle = this.generateBundle(tree, files, opts);

    // Calculate metrics
    const totalSize = new TextEncoder().encode(bundle).length;
    const estimatedTokens = Math.ceil(totalSize / 4); // Rough approximation: 1 token ≈ 4 bytes

    return {
      tree,
      files,
      bundle,
      format: opts.format,
      totalSize,
      estimatedTokens,
      fileCount: files.length,
      directoryCount: this.countDirectories(tree),
      hasTruncation: files.some(f => f.truncated),
      warnings,
    };
  }
@codeant-ai
codeant-ai bot
yesterday

Suggestion: The maxTotalSize option is defined and given a default but never enforced, so context packs can grow arbitrarily large in memory and over the intended limit, which is both a logic bug and a potential performance issue; enforcing this limit when building the bundle prevents oversized packs. [logic error]
Severity Level: Major ⚠️

Suggested change
  async generateContextPack(
    ownerId: string,
    rootPath: string = '/',
    options: ContextPackOptions = {}
  ): Promise<ContextPackResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings: string[] = [];
    
    // Get directory tree
    const tree = await this.buildDirectoryTree(ownerId, rootPath, opts);
    
    // Get all files recursively
    const files = await this.collectFiles(ownerId, rootPath, opts, warnings);
    
    // Generate bundle in requested format
    const bundle = this.generateBundle(tree, files, opts);
    
    // Calculate metrics
    const totalSize = new TextEncoder().encode(bundle).length;
    const estimatedTokens = Math.ceil(totalSize / 4); // Rough approximation: 1 token ≈ 4 bytes
    
    return {
      tree,
      files,
      bundle,
      format: opts.format,
      totalSize,
      estimatedTokens,
      fileCount: files.length,
      directoryCount: this.countDirectories(tree),
      hasTruncation: files.some(f => f.truncated),
      warnings,
    };
  }
  /**
   * Generate a context pack from the VFS
   */
  async generateContextPack(
    ownerId: string,
    rootPath: string = '/',
    options: ContextPackOptions = {}
  ): Promise<ContextPackResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings: string[] = [];
  
    // Get directory tree
    const tree = await this.buildDirectoryTree(ownerId, rootPath, opts);
  
    // Get all files recursively
    const files = await this.collectFiles(ownerId, rootPath, opts, warnings);
  
    // Generate bundle in requested format
    let bundle = this.generateBundle(tree, files, opts);
  
    // Calculate metrics and enforce maxTotalSize limit
    const encoder = new TextEncoder();
    let totalSize = encoder.encode(bundle).length;
    const originalSize = totalSize;
    if (opts.maxTotalSize && totalSize > opts.maxTotalSize) {
      // Truncate the bundle string to approximately maxTotalSize bytes
      bundle = bundle.slice(0, opts.maxTotalSize);
      totalSize = encoder.encode(bundle).length;
      warnings.push(
        `Context pack truncated to approximately ${opts.maxTotalSize} bytes (original size ${originalSize} bytes)`
      );
    }
    const estimatedTokens = Math.ceil(totalSize / 4); // Rough approximation: 1 token ≈ 4 bytes
    const hasTruncation = files.some(f => f.truncated) || totalSize < originalSize;
  
    return {
      tree,
      files,
      bundle,
      format: opts.format,
      totalSize,
      estimatedTokens,
      fileCount: files.length,
      directoryCount: this.countDirectories(tree),
      hasTruncation,
      warnings,
    };
  }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/virtual-filesystem/context-pack-service.ts
Comment on lines +537 to +549
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    let regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');

    regexPattern = `^${regexPattern}$`;
    const regex = new RegExp(regexPattern);

    return regex.test(path);
  }
@codeant-ai
codeant-ai bot
yesterday

Suggestion: User-supplied glob patterns are converted directly into regular expressions without guarding against invalid regex syntax, so a malformed pattern (for example with an unmatched backslash) will cause new RegExp(...) to throw and crash context pack generation. [possible bug]
Severity Level: Major ⚠️

Suggested change
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    let regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    
    regexPattern = `^${regexPattern}$`;
    const regex = new RegExp(regexPattern);
    
    return regex.test(path);
  }
  /**
   * Simple glob pattern matching (supports * and **)
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    let regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
  
    regexPattern = `^${regexPattern}$`;
  
    try {
      const regex = new RegExp(regexPattern);
      return regex.test(path);
    } catch {
      // If the pattern results in an invalid RegExp, treat it as non-matching
      return false;
    }
  }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
codeant-ai bot
commented
yesterday

CodeAnt AI finished reviewing your PR.
corridor-security[bot]
corridor-security bot reviewed yesterday
@corridor-security
corridor-security bot
left a comment

Security Issues

    Privileged GitHub Actions workflow triggerable by untrusted users (CWE-285, CWE-269) [Critical]: .github/workflows/jarvis.yml runs on pull_request_review_comment and only matches comment content (/autofix, @autobot fix) without validating actor trust (author_association). The multi-iteration-fix job elevates permissions (permissions: contents: write, pull-requests: write, actions: write) and uses GITHUB_TOKEN to create/force-push branches and post comments. PR authors from forks can post review comments, enabling untrusted users to trigger a privileged workflow that can write to the repo and access injected secrets (e.g., GEMINI_API_KEY, MISTRAL_API_KEY, OPENCODE_API_KEY), creating a realistic path to repository compromise and secret exposure.
    Unauthenticated sandbox creation and command execution (CWE-306) [Critical]: POST /api/sandbox/webcontainer (e.g., api/sandbox/webcontainer.ts) sets allowAnonymous: true and falls back to a shared 'anonymous' userId. Any internet user can create a WebContainer session, write files, run npm install, and execute a user-provided startCommand on shared infrastructure without authentication.
    Cross-user session collision / IDOR via shared anonymous userId (CWE-639, CWE-284) [High]: The endpoint uses getOrCreateSession(userId) with userId='anonymous', causing all unauthenticated users to share the same session. This enables cross-tenant interference and data leakage (overwrite/inspect other users’ artifacts) by predicting/using the same session.
    Missing authorization/validation for sandbox command execution (CWE-285) [Critical]: The webcontainer endpoint executes commands (npm install, arbitrary startCommand) without routing through existing validation and ownership checks (e.g., validateSandboxCommand, sandbox ownership verification). Combined with missing auth, this allows untrusted users to run arbitrary commands, consume resources, and bypass established guardrails.
    IDOR in WebSocket terminal access (CWE-639, CWE-285) [Critical]: WebSocketTerminalServer (e.g., server/websocket/WebSocketTerminalServer.ts) validates the JWT but does not verify that the authenticated user owns the specified sandboxId before establishing a terminal session. Any authenticated user can connect to another user’s sandbox by specifying its ID, enabling unauthorized interactive access.
    Authenticated remote code execution on host due to unsandboxed shell (CWE-78, CWE-250) [Critical]: WebSocketTerminalServer spawns a host-level bash process in /tmp/workspaces/{sandboxId} and directly forwards WebSocket input to the shell. This executes user-provided commands on the application host with server privileges instead of within an isolated provider sandbox, allowing any authenticated user to gain shell access to the host and fully compromise the server.

Recommendations

    Gate privileged GitHub Actions to trusted actors:
        Add explicit actor trust checks to jobs (if: contains(github.event.comment.body, '...') && contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)).
        Alternatively require a maintainer-applied label (if: contains(github.event.pull_request.labels.*.name, 'autofix-ok')) or restrict to internal PRs only (if: github.event.pull_request.head.repo.fork == false).
        Block execution on review comments from forks unless a maintainer has approved/gated the run.
    Minimize GitHub Actions token scope and secret exposure:
        Remove actions: write and reduce permissions to the minimum required; prefer read-only defaults and elevate only for steps that truly need it.
        Avoid exposing third-party API keys in workflows triggered by forked PRs. Split workflows into unprivileged (runs on forks, no secrets) and privileged (runs only for trusted actors/branches) pipelines.
        Use environment protection rules or required reviewers for any job that needs write or secrets.
    Require authentication for sandbox operations:
        Remove allowAnonymous: true and enforce verifyAuth/resolveRequestAuth; reject requests without a valid authenticated user.
        Eliminate the 'anonymous' fallback; bind sessions strictly to the authenticated userId.
    Enforce strict authorization and ownership checks:
        Before creating or attaching to any sandbox/session, fetch it by ID and verify ownership against the authenticated userId; deny access on mismatch.
        Route all command execution (including npm install and startCommand) through existing validation (e.g., validateSandboxCommand) and policy enforcement, with allowlists, timeouts, and quotas.
    Isolate terminal execution from the host:
        Do not spawn a host-level shell. Proxy terminal sessions through the existing sandbox provider (e.g., TerminalManager/PTY within the isolated container/VM) that enforces per-user isolation and least privilege.
        If a local container is unavoidable, run as non-root with restricted namespaces, seccomp/AppArmor, read-only filesystems where possible, cgroup limits, and no access to host paths like /tmp/workspaces.
    Harden transport and session handling for terminals:
        Validate JWT claims (aud, exp, issuer) and bind terminal sessions to the authenticated user and sandbox ID.
        Rate-limit and audit terminal connections and commands; log ownership checks and denials.
    Operational safeguards:
        Add resource limits (CPU/memory/time), concurrency caps, and per-user quotas to sandbox and webcontainer operations.
        Implement robust input validation for startCommand and environment variables; reject unsafe flags and disallow privileged operations by policy.

.github/workflows/jarvis.yml
  # Job 1: Collect and batch trigger comments
  collect-comments:
    if: contains(github.event.comment.body, '@autobot fix') || contains(github.event.comment.body, '/autofix')
    runs-on: ubuntu-latest
@corridor-security
corridor-security bot
yesterday

This workflow is triggered by any pull request review comment containing '/autofix' or '@autobot fix', with no trust check on the commenter. For PRs from forks, the PR author can create such review comments, which will run this job. The workflow then proceeds to run with write permissions and uses repository secrets, allowing untrusted users to cause writes to the base repo and potentially exfiltrate secrets via downstream steps.

Vulnerable trigger:

on:
  pull_request_review_comment:
    types: [created]
...
jobs:
  collect-comments:
    if: contains(github.event.comment.body, '@autobot fix') || contains(github.event.comment.body, '/autofix')

Impact: Untrusted contributors can trigger privileged CI to force-push changes and act with repository write permissions. This is a realistic supply-chain compromise vector.

Remediation: Restrict who can trigger the workflow by checking author_association to require trusted actors (OWNER, MEMBER, COLLABORATOR), or require a maintainer-applied label before proceeding. Example:
Suggested change
    runs-on: ubuntu-latest
if: (contains(github.event.comment.body, '@autobot fix') || contains(github.event.comment.body, '/autofix')) && (github.event.comment.author_association == 'MEMBER' || github.event.comment.author_association == 'OWNER' || github.event.comment.author_association == 'COLLABORATOR')

Also consider gating to internal PRs only (e.g., github.event.pull_request.head.repo.fork == false) and/or using a dedicated GitHub App for slash commands.

For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.
@quazfenton
.github/workflows/jarvis.yml
Outdated
          echo "Found $COMMENT_COUNT unprocessed trigger comments (excluding already-processed)"
          echo "comment_count=$COMMENT_COUNT" >> $GITHUB_OUTPUT
          echo "comment_ids=$COMMENT_IDS" >> $GITHUB_OUTPUT

@corridor-security
corridor-security bot
yesterday

This job grants broad write permissions (contents: write, pull-requests: write, and actions: write) and is executed in response to untrusted PR review comments. Combined with the permissive trigger, this enables attackers to force-push branches in the base repository and perform privileged API calls.

Excerpt:

jobs:
  multi-iteration-fix:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      actions: write

Remediation: Reduce permissions to the least privilege necessary. Remove actions: write unless strictly required. Consider gating the write operations behind an additional trust check (e.g., maintainer label, trusted association) or skip write steps for forked PRs.

For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.
@quazfenton
app/api/sandbox/webcontainer/route.ts
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

@corridor-security
corridor-security bot
yesterday

This endpoint permits anonymous access and defaults to a shared 'anonymous' user, allowing any unauthenticated user to create and operate a sandbox. This bypasses your documented requirement that sandbox execution endpoints require authentication and ownership verification.

const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
const userId = authResult.userId || 'anonymous';

Impact: Unauthenticated internet users can create WebContainer sessions, write files, and execute code in your sandbox environment.

Remediation: Require authentication and reject requests without a valid user identity.
Suggested change
const authResult = await resolveRequestAuth(req);

Additionally, remove the fallback to 'anonymous' and return 401 if authResult.userId is missing.

For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.
@quazfenton
app/api/sandbox/webcontainer/route.ts
      language: 'typescript',
      template: 'node',
    });

@corridor-security
corridor-security bot
yesterday

Using a fixed 'anonymous' userId with getOrCreateSession causes different unauthenticated users to share the same sandbox session, enabling cross-tenant interference and potential data leakage/overwrites.

const session = await sandboxBridge.getOrCreateSession(userId, {
  language: 'typescript',
  template: 'node',
});

Remediation: Use a verified authenticated userId only. Do not allow a shared 'anonymous' identity for sandbox sessions. If anonymous mode is truly required, generate a unique, unguessable per-request or per-client ID and strictly limit capabilities, but the safer approach is to require auth as per your guardrails.

For more details, see the [finding in Corridor](https://app.corridor.dev/projects/9b474c20-ed45-4b3a-ad03-b76d21c45b95/findings/c877853e-7d56-434e-a53e-c1100a7b8228).

**Provide feedback**: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.

@quazfenton
app/api/sandbox/webcontainer/route.ts
    sandbox.executeCommand(cmdToRun).catch(err => {
      logger.warn('Server command error:', err.message);
    });

@corridor-security
corridor-security bot
yesterday

Unauthenticated users can trigger arbitrary command execution inside the sandbox (npm install, and a user-supplied startCommand) without going through your existing command validation and ownership checks. This bypasses safeguards described in your project guardrails (e.g., validateSandboxCommand and sandbox ownership verification).

if (files['package.json']) {
  await sandbox.executeCommand('npm install');
}
...
const cmdToRun = startCommand || (files['package.json']?.includes('\"start\"') ? 'npm start' : 'node server.js');
...
sandbox.executeCommand(cmdToRun).catch(err => { ... });

For more details, see the [finding in Corridor](https://app.corridor.dev/projects/9b474c20-ed45-4b3a-ad03-b76d21c45b95/findings/2b6c07c6-8e24-4c86-9d67-9f05c07b4a97).

**Provide feedback**: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.

@quazfenton
lib/backend/websocket-terminal.ts
@@ -142,12 +148,13 @@ export class WebSocketTerminalServer extends EventEmitter {
      // In production, add sandbox ownership verification
@corridor-security
corridor-security bot
yesterday

The WebSocket connection is authenticated, but there is no authorization check to verify that the authenticated userId owns the requested sandboxId. This enables an attacker with any valid token to connect to and control another user's sandbox by guessing or enumerating sandboxId values (IDOR/cross-tenant access).

// After JWT verify, only checks for presence of userId but not ownership
const userId = (payload as any).userId || (payload as any).sub;
if (!userId) {
  ws.close(4002, 'Invalid token: missing user ID');
  return;
}
logger.info(`WebSocket connection authenticated: user=${userId}, sandbox=${sandboxId}`);

Remediation: Verify sandbox ownership before creating the terminal session. For example, look up the session/store for sandboxId and ensure it belongs to userId. Reject if not owned.

// Pseudocode
const session = await sandboxBridge.getSessionByUserId(userId);
if (!session || session.sandboxId !== sandboxId) {
  ws.close(4005, 'Unauthorized: sandbox not owned by user');
  return;
}

For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.
@quazfenton
lib/backend/websocket-terminal.ts
      ws.close(4004, 'Too many active sessions');
      return;
    }

    logger.debug(`Creating terminal session for sandbox ${sandboxId}`)
    this.createTerminalSession(ws, sandboxId);
  }

  private async createTerminalSession(ws: WebSocket, sandboxId: string): Promise<void> {
@corridor-security
corridor-security bot
yesterday

A host-level bash process is spawned for each terminal session. Input from the WebSocket is forwarded directly to this process, granting shell access on the application host under the server's privileges. This is authenticated remote code execution on the host, not within an isolated provider sandbox.

// Spawns bash directly on the host in the server process context
const proc = spawn('bash', ['-l'], {
  cwd: workspace,
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
  detached: true,
});

Remediation: Do not spawn shells on the host. Route terminal I/O through a sandbox provider (e.g., via TerminalManager and provider PTY APIs) that enforces isolation and per-user ownership. If a local shell must be used for development, explicitly disable it in production builds and ensure strict containment (container/VM, reduced privileges, seccomp/AppArmor, no host filesystem access).

For more details, see the finding in Corridor.

Provide feedback: Reply with whether this is a valid vulnerability or false positive to help improve Corridor's accuracy.
@quazfenton
cubic-dev-ai[bot]
cubic-dev-ai bot reviewed yesterday
@cubic-dev-ai
cubic-dev-ai bot
left a comment

25 issues found across 213 files

Note: This PR contains a large number of files. cubic only reviews up to 75 files per PR, so some files may not have been reviewed.
Prompt for AI agents (unresolved issues)

Reply with feedback, questions, or to request a fix. Tag @cubic-dev-ai to re-run a review.
app/api/filesystem/list/route.ts
/**
 * Track request frequency to detect polling loops
 */
function trackRequest(path: string): { isPolling: boolean; requestCount: number; windowMs: number } {
@cubic-dev-ai
cubic-dev-ai bot
yesterday
•

P0: Unbounded Map growth allows an unauthenticated memory exhaustion DoS attack. Implement a size limit to prevent out-of-memory errors.
Prompt for AI agents

Fix with Cubic
@quazfenton
app/api/sandbox/webcontainer/route.ts
    logger.info('Creating WebContainer', { userId, fileCount: Object.keys(files).length });

    // Create WebContainer sandbox via sandbox bridge
    // The provider internally uses: WebContainer.boot()
@cubic-dev-ai
cubic-dev-ai bot
yesterday
•

P0: The @webcontainer/api SDK is strictly a browser-based runtime and cannot be executed in a Node.js server environment.
Prompt for AI agents

Fix with Cubic
@quazfenton
V2_22DOARCHITECTURE.md
# ... existing user setup ...

# Install OpenCode agent binary
RUN curl -fsSL https://opencode.ai/install.sh | sh
@cubic-dev-ai
cubic-dev-ai bot
yesterday
•

P1: Avoid piping remote install scripts directly to sh; download a pinned installer and verify its checksum/signature before executing to reduce supply-chain risk during image builds.
Prompt for AI agents

Fix with Cubic
@quazfenton
app/api/sandbox/devbox/route.ts
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';
@cubic-dev-ai
cubic-dev-ai bot
yesterday
•

P1: Using a constant 'anonymous' userId makes all anonymous requests share the same sandbox session. That lets unrelated users read/write each other’s files. Generate a unique anon id (or require auth) to keep sessions isolated.
Prompt for AI agents

Fix with Cubic
@quazfenton
hooks/use-websocket-terminal.ts
Outdated
app/api/filesystem/delete/route.ts
      'Absolute paths must start with /home/ or /workspace/'
    ),
  ownerId: z.string().optional(),
  path: absolutePathSchema.refine(
@cubic-dev-ai
cubic-dev-ai bot
yesterday
•

P2: Using absolutePathSchema unconditionally blocks relative paths, breaking backwards compatibility. If relative paths should still be allowed, use pathSchema and restore the original prefix check.
Prompt for AI agents

Fix with Cubic
@quazfenton
app/api/chat/route.ts
Comment on lines +517 to +519
                await Promise.race([streamPromise, timeoutPromise]);

                if (agentTimeoutId) clearTimeout(agentTimeoutId);
@cubic-dev-ai
cubic-dev-ai bot
yesterday
•

P2: The agentTimeoutId is not cleared if streamPromise rejects, causing a timer leak.
Prompt for AI agents

Suggested change
                await Promise.race([streamPromise, timeoutPromise]);
                if (agentTimeoutId) clearTimeout(agentTimeoutId);
                try {
                  await Promise.race([streamPromise, timeoutPromise]);
                } finally {
                  if (agentTimeoutId) clearTimeout(agentTimeoutId);
                }
Fix with Cubic
@quazfenton
hooks/use-service-worker.ts
    // Don't register service worker in development - it causes reload loops
    if (isDevelopment) {
      console.log('[ServiceWorker] Skipping registration in development mode');
      return;
@cubic-dev-ai
cubic-dev-ai bot
yesterday
•

P3: The early return skips the online/offline event listeners and initial setIsOnline call, so isOnline will never update in development/local mode. Skip only the service worker registration instead of returning from the whole effect.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/api/chat-logger.ts
 *   - NODE_ENV: 'development' enables debug level by default
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
@cubic-dev-ai
cubic-dev-ai bot
yesterday
•

P3: LOG_LEVEL=silent is documented/used elsewhere, but this logger doesn’t support it, so setting silent will still emit info logs.
Prompt for AI agents

Fix with Cubic
@quazfenton
VERCEL_SANDBOX_PROVIDER.md
Outdated
ghost added 5 commits 19 hours ago
+++++F
f8b654d
+++++F
c497011
1
1eda3d2
Merge branch 'swiTCHUp' of https://github.com/quazfenton/binG into dev
97c0454
v2
1996590
codeant-ai bot
commented
16 hours ago

CodeAnt AI is running Incremental review
Thanks for using CodeAnt! 🎉

We're free for open-source projects. if you're enjoying it, help us grow by sharing.

Share on X ·
Reddit ·
LinkedIn
@codeant-ai codeant-ai bot added size:XXL and removed size:XXL labels 16 hours ago
@codeant-ai codeant-ai bot added the size:XXL label 3 hours ago
codeant-ai bot
commented
3 hours ago
Sequence Diagram

This PR changes the terminal and code preview to use OPFS-backed instant saves and an event-driven sync model, then routes manual previews through provider-specific sandboxes like WebContainer, Next.js, and CodeSandbox. The diagram shows how a terminal edit propagates through OPFS and the filesystem API to refresh the preview panel and launch an appropriate sandbox preview.

Generated by CodeAnt AI
codeant-ai[bot]
codeant-ai bot reviewed 2 hours ago
app/api/agent/v2/sync/route.ts
Comment on lines +84 to +87
    return NextResponse.json({
      success: result.success,
      data: result,
    });
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: In the sync endpoint, when direction is 'bidirectional' the result object returned by agentFSBridge.syncBidirectional does not have a success property, so result.success is always undefined and the API response lacks a meaningful success flag; instead, you should compute success from toSandbox.success and fromSandbox.success and return that. [logic error]
Severity Level: Major ⚠️

Suggested change
    return NextResponse.json({
      success: result.success,
      data: result,
    });
    const success =
      direction === 'bidirectional'
        ? result.toSandbox.success && result.fromSandbox.success
        : result.success;
    return NextResponse.json({
      success,
      data: result,
    });
Steps of Reproduction ✅








👍 | 👎
@quazfenton
app/api/chat/route.ts
Comment on lines +1843 to 1867
  const fileWriteFolderCreateOps = extractFileWriteFolderCreateTags(input.responseContent || '');
  const combinedWriteEdits = [
    ...extractTaggedFileEdits(input.responseContent || ''),
    ...extractFsActionWrites(input.responseContent || ''),
    ...extractBashHereDocWrites(input.responseContent || ''),
    ...extractFilenameHintCodeBlocks(input.responseContent || ''),
    ...fileWriteFolderCreateOps.writes.map(w => ({ path: w.path, content: w.content })),
  ];
  const combinedDiffOperations = [
    ...extractFencedDiffEdits(input.responseContent || ''),
    ...extractFsActionPatches(input.responseContent || ''),
    ...(input.commands?.write_diffs || []),
  ];
  const applyDiffOperations = extractApplyDiffOperations(input.responseContent || '');
  const deleteTargets = extractFsActionDeletes(input.responseContent || '');
  const folderCreateTargets = fileWriteFolderCreateOps.folders; // Separate folder creation targets
  const requestFiles = input.commands?.request_files || [];

  // Only create transaction if there are mutating operations (write/patch/delete)
  // Only create transaction if there are mutating operations (write/patch/delete/apply_diff)
  // This prevents memory leaks from accumulating no-op transactions
  const hasMutatingOperations =
    combinedWriteEdits.length > 0 ||
    combinedDiffOperations.length > 0 ||
    applyDiffOperations.length > 0 ||
    deleteTargets.length > 0;
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: Folder creation operations parsed from <folder_create> tags are never executed when there are no other write/patch/delete/apply_diff operations, because folderCreateTargets is not included in hasMutatingOperations, so no transaction is created and the folder creation loop is skipped, causing the API to silently ignore valid folder creation requests. The fix is to treat folder creation as a mutating operation by including folderCreateTargets.length > 0 in the hasMutatingOperations condition so that a transaction is created and the folder creation logic runs. [logic error]
Severity Level: Major ⚠️

Suggested change
  const fileWriteFolderCreateOps = extractFileWriteFolderCreateTags(input.responseContent || '');
  const combinedWriteEdits = [
    ...extractTaggedFileEdits(input.responseContent || ''),
    ...extractFsActionWrites(input.responseContent || ''),
    ...extractBashHereDocWrites(input.responseContent || ''),
    ...extractFilenameHintCodeBlocks(input.responseContent || ''),
    ...fileWriteFolderCreateOps.writes.map(w => ({ path: w.path, content: w.content })),
  ];
  const combinedDiffOperations = [
    ...extractFencedDiffEdits(input.responseContent || ''),
    ...extractFsActionPatches(input.responseContent || ''),
    ...(input.commands?.write_diffs || []),
  ];
  const applyDiffOperations = extractApplyDiffOperations(input.responseContent || '');
  const deleteTargets = extractFsActionDeletes(input.responseContent || '');
  const folderCreateTargets = fileWriteFolderCreateOps.folders; // Separate folder creation targets
  const requestFiles = input.commands?.request_files || [];
  // Only create transaction if there are mutating operations (write/patch/delete)
  // Only create transaction if there are mutating operations (write/patch/delete/apply_diff)
  // This prevents memory leaks from accumulating no-op transactions
  const hasMutatingOperations =
    combinedWriteEdits.length > 0 ||
    combinedDiffOperations.length > 0 ||
    applyDiffOperations.length > 0 ||
    deleteTargets.length > 0;
  const fileWriteFolderCreateOps = extractFileWriteFolderCreateTags(input.responseContent || '');
  const combinedWriteEdits = [
    ...extractTaggedFileEdits(input.responseContent || ''),
    ...extractFsActionWrites(input.responseContent || ''),
    ...extractBashHereDocWrites(input.responseContent || ''),
    ...extractFilenameHintCodeBlocks(input.responseContent || ''),
    ...fileWriteFolderCreateOps.writes.map(w => ({ path: w.path, content: w.content })),
  ];
  const combinedDiffOperations = [
    ...extractFencedDiffEdits(input.responseContent || ''),
    ...extractFsActionPatches(input.responseContent || ''),
    ...(input.commands?.write_diffs || []),
  ];
  const applyDiffOperations = extractApplyDiffOperations(input.responseContent || '');
  const deleteTargets = extractFsActionDeletes(input.responseContent || '');
  const folderCreateTargets = fileWriteFolderCreateOps.folders; // Separate folder creation targets
  const requestFiles = input.commands?.request_files || [];
  // Only create transaction if there are mutating operations (write/patch/delete/apply_diff/folder_create)
  // This prevents memory leaks from accumulating no-op transactions
  const hasMutatingOperations =
    combinedWriteEdits.length > 0 ||
    combinedDiffOperations.length > 0 ||
    applyDiffOperations.length > 0 ||
    deleteTargets.length > 0 ||
    folderCreateTargets.length > 0;
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
app/api/stateful-agent/route.ts
Comment on lines +207 to +222
        // Validate provider type to prevent runtime cast errors
        // Include all supported providers from the system
        const validProviders: SandboxProviderType[] = ['e2b', 'daytona', 'blaxel', 'sprites', 'codesandbox', 'microsandbox', 'mistral', 'webcontainer', 'opensandbox', 'vercel', 'codespaces'];
        const rawProvider = session.provider;
        const provider = (rawProvider && rawProvider.trim()) ? rawProvider as SandboxProviderType : null;

        if (!provider || !validProviders.includes(provider)) {
          console.warn(`[StatefulAgent API] Unknown or empty provider in session: "${rawProvider}"`);
          return NextResponse.json(
            { error: 'Sandbox provider not recognized' },
            { status: 400 }
          );
        }

        const sandboxProvider = await getSandboxProvider(provider);
        sandboxHandle = await sandboxProvider.getSandbox(sandboxId);
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: The new provider validation for stateful sandboxes hardcodes an incomplete/incorrect list of providers and relies solely on session.provider, which is not set by the workspace session code; this causes valid sandboxes (e.g., created via providers like runloop, webcontainer, opensandbox, or with no stored provider) to be rejected with a 400 "Sandbox provider not recognized" even though getSandboxProvider can resolve them using the sandbox ID. [logic error]
Severity Level: Critical 🚨

Suggested change
        // Validate provider type to prevent runtime cast errors
        // Include all supported providers from the system
        const validProviders: SandboxProviderType[] = ['e2b', 'daytona', 'blaxel', 'sprites', 'codesandbox', 'microsandbox', 'mistral', 'webcontainer', 'opensandbox', 'vercel', 'codespaces'];
        const rawProvider = session.provider;
        const provider = (rawProvider && rawProvider.trim()) ? rawProvider as SandboxProviderType : null;
        
        if (!provider || !validProviders.includes(provider)) {
          console.warn(`[StatefulAgent API] Unknown or empty provider in session: "${rawProvider}"`);
          return NextResponse.json(
            { error: 'Sandbox provider not recognized' },
            { status: 400 }
          );
        }
        
        const sandboxProvider = await getSandboxProvider(provider);
        sandboxHandle = await sandboxProvider.getSandbox(sandboxId);
        // Resolve provider type from session or sandbox ID and validate via getSandboxProvider
        const rawProvider = (session as any).provider as string | undefined;
        const inferredProvider =
          rawProvider && rawProvider.trim()
            ? rawProvider.trim()
            : sandboxBridge.inferProviderFromSandboxId(sandboxId);
        if (!inferredProvider) {
          console.warn(`[StatefulAgent API] Unable to determine provider for sandbox ${sandboxId}`);
          return NextResponse.json(
            { error: 'Sandbox provider not recognized' },
            { status: 400 }
          );
        }
        let sandboxProvider;
        try {
          sandboxProvider = await getSandboxProvider(inferredProvider as SandboxProviderType);
        } catch (error: any) {
          console.warn(
            `[StatefulAgent API] Failed to initialize provider ${inferredProvider} for sandbox ${sandboxId}: ${error?.message || error}`,
          );
          return NextResponse.json(
            { error: 'Sandbox provider not recognized' },
            { status: 400 }
          );
        }
        sandboxHandle = await sandboxProvider.getSandbox(sandboxId);
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/agent/agent-session-manager.ts
Comment on lines +283 to +284
      // Ensure workspace directory exists
      await sandbox.executeCommand(`mkdir -p ${workspacePath}`);
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: The workspace path composed from userId and conversationId is interpolated directly into a shell command (mkdir -p ${workspacePath}) without any escaping, which can both break directory creation for IDs containing spaces or shell metacharacters and open a command injection vector if those values are ever attacker-controlled. [security]
Severity Level: Critical 🚨

Suggested change
      // Ensure workspace directory exists
      await sandbox.executeCommand(`mkdir -p ${workspacePath}`);
      // Ensure workspace directory exists
      const safeWorkspacePath = workspacePath.replace(/"/g, '\\"');
      await sandbox.executeCommand(`mkdir -p "${safeWorkspacePath}"`);
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/agent/v2-executor.ts
Comment on lines +51 to +54
  // Sync back after OpenCode execution
  if (result.agent === 'opencode') {
    await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
  }
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: When the CLI agent runs inside the sandbox via the V2 executor, any filesystem changes it makes are never synced back into the virtual filesystem because executeV2Task only calls agentFSBridge.syncFromSandbox for the opencode agent, so CLI-driven edits are silently discarded; extend the condition so CLI results also trigger a sync. [logic error]
Severity Level: Critical 🚨

Suggested change
  // Sync back after OpenCode execution
  if (result.agent === 'opencode') {
    await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
  }
  // Sync back after agents that can mutate the sandbox workspace (OpenCode and CLI)
  if (result.agent === 'opencode' || result.agent === 'cli') {
    await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
  }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/agent/v2-executor.ts
Comment on lines +115 to +117
        if (result.agent === 'opencode') {
          await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
        }
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: The streaming V2 executor similarly only syncs the sandbox back to the virtual filesystem when the agent is opencode, so CLI agent runs in streaming mode will lose any file changes they make; broaden the sync condition to include the CLI agent to keep the VFS consistent. [logic error]
Severity Level: Critical 🚨

Suggested change
        if (result.agent === 'opencode') {
          await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
        }
        if (result.agent === 'opencode' || result.agent === 'cli') {
          await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
        }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/api/opencode-v2-session-manager.ts
Comment on lines +163 to +335
          return session;
        }
      }
    }
    return undefined;
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): OpenCodeV2Session[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];

    const sessions: OpenCodeV2Session[] = [];
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session && Date.now() - session.lastActivity <= SESSION_TTL_MS) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * Update session sandbox info
   */
  setSandbox(sessionId: string, sandboxId: string, provider: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sandboxId = sandboxId;
      session.sandboxProvider = provider;
      session.status = 'active';
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update session Nullclaw endpoint
   */
  setNullclawEndpoint(sessionId: string, endpoint: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.nullclawEndpoint = endpoint;
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update session MCP server URL
   */
  setMcpServerUrl(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.mcpServerUrl = url;
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update activity timestamp
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      if (session.status === 'idle') {
        session.status = 'active';
      }
    }
  }

  /**
   * Record session metrics
   */
  recordMetrics(
    sessionId: string, 
    steps: number = 0, 
    bashCommands: number = 0, 
    fileChanges: number = 0,
    computeTimeMs: number = 0,
    storageBytes: number = 0
  ): void {
    const metrics = this.sessionMetrics.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (metrics) {
      metrics.steps += steps;
      metrics.bashCommands += bashCommands;
      metrics.fileChanges += fileChanges;
      metrics.computeTimeMs += computeTimeMs;
      metrics.storageBytes += storageBytes;
    }

    if (session) {
      session.totalSteps += steps;
      session.totalBashCommands += bashCommands;
      session.totalFileChanges += fileChanges;
      session.quota.computeUsed += computeTimeMs / 60000; // Convert to minutes
      session.quota.storageUsed += storageBytes;
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: The global compute quota is effectively never enforced because globalQuota.computeUsed is never updated anywhere, and the exhaustion check compares minutes (computeUsed) against milliseconds (computeMinutes * 60 * 1000), so the threshold is off by a factor of 60,000 and will never be reached in practice. Update recordMetrics to increment globalQuota.computeUsed/storageUsed in the same units as per-session quotas, and fix the comparison in createSession to compare minutes to minutes so that global quota enforcement actually works. [logic error]
Severity Level: Major ⚠️

Suggested change
    // Check global quota
    if (this.enableQuotaEnforcement && this.globalQuota.computeUsed >= this.globalQuota.computeMinutes * 60 * 1000) {
      throw new Error('Global compute quota exhausted');
    }
    const sessionId = `v2-${uuidv4()}`;
    const workspaceDir = config.workspaceDir || `/workspace/users/${userId}/sessions/${conversationId}`;
    
    const session: OpenCodeV2Session = {
      id: sessionId,
      userId,
      conversationId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'starting',
      workspaceDir,
      nullclawEnabled: config.enableNullclaw ?? false,
      mcpEnabled: config.enableMcp ?? true,
      quota: {
        ...DEFAULT_QUOTA,
        ...config.quota,
      },
      totalSteps: 0,
      totalBashCommands: 0,
      totalFileChanges: 0,
      checkpointCount: 0,
    };
    // Track session
    this.sessions.set(sessionId, session);
    
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(sessionId);
    
    this.sessionMetrics.set(sessionId, {
      steps: 0,
      bashCommands: 0,
      fileChanges: 0,
      computeTimeMs: 0,
      apiCalls: 0,
      storageBytes: 0,
    });
    logger.info(`Created V2 session ${sessionId} for user ${userId}, conversation ${conversationId}`);
    
    return session;
  }
  /**
   * Get session by ID
   */
  getSession(sessionId: string): OpenCodeV2Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    
    // Check TTL
    if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
      this.stopSession(sessionId);
      return undefined;
    }
    
    return session;
  }
  /**
   * Get session by user and conversation
   */
  findSessionByConversation(userId: string, conversationId: string): OpenCodeV2Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.conversationId === conversationId) {
        if (Date.now() - session.lastActivity <= SESSION_TTL_MS) {
          return session;
        }
      }
    }
    return undefined;
  }
  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): OpenCodeV2Session[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];
    
    const sessions: OpenCodeV2Session[] = [];
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session && Date.now() - session.lastActivity <= SESSION_TTL_MS) {
        sessions.push(session);
      }
    }
    return sessions;
  }
  /**
   * Update session sandbox info
   */
  setSandbox(sessionId: string, sandboxId: string, provider: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sandboxId = sandboxId;
      session.sandboxProvider = provider;
      session.status = 'active';
      this.updateActivity(sessionId);
    }
  }
  /**
   * Update session Nullclaw endpoint
   */
  setNullclawEndpoint(sessionId: string, endpoint: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.nullclawEndpoint = endpoint;
      this.updateActivity(sessionId);
    }
  }
  /**
   * Update session MCP server URL
   */
  setMcpServerUrl(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.mcpServerUrl = url;
      this.updateActivity(sessionId);
    }
  }
  /**
   * Update activity timestamp
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      if (session.status === 'idle') {
        session.status = 'active';
      }
    }
  }
  /**
   * Record session metrics
   */
  recordMetrics(
    sessionId: string, 
    steps: number = 0, 
    bashCommands: number = 0, 
    fileChanges: number = 0,
    computeTimeMs: number = 0,
    storageBytes: number = 0
  ): void {
    const metrics = this.sessionMetrics.get(sessionId);
    const session = this.sessions.get(sessionId);
    
    if (metrics) {
      metrics.steps += steps;
      metrics.bashCommands += bashCommands;
      metrics.fileChanges += fileChanges;
      metrics.computeTimeMs += computeTimeMs;
      metrics.storageBytes += storageBytes;
    }
    
    if (session) {
      session.totalSteps += steps;
      session.totalBashCommands += bashCommands;
      session.totalFileChanges += fileChanges;
      session.quota.computeUsed += computeTimeMs / 60000; // Convert to minutes
      session.quota.storageUsed += storageBytes;
    // Check global quota (minutes used vs minutes available)
    if (this.enableQuotaEnforcement && this.globalQuota.computeUsed >= this.globalQuota.computeMinutes) {
      throw new Error('Global compute quota exhausted');
    }
    const sessionId = `v2-${uuidv4()}`;
    const workspaceDir = config.workspaceDir || `/workspace/users/${userId}/sessions/${conversationId}`;
    
    const session: OpenCodeV2Session = {
      id: sessionId,
      userId,
      conversationId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'starting',
      workspaceDir,
      nullclawEnabled: config.enableNullclaw ?? false,
      mcpEnabled: config.enableMcp ?? true,
      quota: {
        ...DEFAULT_QUOTA,
        ...config.quota,
      },
      totalSteps: 0,
      totalBashCommands: 0,
      totalFileChanges: 0,
      checkpointCount: 0,
    };
    // Track session
    this.sessions.set(sessionId, session);
    
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(sessionId);
    
    this.sessionMetrics.set(sessionId, {
      steps: 0,
      bashCommands: 0,
      fileChanges: 0,
      computeTimeMs: 0,
      apiCalls: 0,
      storageBytes: 0,
    });
    logger.info(`Created V2 session ${sessionId} for user ${userId}, conversation ${conversationId}`);
    
    return session;
  }
  /**
   * Record session metrics
   */
  recordMetrics(
    sessionId: string, 
    steps: number = 0, 
    bashCommands: number = 0, 
    fileChanges: number = 0,
    computeTimeMs: number = 0,
    storageBytes: number = 0
  ): void {
    const metrics = this.sessionMetrics.get(sessionId);
    const session = this.sessions.get(sessionId);
    
    if (metrics) {
      metrics.steps += steps;
      metrics.bashCommands += bashCommands;
      metrics.fileChanges += fileChanges;
      metrics.computeTimeMs += computeTimeMs;
      metrics.storageBytes += storageBytes;
    }
    
    if (session) {
      session.totalSteps += steps;
      session.totalBashCommands += bashCommands;
      session.totalFileChanges += fileChanges;
      const computeDeltaMinutes = computeTimeMs / 60000; // ms -> minutes
      session.quota.computeUsed += computeDeltaMinutes;
      session.quota.storageUsed += storageBytes;
      // Track against global quota as well
      this.globalQuota.computeUsed += computeDeltaMinutes;
      this.globalQuota.storageUsed += storageBytes;
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/api/opencode-v2-session-manager.ts
Comment on lines +397 to +413
  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'stopping';

    // TODO: Stop sandbox if exists
    // TODO: Stop Nullclaw if running

    session.status = 'stopped';
    session.lastActivity = Date.now();

    logger.info(`Stopped session ${sessionId}`);
  }
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: Stopped sessions continue to occupy per-user slots because stopSession only updates status and timestamps but never removes the session ID from sessions or userSessions, so once a user reaches the maximum session count they can never create new sessions even if old ones are stopped. Adjust stopSession to delete the stopped session from both tracking maps so that per-user session limits are correctly freed and memory does not grow unbounded. [logic error]
Severity Level: Critical 🚨

Suggested change
  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'stopping';
    
    // TODO: Stop sandbox if exists
    // TODO: Stop Nullclaw if running
    
    session.status = 'stopped';
    session.lastActivity = Date.now();
    
    logger.info(`Stopped session ${sessionId}`);
  }
  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'stopping';
  
    // TODO: Stop sandbox if exists
    // TODO: Stop Nullclaw if running
  
    session.status = 'stopped';
    session.lastActivity = Date.now();
    // Remove from tracking maps so per-user limits and memory are freed
    this.sessions.delete(sessionId);
    const userSessionIds = this.userSessions.get(session.userId);
    if (userSessionIds) {
      userSessionIds.delete(sessionId);
      if (userSessionIds.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }
  
    logger.info(`Stopped session ${sessionId}`);
  }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/mcp/nullclaw-mcp-bridge.ts
Comment on lines +451 to +477
  releaseSession(sessionId: string): void {
    const containerId = this.sessionToContainer.get(sessionId);
    if (containerId) {
      this.sessionToContainer.delete(sessionId);

      // Check if container can be stopped (not in use by other sessions)
      let inUse = false;
      for (const [, cid] of this.sessionToContainer) {
        if (cid === containerId) {
          inUse = true;
          break;
        }
      }

      if (!inUse) {
        const container = this.containerPool.get(containerId);
        if (container && container.status === 'ready') {
          // Keep container warm for a bit, then stop
          setTimeout(() => {
            if (!this.sessionToContainer.has(sessionId)) {
              nullclawIntegration.stopContainer(containerId).catch(logger.error);
              this.containerPool.delete(containerId);
            }
          }, 60000); // 1 minute cooldown
        }
      }
    }
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: The releaseSession cooldown currently only checks whether the original sessionId is still present in sessionToContainer before stopping a container, so if a new session is mapped to the same containerId during the 60-second delay, the container will still be stopped and removed from the pool while another session is actively using it; the delayed check should instead verify whether any session is mapped to that containerId before stopping it. [race condition]
Severity Level: Major ⚠️

Suggested change
  releaseSession(sessionId: string): void {
    const containerId = this.sessionToContainer.get(sessionId);
    if (containerId) {
      this.sessionToContainer.delete(sessionId);
      
      // Check if container can be stopped (not in use by other sessions)
      let inUse = false;
      for (const [, cid] of this.sessionToContainer) {
        if (cid === containerId) {
          inUse = true;
          break;
        }
      }
      
      if (!inUse) {
        const container = this.containerPool.get(containerId);
        if (container && container.status === 'ready') {
          // Keep container warm for a bit, then stop
          setTimeout(() => {
            if (!this.sessionToContainer.has(sessionId)) {
              nullclawIntegration.stopContainer(containerId).catch(logger.error);
              this.containerPool.delete(containerId);
            }
          }, 60000); // 1 minute cooldown
        }
      }
    }
  releaseSession(sessionId: string): void {
    const containerId = this.sessionToContainer.get(sessionId);
    if (containerId) {
      this.sessionToContainer.delete(sessionId);
    
      // Check if container can be stopped (not in use by other sessions)
      let inUse = false;
      for (const [, cid] of this.sessionToContainer) {
        if (cid === containerId) {
          inUse = true;
          break;
        }
      }
    
      if (!inUse) {
        const container = this.containerPool.get(containerId);
        if (container && container.status === 'ready') {
          // Keep container warm for a bit, then stop
          setTimeout(() => {
            const stillInUse = Array.from(this.sessionToContainer.values()).some(
              mappedId => mappedId === containerId
            );
            if (!stillInUse) {
              nullclawIntegration.stopContainer(containerId).catch(logger.error);
              this.containerPool.delete(containerId);
            }
          }, 60000); // 1 minute cooldown
        }
      }
    }
  }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/sandbox/providers/opencode-v2-provider.ts
Comment on lines +167 to +171
      const result = await this.sandboxHandle.executeCommand(
        `OPENCODE_SYSTEM_PROMPT='${(systemPrompt || '').replace(/'/g, "'\\''")}' cat ${promptFile} | opencode chat --json ${modelFlag}`.trim(),
        this.currentSession.workspaceDir,
        PROCESS_TIMEOUT_MS / 1000,
      );
@codeant-ai
codeant-ai bot
2 hours ago

Suggestion: The environment variable intended to configure the system prompt for the opencode CLI is only applied to the cat process in the pipeline (VAR=... cat ... | opencode ...), so opencode itself never sees OPENCODE_SYSTEM_PROMPT, meaning the model will ignore the configured system prompt and behave incorrectly. The fix is to apply OPENCODE_SYSTEM_PROMPT to the opencode process (e.g. by using input redirection instead of a pipe). [logic error]
Severity Level: Major ⚠️

Suggested change
      const result = await this.sandboxHandle.executeCommand(
        `OPENCODE_SYSTEM_PROMPT='${(systemPrompt || '').replace(/'/g, "'\\''")}' cat ${promptFile} | opencode chat --json ${modelFlag}`.trim(),
        this.currentSession.workspaceDir,
        PROCESS_TIMEOUT_MS / 1000,
      );
      const escapedSystemPrompt = (systemPrompt || '').replace(/'/g, "'\\''");
      const command = `OPENCODE_SYSTEM_PROMPT='${escapedSystemPrompt}' opencode chat --json ${modelFlag} < ${promptFile}`.trim();
      const result = await this.sandboxHandle.executeCommand(
        command,
        this.currentSession.workspaceDir,
        PROCESS_TIMEOUT_MS / 1000,
      );
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
codeant-ai bot
commented
2 hours ago

CodeAnt AI Incremental review completed.
cubic-dev-ai[bot]
cubic-dev-ai bot reviewed 2 hours ago
@cubic-dev-ai
cubic-dev-ai bot
left a comment

40 issues found across 54 files (changes from recent commits).
Prompt for AI agents (unresolved issues)

Reply with feedback, questions, or to request a fix. Tag @cubic-dev-ai to re-run a review.
lib/agent/nullclaw-integration.ts
    const sessionKey = `${userId}:${conversationId}`;
    const containerId = this.sessionContainers.get(sessionKey);
    const container =
      (containerId && this.containers.get(containerId)) ||
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P0: Falling back to any ready container breaks environment isolation in per-session mode, potentially exposing other users' sandbox data.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/agent/nullclaw-integration.ts
          throw new Error('Nullclaw per-session container limit reached');
        }

        const port = (nullclawConfig.basePort || 3001) + this.containers.size;
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: Using this.containers.size for port allocation and capacity checks causes port conflicts, race conditions, and permanent capacity exhaustion.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/agent/agent-session-manager.ts
    // Check TTL
    if (Date.now() - session.lastActiveAt.getTime() > this.TTL_MS) {
      logger.warn(`Session ${sessionId} expired, removing`);
      this.sessionsById.delete(sessionId);
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: Expired sessions in getSessionById are removed from maps without running cleanup, which skips sandbox/V2 shutdown and can leak resources.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/api/opencode-v2-session-manager.ts
    // TODO: Stop sandbox if exists
    // TODO: Stop Nullclaw if running

    session.status = 'stopped';
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: Stopped sessions are never removed from tracking maps, so cleanup does not free per-user session capacity.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/agent/workforce-state.ts
      return { ...DEFAULT_STATE, updatedAt: new Date().toISOString() };
    }
    return parsed;
  } catch {
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: The broad catch block resets and overwrites state for any read/parse error, which can silently wipe existing tasks on malformed YAML or transient storage failures.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/sandbox/cloud-fs-manager.ts
    }

    try {
      const result = await this.activeHandle.writeFile(path, content);
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: Successful writes do not invalidate syncCache, so getSnapshot can return stale data for up to 30 seconds after a write.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/sandbox/cloud-agent-spawner.ts
Comment on lines +288 to +289
        await this.stopAgent(agentId);
        stopped++;
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: Increment the idle-cleanup counter only when stopAgent succeeds.
Prompt for AI agents

Suggested change
        await this.stopAgent(agentId);
        stopped++;
        const result = await this.stopAgent(agentId);
        if (result.success) {
          stopped++;
        }
Fix with Cubic
@quazfenton
lib/mcp/architecture-integration.ts

  const serverStatuses = rawStatuses.map(s => {
    const state = s.info?.state;
    const connected = state === 'connected' || state === 'connecting';
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: connecting is being reported as connected, which makes health status claim readiness before MCP connections are fully established.
Prompt for AI agents

Suggested change
    const connected = state === 'connected' || state === 'connecting';
    const connected = state === 'connected';
Fix with Cubic
@quazfenton
lib/sandbox/cloud-fs-manager.ts
    const targetProvider = provider || this.getBestProvider();

    if (targetProvider === 'local') {
      logger.debug('CloudFS: Using local VFS fallback');
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: Local fallback does not set activeProvider, so local mode repeatedly reconnects and provider state is misreported.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/mcp/nullclaw-mcp-bridge.ts
class NullclawMCPBridge {
  private config: NullclawBridgeConfig;
  private containerPool: Map<string, NullclawContainer> = new Map();
  private taskQueue: Map<string, NullclawTask> = new Map();
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P3: taskQueue is dead state (never written), making queue metrics misleading and adding unused maintenance surface.
Prompt for AI agents

Fix with Cubic
@quazfenton
ghost added 2 commits 2 hours ago
dawIRe
8b0b806
dawIRe
22bf0f3
cubic-dev-ai[bot]
cubic-dev-ai bot reviewed 2 hours ago
@cubic-dev-ai
cubic-dev-ai bot
left a comment

22 issues found across 21 files (changes from recent commits).
Prompt for AI agents (unresolved issues)

Reply with feedback, questions, or to request a fix. Tag @cubic-dev-ai to re-run a review.
components/message-bubble.tsx

  // Apply artifact to filesystem
  const handleApplyArtifact = useCallback(async (artifact: CodeArtifact) => {
    if (!artifact.content || applyingArtifact) return;
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: Artifact apply currently only supports non-empty writes, so delete operations and empty-file artifacts cannot be applied correctly.
Prompt for AI agents

Fix with Cubic
@quazfenton
lib/agent/task-router.ts
Comment on lines +261 to +271
          if (path) {
            if (step.toolName === 'Bash' && args.command) {
              // Extract file paths from bash commands like "echo > file.txt"
              const match = args.command.match(/(?:>\s*|tee\s+|cat\s*>\s*)([^\s|]+)/);
              if (match) {
                fileChanges.push({ path: match[1], action: 'modify' });
              }
            } else {
              fileChanges.push({ path, action: step.toolName === 'delete_file' ? 'delete' : 'modify' });
            }
          }
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: Bash-based file writes are missed because Bash command parsing is incorrectly nested under if (path).
Prompt for AI agents

Suggested change
          if (path) {
            if (step.toolName === 'Bash' && args.command) {
              // Extract file paths from bash commands like "echo > file.txt"
              const match = args.command.match(/(?:>\s*|tee\s+|cat\s*>\s*)([^\s|]+)/);
              if (match) {
                fileChanges.push({ path: match[1], action: 'modify' });
              }
            } else {
              fileChanges.push({ path, action: step.toolName === 'delete_file' ? 'delete' : 'modify' });
            }
          }
          if (step.toolName === 'Bash' && args.command) {
            // Extract file paths from bash commands like "echo > file.txt"
            const match = args.command.match(/(?:>\s*|tee\s+|cat\s*>\s*)([^\s|]+)/);
            if (match) {
              fileChanges.push({ path: match[1], action: 'modify' });
            }
          } else if (path) {
            fileChanges.push({ path, action: step.toolName === 'delete_file' ? 'delete' : 'modify' });
          }
Fix with Cubic
@quazfenton
components/interaction-panel.tsx
@@ -411,7 +456,7 @@ export default function InteractionPanel({
    }
  }, []);
  // Virtual filesystem integration
  const virtualFilesystem = useVirtualFilesystem("project");
  const virtualFilesystem = useVirtualFilesystem(filesystemScopePath || "project");
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: Changing VFS scope without clearing attached files leaks stale attachments across scopes/chats. Reset attached files when filesystemScopePath changes.
Prompt for AI agents

Fix with Cubic
@quazfenton
components/conversation-interface.tsx
Comment on lines +94 to +96
  if (stripped.startsWith("project/")) {
    return stripped;
  }
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: normalizeScopedPath lets project/... paths bypass the active session scope, so command diffs can be written outside the current conversation’s filesystem scope.
Prompt for AI agents

Suggested change
  if (stripped.startsWith("project/")) {
    return stripped;
  }
  if (stripped.startsWith("project/")) {
    return scope === "project" ? stripped : `${scope}/${stripped.slice("project/".length)}`.replace(/\/{2,}/g, "/");
  }
Fix with Cubic
@quazfenton
components/conversation-interface.tsx

      let nextContent =
        applyUnifiedDiffToContent(currentContent, resolvedPath, entry.diff) ??
        applySimpleLineDiff(currentContent, entry.diff);
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P1: Fallbacking to applySimpleLineDiff can corrupt files by replacing full file content with only the diff snippet when unified patching fails.
Prompt for AI agents

Fix with Cubic
@quazfenton
__tests__/cloud-agent-preview-integration.test.ts
@@ -0,0 +1,272 @@
/**
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: The E2B cost test is masked by a Daytona fallback, so it can pass without exercising any E2B cost path.
Prompt for AI agents

Fix with Cubic
@quazfenton
__tests__/v2-mcp-integration.test.ts
@@ -0,0 +1,248 @@
/**
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: The assertion only checks type, not that releaseSession changed state.
Prompt for AI agents

Fix with Cubic
@quazfenton
__tests__/v2-mcp-integration.test.ts
@@ -0,0 +1,248 @@
/**
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: This assertion is too weak for the behavior under test; >= 0 can pass even when no sessions are tracked.
Prompt for AI agents

Fix with Cubic
@quazfenton
__tests__/v2-mcp-integration.test.ts
@@ -0,0 +1,248 @@
/**
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: Restore NULLCLAW_ENABLED after each test to avoid cross-test environment leakage.
Prompt for AI agents

Fix with Cubic
@quazfenton
components/code-preview-panel.tsx
        if (manualPreviewActiveRef.current) {
          const manualPath = manualPreviewPathRef.current || filesystemScopePathRef.current || normalizedScopePath;
          log(`[filesystem-updated] refreshing manual preview from "${manualPath}"`);
          await handleManualPreview(manualPath);
@cubic-dev-ai
cubic-dev-ai bot
2 hours ago
•

P2: Background filesystem refresh reuses handleManualPreview, which triggers interactive UI side effects (tab switch + toast) on every filesystem-updated event. This causes disruptive tab jumps and notification spam during normal file updates.
Prompt for AI agents

Fix with Cubic
@quazfenton
mobile
12e8e32
codeant-ai bot
commented
2 hours ago

CodeAnt AI is running Incremental review
Thanks for using CodeAnt! 🎉

We're free for open-source projects. if you're enjoying it, help us grow by sharing.

Share on X ·
Reddit ·
LinkedIn
@codeant-ai codeant-ai bot added size:XXL and removed size:XXL labels 2 hours ago
codeant-ai bot
commented
2 hours ago
Sequence Diagram

This diagram shows how chat requests are routed into the new Agent V2 pipeline and how terminal file edits now sync through OPFS and filesystem events to update the code preview panel.

Generated by CodeAnt AI
cubic-dev-ai[bot]
cubic-dev-ai bot reviewed 1 hour ago
@cubic-dev-ai
cubic-dev-ai bot
left a comment

1 issue found across 1 file (changes from recent commits).
Prompt for AI agents (unresolved issues)

Reply with feedback, questions, or to request a fix. Tag @cubic-dev-ai to re-run a review.
.github/workflows/jarvis.yml
          # SECURITY: Anchored regex with optional [bot] suffix to prevent substring matches
          BOT_PATTERN="^(coderabbitai|qodo-code-review|cubic-dev-ai|codeant-ai)(\\[bot\\])?$"
          # Note: jq regex doesn't need escape for literal brackets, use [bot] directly
          BOT_PATTERN='^(coderabbitai|qodo-code-review|cubic-dev-ai|codeant-ai)([bot])?$'
@cubic-dev-ai
cubic-dev-ai bot
1 hour ago
•

P2: The bot-login regex is incorrect: ([bot])? matches one character, not the literal [bot] suffix, so trusted [bot] accounts may be skipped.
Prompt for AI agents

Suggested change
          BOT_PATTERN='^(coderabbitai|qodo-code-review|cubic-dev-ai|codeant-ai)([bot])?$'
          BOT_PATTERN='^(coderabbitai|qodo-code-review|cubic-dev-ai|codeant-ai)(\[bot\])?$'
Fix with Cubic
@quazfenton
codeant-ai[bot]
codeant-ai bot reviewed 1 hour ago
app/api/chat/route.ts
Comment on lines +440 to +451
              const result = await processUnifiedAgentRequest(config);
              sendStep('Start agentic pipeline', 'completed');
              sendEvent('done', {
                success: result.success,
                content: result.response,
                messageMetadata: {
                  agent: 'unified',
                  mode: result.mode,
                  processingSteps,
                },
                data: result,
              });
@codeant-ai
codeant-ai bot
1 hour ago

Suggestion: The step-tracking for the agentic pipeline always records the final "Start agentic pipeline" step as completed even when processUnifiedAgentRequest returns success: false, which will mislead any consumer of processingSteps into thinking the pipeline succeeded when it actually failed; you should derive the step status from the actual result.success value. [logic error]
Severity Level: Major ⚠️

Suggested change
              const result = await processUnifiedAgentRequest(config);
              sendStep('Start agentic pipeline', 'completed');
              sendEvent('done', {
                success: result.success,
                content: result.response,
                messageMetadata: {
                  agent: 'unified',
                  mode: result.mode,
                  processingSteps,
                },
                data: result,
              });
              const result = await processUnifiedAgentRequest(config);
              sendStep('Start agentic pipeline', result.success ? 'completed' : 'failed');
              sendEvent('done', {
                success: result.success,
                content: result.response,
                messageMetadata: {
                  agent: 'unified',
                  mode: result.mode,
                  processingSteps,
                },
                data: result,
              });
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
components/conversation-interface.tsx
Comment on lines +875 to +883
    setCommandsByFile((prev) => {
      const next: Record<string, string[]> = {};
      for (const [path, diffs] of Object.entries(prev)) {
        const remaining = failed[path] || [];
        if (remaining.length > 0) {
          next[path] = remaining;
        }
      }
      return next;
@codeant-ai
codeant-ai bot
1 hour ago

Suggestion: The logic that updates commandsByFile after applying diffs only keeps entries that failed (failed[path]) and discards all other paths, so when you apply diffs for one file, any pending diffs for other files are unintentionally wiped out; the state update needs to distinguish between paths that were attempted in this call and untouched paths, preserving the latter. [logic error]
Severity Level: Major ⚠️

Suggested change
    setCommandsByFile((prev) => {
      const next: Record<string, string[]> = {};
      for (const [path, diffs] of Object.entries(prev)) {
        const remaining = failed[path] || [];
        if (remaining.length > 0) {
          next[path] = remaining;
        }
      }
      return next;
    setCommandsByFile((prev) => {
      const attemptedPaths = new Set(entries.map((entry) => entry.path));
      const next: Record<string, string[]> = {};
      for (const [path, diffs] of Object.entries(prev)) {
        const remaining = failed[path] || [];
        if (attemptedPaths.has(path)) {
          if (remaining.length > 0) {
            next[path] = remaining;
          }
        } else {
          next[path] = diffs;
        }
      }
      return next;
    });
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/agent/task-router.ts
Comment on lines +253 to +274
    // Extract file changes from V2 agent steps
    const fileChanges: Array<{ path: string; action: string; content?: string }> = [];
    if (result.steps) {
      for (const step of result.steps) {
        // Look for file operation tool calls in steps
        if (step.toolName && ['write_file', 'read_file', 'delete_file', 'edit_file', 'Bash'].includes(step.toolName)) {
          const args = step.args || {};
          const path = args.path || args.file || args.target || '';
          if (path) {
            if (step.toolName === 'Bash' && args.command) {
              // Extract file paths from bash commands like "echo > file.txt"
              const match = args.command.match(/(?:>\s*|tee\s+|cat\s*>\s*)([^\s|]+)/);
              if (match) {
                fileChanges.push({ path: match[1], action: 'modify' });
              }
            } else {
              fileChanges.push({ path, action: step.toolName === 'delete_file' ? 'delete' : 'modify' });
            }
          }
        }
      }
    }
@codeant-ai
codeant-ai bot
1 hour ago

Suggestion: In the V2 OpenCode path, fileChanges synthesized from result.steps only include an action field, but downstream code that turns these into codeArtifacts reads operation, so all changes are treated as default 'write' and delete operations are not correctly surfaced to the UI. [logic error]
Severity Level: Major ⚠️

Suggested change
    // Extract file changes from V2 agent steps
    const fileChanges: Array<{ path: string; action: string; content?: string }> = [];
    if (result.steps) {
      for (const step of result.steps) {
        // Look for file operation tool calls in steps
        if (step.toolName && ['write_file', 'read_file', 'delete_file', 'edit_file', 'Bash'].includes(step.toolName)) {
          const args = step.args || {};
          const path = args.path || args.file || args.target || '';
          if (path) {
            if (step.toolName === 'Bash' && args.command) {
              // Extract file paths from bash commands like "echo > file.txt"
              const match = args.command.match(/(?:>\s*|tee\s+|cat\s*>\s*)([^\s|]+)/);
              if (match) {
                fileChanges.push({ path: match[1], action: 'modify' });
              }
            } else {
              fileChanges.push({ path, action: step.toolName === 'delete_file' ? 'delete' : 'modify' });
            }
          }
        }
      }
    }
    // Extract file changes from V2 agent steps
    const fileChanges: Array<{ path: string; action: string; operation: 'write' | 'patch' | 'delete'; content?: string }> = [];
    if (result.steps) {
      for (const step of result.steps) {
        // Look for file operation tool calls in steps
        if (step.toolName && ['write_file', 'read_file', 'delete_file', 'edit_file', 'Bash'].includes(step.toolName)) {
          const args = step.args || {};
          const path = args.path || args.file || args.target || '';
          if (path) {
            if (step.toolName === 'Bash' && args.command) {
              // Extract file paths from bash commands like "echo > file.txt"
              const match = args.command.match(/(?:>\s*|tee\s+|cat\s*>\s*)([^\s|]+)/);
              if (match) {
                fileChanges.push({
                  path: match[1],
                  action: 'modify',
                  operation: 'patch',
                });
              }
            } else {
              const isDelete = step.toolName === 'delete_file';
              fileChanges.push({
                path,
                action: isDelete ? 'delete' : 'modify',
                operation: isDelete ? 'delete' : 'write',
              });
            }
          }
        }
      }
    }
Steps of Reproduction ✅

Prompt for AI Agent 🤖

👍 | 👎
@quazfenton
lib/agent/v2-executor.ts
Comment on lines +190 to +200
        if (result.fileChanges && result.fileChanges.length > 0) {
          messageMetadata.codeArtifacts = result.fileChanges.map((fc: any) => ({
            path: fc.path,
            operation: fc.operation || 'write',
            language: fc.language || 'typescript',
            content: fc.content || '',
            previousContent: fc.previousContent || fc.oldContent || undefined,
            newVersion: fc.newVersion,
            previousVersion: fc.previousVersion,
          }));
        }
@codeant-ai
codeant-ai bot
1 hour ago

Suggestion: When building codeArtifacts from result.fileChanges, the code always falls back to 'write' when fc.operation is missing and ignores the fc.action field that TaskRouter/OpenCode produce. This means deletes and in-place modifications are misclassified as writes in the UI, so deletions may show with the wrong icon/state and any logic that depends on the operation type will behave incorrectly. Map action to the operation union ('write' | 'patch' | 'delete' | 'read') instead of defaulting everything to 'write'. [logic error]
Severity Level: Major ⚠️

Suggested change
        if (result.fileChanges && result.fileChanges.length > 0) {
          messageMetadata.codeArtifacts = result.fileChanges.map((fc: any) => ({
            path: fc.path,
            operation: fc.operation || 'write',
            language: fc.language || 'typescript',
            content: fc.content || '',
            previousContent: fc.previousContent || fc.oldContent || undefined,
            newVersion: fc.newVersion,
            previousVersion: fc.previousVersion,
          }));
        }
        if (result.fileChanges && result.fileChanges.length > 0) {
          messageMetadata.codeArtifacts = result.fileChanges.map((fc: any) => {
            const rawAction = fc.operation || fc.action;
            const operation: 'write' | 'patch' | 'delete' | 'read' =
              rawAction === 'delete'
                ? 'delete'
                : rawAction === 'modify' || rawAction === 'patch'
                  ? 'patch'
                  : 'write';
            return {
              path: fc.path,
              operation,
              language: fc.language || 'typescript',
              content: fc.content || '',
              previousContent: fc.previousContent || fc.oldContent || undefined,
              newVersion: fc.newVersion,
              previousVersion: fc.previousVersion,
            };
          });
        }
Steps of Reproduction ✅

Prompt for AI Agent 🤖





