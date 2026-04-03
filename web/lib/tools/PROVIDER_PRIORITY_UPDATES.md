/**
 * Provider Priority Updates for REPO_ Capabilities
 * 
 * Copy and paste these providerPriority arrays into lib/tools/capabilities.ts
 * to replace the existing ones for REPO_ capabilities.
 * 
 * All provider priorities are now aligned with provider-router.ts profiles.
 */

// ============================================================================
// REPO_SEARCH_CAPABILITY - Updated Provider Priority
// ============================================================================
/**
 * Provider priority aligned with provider-router.ts profiles
 * Best for: code-interpreter, general (all providers with pty service)
 */
providerPriority: [
  'blaxel',           // Best for agent-based search
  'opencode-v2',      // Local OpenCode with ripgrep
  'daytona',          // Full-stack with LSP
  'e2b',              // Agent support
  'sprites',          // Persistent with file search
  'codesandbox',      // Full-stack search
  'microsandbox',     // Lightweight search
  'opensandbox',      // General search
  'mistral',          // General search
  'webcontainer',     // Browser-based search
],

// ============================================================================
// REPO_GIT_CAPABILITY - Updated Provider Priority
// ============================================================================
/**
 * Provider priority aligned with provider-router.ts profiles
 * Best for: code-interpreter, general (all providers with pty service)
 */
providerPriority: [
  'opencode-v2',      // Local OpenCode (primary)
  'daytona',          // Full-stack with git
  'e2b',              // Agent with git
  'sprites',          // Persistent with git
  'codesandbox',      // Full-stack with git
  'blaxel',           // Agent with git
  'microsandbox',     // Lightweight git
  'opensandbox',      // General git
  'mistral',          // General git
  'webcontainer',     // Browser-based git
],

// ============================================================================
// REPO_CLONE_CAPABILITY - Updated Provider Priority
// ============================================================================
/**
 * Provider priority aligned with provider-router.ts profiles
 * Best for: code-interpreter, general (all providers with pty service)
 */
providerPriority: [
  'opencode-v2',      // Local OpenCode (primary)
  'daytona',          // Full-stack with git clone
  'e2b',              // Agent with git clone
  'sprites',          // Persistent with git clone
  'codesandbox',      // Full-stack with git clone
  'blaxel',           // Agent with git clone
  'microsandbox',     // Lightweight git clone
  'opensandbox',      // General git clone
  'mistral',          // General git clone
  'webcontainer',     // Browser-based git clone
],

// ============================================================================
// REPO_COMMIT_CAPABILITY - Updated Provider Priority
// ============================================================================
/**
 * Provider priority aligned with provider-router.ts profiles
 * Best for: code-interpreter, general (all providers with pty service)
 */
providerPriority: [
  'opencode-v2',      // Local OpenCode (primary)
  'daytona',          // Full-stack with git commit
  'e2b',              // Agent with git commit
  'sprites',          // Persistent with git commit
  'codesandbox',      // Full-stack with git commit
  'blaxel',           // Agent with git commit
  'microsandbox',     // Lightweight git commit
  'opensandbox',      // General git commit
  'mistral',          // General git commit
  'webcontainer',     // Browser-based git commit
],

// ============================================================================
// REPO_PUSH_CAPABILITY - Updated Provider Priority
// ============================================================================
/**
 * Provider priority aligned with provider-router.ts profiles
 * Best for: code-interpreter, general (all providers with pty service)
 */
providerPriority: [
  'opencode-v2',      // Local OpenCode (primary)
  'daytona',          // Full-stack with git push
  'e2b',              // Agent with git push
  'sprites',          // Persistent with git push
  'codesandbox',      // Full-stack with git push
  'blaxel',           // Agent with git push
  'microsandbox',     // Lightweight git push
  'opensandbox',      // General git push
  'mistral',          // General git push
  'webcontainer',     // Browser-based git push
],

// ============================================================================
// REPO_PULL_CAPABILITY - Updated Provider Priority
// ============================================================================
/**
 * Provider priority aligned with provider-router.ts profiles
 * Best for: code-interpreter, general (all providers with pty service)
 */
providerPriority: [
  'opencode-v2',      // Local OpenCode (primary)
  'daytona',          // Full-stack with git pull
  'e2b',              // Agent with git pull
  'sprites',          // Persistent with git pull
  'codesandbox',      // Full-stack with git pull
  'blaxel',           // Agent with git pull
  'microsandbox',     // Lightweight git pull
  'opensandbox',      // General git pull
  'mistral',          // General git pull
  'webcontainer',     // Browser-based git pull
],

// ============================================================================
// REPO_SEMANTIC_SEARCH_CAPABILITY - Updated Provider Priority
// ============================================================================
/**
 * Provider priority aligned with provider-router.ts profiles
 * Best for: code-interpreter, agent (blaxel best for agent-based semantic search)
 */
providerPriority: [
  'blaxel',           // Best for agent-based semantic search
  'opencode-v2',      // Local OpenCode with embeddings
  'daytona',          // Full-stack with semantic search
  'e2b',              // Agent with embeddings
  'sprites',          // Persistent with embeddings
  'codesandbox',      // Full-stack with embeddings
  'microsandbox',     // Lightweight semantic search
  'opensandbox',      // General semantic search
  'mistral',          // General semantic search
  'webcontainer',     // Browser-based semantic search
],

// ============================================================================
// REPO_ANALYZE_CAPABILITY - Updated Provider Priority
// ============================================================================
/**
 * Provider priority aligned with provider-router.ts profiles
 * Best for: code-interpreter, agent (blaxel best for agent-based analysis)
 */
providerPriority: [
  'blaxel',           // Best for agent-based analysis
  'opencode-v2',      // Local OpenCode with analysis
  'daytona',          // Full-stack with analysis
  'e2b',              // Agent with analysis
  'sprites',          // Persistent with analysis
  'codesandbox',      // Full-stack with analysis
  'microsandbox',     // Lightweight analysis
  'opensandbox',      // General analysis
  'mistral',          // General analysis
  'webcontainer',     // Browser-based analysis
],
