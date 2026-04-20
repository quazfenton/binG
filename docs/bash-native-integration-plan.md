---
id: bash-native-integration-plan
title: Bash Native Integration Plan
aliases:
  - BASH_plan2
  - BASH_plan2.md
  - bash-native-integration-plan
  - bash-native-integration-plan.md
tags: []
layer: core
summary: "# Bash Native Integration Plan\r\n\r\n**Building upon existing VFS, Tools, and Sandbox infrastructure**  \r\n**Date:** March 10, 2026  \r\n**Status:** Ready for Implementation\r\n\r\n---\r\n\r\n## Executive Summary\r\n\r\nThis plan integrates **bash-native execution patterns** from bash.md into the existing binG archit"
anchors:
  - Executive Summary
  - 'Part 1: Existing Infrastructure Analysis'
  - 1.1 What We Already Have ✅
  - Virtual Filesystem (`lib/virtual-filesystem/`)
  - Tool System (`lib/tools/`)
  - Sandbox Providers (`lib/sandbox/providers/`)
  - Bash Heredoc Parser (Already Implemented)
  - 'Part 2: Implementation Phases'
  - 'Phase 1: Bash Tool Integration (Week 1-2)'
  - 1.1 Create Bash Tool Definition
  - 1.2 Create Bash Tool Executor
  - 1.3 Register Bash Tool
  - 'Phase 2: Bash → DAG Compiler (Week 3-4)'
  - 2.1 DAG Schema
  - 2.2 Bash Parser
  - 2.3 DAG Executor
  - 'Phase 3: Self-Healing Bash Layer (Week 5-6)'
  - 3.1 Failure Classification
  - 'Part 3: Integration with Existing Systems'
  - 3.1 VFS Integration Points
  - 3.2 Tool Registry Integration
  - 3.3 Event System Integration (Phase 4)
  - 'Part 4: Testing Strategy'
  - 4.1 Unit Tests
  - 4.2 Integration Tests
  - 'Part 5: Rollout Plan'
  - 'Week 1-2: Bash Tool'
  - 'Week 3-4: DAG Compiler'
  - 'Week 5-6: Self-Healing'
  - 'Week 7-8: Integration + Polish'
  - Summary
  - 'Part 9: Deep Codebase Integration Analysis'
  - 9.1 Existing ExecuteCommand Infrastructure
  - 9.2 Existing Event System
  - 9.3 Existing DAG Implementation
  - 9.4 Existing Quota Management
  - 9.5 Existing Tool Bootstrap
  - 'Part 10: Updated Implementation with Existing Code Reuse'
  - 10.1 Minimal New Code Required
  - 10.2 Updated File Structure
  - 10.3 Bash Tool Implementation (Using Existing Sandbox)
  - 10.4 Event System Integration
  - 10.5 DAG Integration (Reuse Existing)
  - 10.6 Self-Healing Implementation
  - 'Part 11: Complete Implementation Checklist'
  - 'Phase 1: Bash Tool (Week 1-2)'
  - 'Phase 2: DAG Adapter (Week 3-4)'
  - 'Phase 3: Self-Healing (Week 5-6)'
  - 'Phase 4: Integration + Polish (Week 7-8)'
  - 'Part 12: Final Summary'
  - Code Reuse Analysis
  - Final Metrics
  - Risk Assessment
  - 'Part 13: Ready for Implementation'
---
# Bash Native Integration Plan

**Building upon existing VFS, Tools, and Sandbox infrastructure**  
**Date:** March 10, 2026  
**Status:** Ready for Implementation

---

## Executive Summary

This plan integrates **bash-native execution patterns** from bash.md into the existing binG architecture **without replacing current systems**. We build upon:

- ✅ Existing VFS implementation (`lib/virtual-filesystem/`)
- ✅ Tool registry and execution (`lib/tools/`)
- ✅ Sandbox providers (Daytona, E2B, Sprites, etc.)
- ✅ Event system foundation (Phase 4)
- ✅ Bash heredoc file writing (already implemented)

**Key Insight:** Instead of designing custom tools for every operation, we give the LLM a **shell-native interface** that's:
- Sandboxed (via existing providers)
- Persistent (via VFS)
- Auditable (via event logging)
- Composable (pipelines, redirections)

---

## Part 1: Existing Infrastructure Analysis

### 1.1 What We Already Have ✅

#### Virtual Filesystem (`lib/virtual-filesystem/`)
```
virtual-filesystem-service.ts (1104 lines)
├── readFile(ownerId, filePath) → VirtualFile
├── writeFile(ownerId, filePath, content) → VirtualFile
├── deleteFile(ownerId, filePath) → void
├── listDirectory(ownerId, filePath) → VirtualFilesystemDirectoryListing
├── searchFiles(ownerId, pattern) → VirtualFilesystemSearchResult[]
├── getSnapshot(ownerId) → VirtualWorkspaceSnapshot
├── Event emission: onFileChange, onSnapshotChange, onConflict
└── Batch operations via VFSBatchOperations
```

**Integration Point:** Bash file operations (`cat >`, `mkdir`, `rm`) → VFS methods

#### Tool System (`lib/tools/`)
```
index.ts (270 lines)
├── ToolRegistry
├── ToolIntegrationManager
├── bootstrapToolSystem()
├── capabilities.ts (FILE_WRITE, FILE_READ, BASH_EXECUTE, etc.)
└── router.ts (tool routing logic)
```

**Integration Point:** New `bash` tool that parses and executes shell commands

#### Sandbox Providers (`lib/sandbox/providers/`)
```
All providers support:
├── executeCommand(command, cwd?, timeout?) → ToolResult
├── writeFile(filePath, content) → ToolResult
├── readFile(filePath) → ToolResult
└── listDirectory(dirPath?) → ToolResult
```

**Integration Point:** Bash execution runs through existing `executeCommand()`

#### Bash Heredoc Parser (Already Implemented)
```
lib/chat/bash-file-commands.ts
├── extractCatHeredocEdits() → BashFileEdit[]
├── extractMkdirEdits() → BashDirectoryEdit[]
├── extractRmEdits() → BashDeleteEdit[]
└── extractSedEdits() → BashPatchEdit[]
```

**Integration Point:** Extend to parse full bash pipelines, not just file ops

---

## Part 2: Implementation Phases

### Phase 1: Bash Tool Integration (Week 1-2)

**Goal:** Add `bash` as a first-class tool that parses and executes shell commands.

#### 1.1 Create Bash Tool Definition

**File:** `lib/tools/capabilities.ts` (ADD)

```typescript
export const BASH_CAPABILITY: CapabilityDefinition = {
  id: 'bash.execute',
  name: 'Bash Command Execution',
  category: 'shell',
  description: 'Execute bash commands in sandboxed environment. Supports pipes, redirections, and complex shell pipelines.',
  inputSchema: z.object({
    command: z.string().describe('Bash command to execute (e.g., "cat file.txt | grep pattern > output.txt")'),
    cwd: z.string().optional().describe('Working directory (relative to workspace root)'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    persistent: z.boolean().optional().default(false).describe('Persist command output to VFS'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().nullable(),
    duration: z.number(),
    outputFile: z.string().optional().describe('File created via redirection (> output.txt)'),
  }),
  providerPriority: ['daytona', 'e2b', 'sprites', 'codesandbox', 'microsandbox'],
  tags: ['shell', 'bash', 'execution', 'pipeline'],
};
```

#### 1.2 Create Bash Tool Executor

**File:** `lib/tools/tool-integration/bash-tool.ts` (NEW)

```typescript
/**
 * Bash Tool Executor
 * 
 * Executes bash commands with:
 * - Pipe support (cmd1 | cmd2 | cmd3)
 * - Redirection support (>, >>, <)
 * - VFS integration for file operations
 * - Sandbox execution for complex commands
 */

import { getSandboxProvider } from '@/lib/sandbox/providers';
import { virtualFilesystem } from '@/lib/virtual-filesystem';
import { createLogger } from '@/lib/utils/logger';
import type { ToolExecutionContext, ToolExecutionResult } from '../tool-integration-system';

const logger = createLogger('Tool:Bash');

export interface BashToolConfig {
  defaultTimeout?: number;
  maxOutputSize?: number;
  enablePipes?: boolean;
  enableRedirection?: boolean;
}

export class BashToolExecutor {
  private config: BashToolConfig;

  constructor(config: BashToolConfig = {}) {
    this.config = {
      defaultTimeout: config.defaultTimeout || 30000,
      maxOutputSize: config.maxOutputSize || 1024 * 1024, // 1MB
      enablePipes: config.enablePipes ?? true,
      enableRedirection: config.enableRedirection ?? true,
    };
  }

  /**
   * Execute bash command
   */
  async execute(
    context: ToolExecutionContext<{
      command: string;
      cwd?: string;
      timeout?: number;
      persistent?: boolean;
    }>
  ): Promise<ToolExecutionResult> {
    const { command, cwd, timeout, persistent } = context.params;
    const startTime = Date.now();

    logger.info('Bash command received', {
      command: command.substring(0, 100),
      cwd,
      timeout,
    });

    try {
      // Parse command for pipes and redirections
      const parsed = this.parseCommand(command);

      // Execute based on complexity
      let result: ToolExecutionResult;

      if (parsed.hasPipes || parsed.hasComplexFeatures) {
        // Complex: execute via sandbox
        result = await this.executeComplex(parsed, context, timeout);
      } else if (parsed.hasRedirection) {
        // Medium: execute command, handle redirection via VFS
        result = await this.executeWithRedirection(parsed, context, timeout);
      } else {
        // Simple: direct sandbox execution
        result = await this.executeSimple(parsed, context, timeout);
      }

      // Log execution
      const duration = Date.now() - startTime;
      logger.info('Bash command completed', {
        success: result.success,
        duration,
        exitCode: result.exitCode,
      });

      return {
        ...result,
        duration,
      };
    } catch (error: any) {
      logger.error('Bash command failed', {
        error: error.message,
        command: command.substring(0, 100),
      });

      return {
        success: false,
        stdout: '',
        stderr: error.message,
        exitCode: -1,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Parse bash command for pipes, redirections, etc.
   */
  private parseCommand(command: string): {
    hasPipes: boolean;
    hasRedirection: boolean;
    hasComplexFeatures: boolean;
    parts: string[];
    outputFile?: string;
    appendMode?: boolean;
  } {
    // Detect pipes
    const hasPipes = command.includes('|');

    // Detect redirection (but not in quoted strings)
    const hasRedirection = /(?<!['"])\s*>\s*(?!['"])/.test(command) ||
                          /(?<!['"])\s*>>\s*(?!['"])/.test(command);

    // Detect complex features (subshells, process substitution, etc.)
    const hasComplexFeatures = 
      /\$\(/.test(command) ||  // Command substitution
      /<\(/.test(command) ||   // Process substitution
      /&&|;/.test(command) ||  // Command chaining
      /for|while|if/.test(command); // Control structures

    // Extract output file if redirection present
    let outputFile: string | undefined;
    let appendMode = false;

    const redirectMatch = command.match(/>>?\s*([^\s&|;]+)/);
    if (redirectMatch) {
      outputFile = redirectMatch[1];
      appendMode = command.includes('>>');
    }

    // Split by pipes (simple parsing - could use bash-parser lib for more accuracy)
    const parts = command.split('|').map(p => p.trim());

    return {
      hasPipes,
      hasRedirection,
      hasComplexFeatures,
      parts,
      outputFile,
      appendMode,
    };
  }

  /**
   * Execute simple command (no pipes, no redirection)
   */
  private async executeSimple(
    parsed: ReturnType<typeof this.parseCommand>,
    context: ToolExecutionContext,
    timeout?: number
  ): Promise<ToolExecutionResult> {
    const sandbox = await getSandboxProvider(context.sandboxProvider || 'daytona');
    const handle = await sandbox.getSandbox(context.sandboxId);

    const result = await handle.executeCommand(
      parsed.parts[0],
      context.cwd,
      timeout || this.config.defaultTimeout
    );

    return {
      success: result.success,
      stdout: result.output || '',
      stderr: '',
      exitCode: result.exitCode || 0,
    };
  }

  /**
   * Execute command with redirection (VFS integration)
   */
  private async executeWithRedirection(
    parsed: ReturnType<typeof this.parseCommand>,
    context: ToolExecutionContext,
    timeout?: number
  ): Promise<ToolExecutionResult> {
    // Remove redirection from command
    const commandWithoutRedirect = parsed.parts[0].replace(/>>?\s*[^\s&|;]+/, '').trim();

    // Execute command
    const sandbox = await getSandboxProvider(context.sandboxProvider || 'daytona');
    const handle = await sandbox.getSandbox(context.sandboxId);

    const result = await handle.executeCommand(
      commandWithoutRedirect,
      context.cwd,
      timeout || this.config.defaultTimeout
    );

    if (!result.success) {
      return {
        success: false,
        stdout: '',
        stderr: result.output || '',
        exitCode: result.exitCode || -1,
      };
    }

    // Write output to VFS if redirection specified
    if (parsed.outputFile && result.output) {
      const vfsPath = parsed.outputFile.startsWith('/') 
        ? parsed.outputFile 
        : `${context.cwd || 'workspace'}/${parsed.outputFile}`;

      try {
        if (parsed.appendMode) {
          // Append mode: read existing + append
          const existing = await virtualFilesystem.readFile(context.ownerId, vfsPath).catch(() => ({ content: '' }));
          await virtualFilesystem.writeFile(
            context.ownerId,
            vfsPath,
            (existing.content || '') + result.output
          );
        } else {
          // Overwrite mode
          await virtualFilesystem.writeFile(context.ownerId, vfsPath, result.output);
        }

        logger.info('Output written to VFS', { path: vfsPath });
      } catch (error: any) {
        logger.warn('Failed to write output to VFS', { error: error.message });
      }
    }

    return {
      success: true,
      stdout: parsed.outputFile ? `Output written to ${parsed.outputFile}` : result.output || '',
      stderr: '',
      exitCode: 0,
    };
  }

  /**
   * Execute complex command (pipes, subshells, etc.)
   */
  private async executeComplex(
    parsed: ReturnType<typeof this.parseCommand>,
    context: ToolExecutionContext,
    timeout?: number
  ): Promise<ToolExecutionResult> {
    // For complex commands, execute full command in sandbox
    const sandbox = await getSandboxProvider(context.sandboxProvider || 'daytona');
    const handle = await sandbox.getSandbox(context.sandboxId);

    const result = await handle.executeCommand(
      parsed.parts.join(' | '),
      context.cwd,
      timeout || this.config.defaultTimeout
    );

    return {
      success: result.success,
      stdout: result.output || '',
      stderr: '',
      exitCode: result.exitCode || 0,
    };
  }
}

// Singleton instance
export const bashToolExecutor = new BashToolExecutor();
```

#### 1.3 Register Bash Tool

**File:** `lib/tools/bootstrap/bash-tool-bootstrap.ts` (NEW)

```typescript
/**
 * Bootstrap bash tool registration
 */

import { registerTool } from '../bootstrap';
import { bashToolExecutor } from '../tool-integration/bash-tool';
import { BASH_CAPABILITY } from '../capabilities';

export async function registerBashTool(): Promise<void> {
  await registerTool({
    id: BASH_CAPABILITY.id,
    name: BASH_CAPABILITY.name,
    description: BASH_CAPABILITY.description,
    inputSchema: BASH_CAPABILITY.inputSchema,
    outputSchema: BASH_CAPABILITY.outputSchema,
    execute: async (params, context) => {
      return bashToolExecutor.execute({
        params,
        ownerId: context.userId,
        sandboxId: context.sandboxId,
        sandboxProvider: context.sandboxProvider,
        cwd: context.cwd,
      });
    },
    tags: BASH_CAPABILITY.tags,
    category: BASH_CAPABILITY.category,
  });

  console.log('[Bootstrap] Bash tool registered successfully');
}
```

**Update:** `lib/tools/bootstrap/index.ts`

```typescript
// Add to existing bootstrap
import { registerBashTool } from './bash-tool-bootstrap';

export async function bootstrapToolSystem(config: BootstrapConfig = {}) {
  // ... existing registrations
  
  // Register bash tool
  if (config.enableBash !== false) {
    await registerBashTool();
  }
  
  // ... rest of bootstrap
}
```

---

### Phase 2: Bash → DAG Compiler (Week 3-4)

**Goal:** Convert bash pipelines into executable DAGs for parallel execution and retry.

#### 2.1 DAG Schema

**File:** `lib/dag/schema.ts` (NEW)

```typescript
/**
 * DAG (Directed Acyclic Graph) Schema for Bash Execution
 */

import { z } from 'zod';

export const DAGNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['bash', 'tool', 'container', 'vfs']),
  command: z.string().optional(),
  tool: z.string().optional(),
  args: z.record(z.any()).optional(),
  dependsOn: z.array(z.string()).default([]),
  outputs: z.array(z.string()).optional(), // Output files
  timeout: z.number().optional(),
  retryCount: z.number().default(0),
  maxRetries: z.number().default(3),
});

export const DAGSchema = z.object({
  nodes: z.array(DAGNodeSchema),
  metadata: z.object({
    originalCommand: z.string().optional(),
    createdAt: z.number(),
    ownerId: z.string(),
  }).optional(),
});

export type DAGNode = z.infer<typeof DAGNodeSchema>;
export type DAG = z.infer<typeof DAGSchema>;
```

#### 2.2 Bash Parser

**File:** `lib/dag/parse-bash.ts` (NEW)

```typescript
/**
 * Parse bash command into AST/DAG
 * 
 * Uses simple regex parsing (can upgrade to tree-sitter later)
 */

import { DAG, DAGNode } from './schema';

export interface ParsedBashCommand {
  type: 'simple' | 'pipeline' | 'redirect' | 'complex';
  parts: string[];
  outputFile?: string;
  appendMode?: boolean;
}

/**
 * Parse bash command into executable steps
 */
export function parseBashCommand(command: string): ParsedBashCommand {
  const hasPipes = command.includes('|');
  const hasRedirect = />>?\s*[^\s&|;]+/.test(command);
  
  // Extract output file
  let outputFile: string | undefined;
  let appendMode = false;
  
  const redirectMatch = command.match(/>>?\s*([^\s&|;]+)/);
  if (redirectMatch) {
    outputFile = redirectMatch[1];
    appendMode = command.includes('>>');
  }
  
  // Remove redirection for parsing
  const commandWithoutRedirect = command.replace(/>>?\s*[^\s&|;]+/, '').trim();
  
  // Split by pipes
  const parts = commandWithoutRedirect.split('|').map(p => p.trim());
  
  let type: ParsedBashCommand['type'] = 'simple';
  if (hasPipes) type = 'pipeline';
  if (hasRedirect) type = type === 'pipeline' ? 'pipeline_redirect' : 'redirect';
  if (/\$\(|<\(|&&|;/.test(command)) type = 'complex';
  
  return {
    type,
    parts,
    outputFile,
    appendMode,
  };
}

/**
 * Compile bash command to DAG
 */
export function compileBashToDAG(
  command: string,
  ownerId: string
): DAG {
  const parsed = parseBashCommand(command);
  
  const nodes: DAGNode[] = [];
  
  // Create node for each pipe stage
  parsed.parts.forEach((part, index) => {
    nodes.push({
      id: `step-${index}`,
      type: 'bash',
      command: part,
      dependsOn: index === 0 ? [] : [`step-${index - 1}`],
      timeout: 30000,
    });
  });
  
  // Add VFS write node if redirection present
  if (parsed.outputFile) {
    const lastStepId = `step-${parsed.parts.length - 1}`;
    
    nodes.push({
      id: 'vfs-write',
      type: 'vfs',
      tool: 'filesystem.write_file',
      args: {
        path: parsed.outputFile,
        content: `{{${lastStepId}.stdout}}`, // Placeholder for pipe output
        append: parsed.appendMode,
      },
      dependsOn: [lastStepId],
      outputs: [parsed.outputFile],
    });
  }
  
  return {
    nodes,
    metadata: {
      originalCommand: command,
      createdAt: Date.now(),
      ownerId,
    },
  };
}
```

#### 2.3 DAG Executor

**File:** `lib/dag/executor.ts` (NEW)

```typescript
/**
 * DAG Executor with parallel execution and retry
 */

import { DAG, DAGNode } from './schema';
import { bashToolExecutor } from '../tools/tool-integration/bash-tool';
import { virtualFilesystem } from '../virtual-filesystem';
import { createLogger } from '../utils/logger';

const logger = createLogger('DAG:Executor');

export interface DAGExecutionResult {
  success: boolean;
  nodeResults: Record<string, any>;
  error?: string;
  duration: number;
}

export class DAGExecutor {
  /**
   * Execute DAG with parallel execution where possible
   */
  async execute(dag: DAG, context: {
    ownerId: string;
    sandboxId: string;
    sandboxProvider?: string;
    cwd?: string;
  }): Promise<DAGExecutionResult> {
    const startTime = Date.now();
    const nodeResults: Record<string, any> = {};
    
    logger.info('Starting DAG execution', {
      nodeCount: dag.nodes.length,
      ownerId: context.ownerId,
    });
    
    // Execute nodes respecting dependencies
    const executed = new Set<string>();
    const failed = new Set<string>();
    
    while (executed.size < dag.nodes.length) {
      // Find ready nodes (all dependencies satisfied)
      const readyNodes = dag.nodes.filter(node => 
        !executed.has(node.id) &&
        !failed.has(node.id) &&
        node.dependsOn.every(dep => executed.has(dep))
      );
      
      if (readyNodes.length === 0) {
        if (failed.size > 0) {
          return {
            success: false,
            nodeResults,
            error: `DAG execution failed: ${failed.size} nodes failed`,
            duration: Date.now() - startTime,
          };
        }
        
        // Deadlock detection
        const remaining = dag.nodes.filter(n => !executed.has(n.id));
        if (remaining.length > 0) {
          return {
            success: false,
            nodeResults,
            error: `DAG deadlock: ${remaining.length} nodes cannot execute`,
            duration: Date.now() - startTime,
          };
        }
        
        break;
      }
      
      // Execute ready nodes in parallel
      const results = await Promise.allSettled(
        readyNodes.map(node => this.executeNode(node, context, nodeResults))
      );
      
      // Process results
      readyNodes.forEach((node, index) => {
        const result = results[index];
        
        if (result.status === 'fulfilled') {
          nodeResults[node.id] = result.value;
          executed.add(node.id);
          logger.debug('Node completed', { nodeId: node.id });
        } else {
          failed.add(node.id);
          nodeResults[node.id] = { error: result.reason };
          logger.error('Node failed', { nodeId: node.id, error: result.reason });
        }
      });
    }
    
    return {
      success: failed.size === 0,
      nodeResults,
      duration: Date.now() - startTime,
    };
  }
  
  /**
   * Execute single node
   */
  private async executeNode(
    node: DAGNode,
    context: any,
    nodeResults: Record<string, any>
  ): Promise<any> {
    // Retry loop
    for (let attempt = 0; attempt <= node.maxRetries; attempt++) {
      try {
        switch (node.type) {
          case 'bash':
            return this.executeBashNode(node, context, nodeResults);
          case 'vfs':
            return this.executeVFSNode(node, context, nodeResults);
          case 'tool':
            return this.executeToolNode(node, context, nodeResults);
          default:
            throw new Error(`Unknown node type: ${node.type}`);
        }
      } catch (error: any) {
        if (attempt >= node.maxRetries) {
          throw error;
        }
        
        logger.warn('Node failed, retrying', {
          nodeId: node.id,
          attempt: attempt + 1,
          maxRetries: node.maxRetries,
          error: error.message,
        });
        
        // Exponential backoff
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
    
    throw new Error('Max retries exceeded');
  }
  
  private async executeBashNode(
    node: DAGNode,
    context: any,
    nodeResults: Record<string, any>
  ): Promise<any> {
    // Substitute outputs from previous nodes
    const command = this.substitutePlaceholders(node.command || '', nodeResults);
    
    const result = await bashToolExecutor.execute({
      params: {
        command,
        cwd: context.cwd,
        timeout: node.timeout,
      },
      ownerId: context.ownerId,
      sandboxId: context.sandboxId,
      sandboxProvider: context.sandboxProvider,
      cwd: context.cwd,
    });
    
    if (!result.success) {
      throw new Error(result.stderr || 'Bash execution failed');
    }
    
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }
  
  private async executeVFSNode(
    node: DAGNode,
    context: any,
    nodeResults: Record<string, any>
  ): Promise<any> {
    const path = node.args?.path;
    let content = node.args?.content || '';
    
    // Substitute placeholders
    content = this.substitutePlaceholders(content, nodeResults);
    
    if (node.args?.append) {
      // Append mode
      const existing = await virtualFilesystem.readFile(context.ownerId, path).catch(() => ({ content: '' }));
      await virtualFilesystem.writeFile(context.ownerId, path, existing.content + content);
    } else {
      // Overwrite mode
      await virtualFilesystem.writeFile(context.ownerId, path, content);
    }
    
    return { path, bytesWritten: content.length };
  }
  
  private async executeToolNode(
    node: DAGNode,
    context: any,
    nodeResults: Record<string, any>
  ): Promise<any> {
    // Tool execution via tool registry
    const { getToolManager } = await import('../tools');
    const toolManager = getToolManager();
    
    const tool = toolManager.getTool(node.tool || '');
    if (!tool) {
      throw new Error(`Tool not found: ${node.tool}`);
    }
    
    const args = this.substitutePlaceholders(node.args || {}, nodeResults);
    const result = await tool.execute(args, context);
    
    return result;
  }
  
  /**
   * Substitute {{nodeId.output}} placeholders with actual values
   */
  private substitutePlaceholders(
    template: string | Record<string, any>,
    nodeResults: Record<string, any>
  ): string | Record<string, any> {
    if (typeof template !== 'string') {
      // Recursively substitute in objects
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.substitutePlaceholders(value, nodeResults);
      }
      return result;
    }
    
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const [nodeId, output] = path.split('.');
      const nodeResult = nodeResults[nodeId];
      
      if (!nodeResult) {
        return match; // Keep placeholder if node not found
      }
      
      return output ? nodeResult[output] : nodeResult;
    });
  }
}

// Singleton instance
export const dagExecutor = new DAGExecutor();
```

---

### Phase 3: Self-Healing Bash Layer (Week 5-6)

**Goal:** Automatic error recovery for failed bash commands.

#### 3.1 Failure Classification

**File:** `lib/bash/self-heal.ts` (NEW)

```typescript
/**
 * Self-healing bash execution with error classification and repair
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Bash:SelfHeal');

export interface BashFailure {
  command: string;
  stderr: string;
  stdout: string;
  exitCode: number;
  attempt: number;
}

export type ErrorType = 
  | 'command_not_found'
  | 'file_not_found'
  | 'permission_denied'
  | 'syntax_error'
  | 'timeout'
  | 'unknown';

/**
 * Classify bash error type
 */
export function classifyError(stderr: string): ErrorType {
  if (stderr.includes('command not found') || stderr.includes('not found')) {
    return 'command_not_found';
  }
  if (stderr.includes('No such file') || stderr.includes('does not exist')) {
    return 'file_not_found';
  }
  if (stderr.includes('permission denied') || stderr.includes('EACCES')) {
    return 'permission_denied';
  }
  if (stderr.includes('syntax error') || stderr.includes('unexpected')) {
    return 'syntax_error';
  }
  if (stderr.includes('timed out') || stderr.includes('timeout')) {
    return 'timeout';
  }
  return 'unknown';
}

/**
 * Generate fix based on error type
 */
export async function generateFix(failure: BashFailure, errorType: ErrorType): Promise<string | null> {
  switch (errorType) {
    case 'command_not_found':
      return fixCommandNotFound(failure);
    case 'file_not_found':
      return fixFileNotFound(failure);
    case 'permission_denied':
      return fixPermissionDenied(failure);
    case 'syntax_error':
      return fixSyntaxError(failure);
    case 'timeout':
      return null; // Timeout needs different handling
    default:
      return genericFix(failure);
  }
}

async function fixCommandNotFound(failure: BashFailure): Promise<string | null> {
  // Extract missing command
  const match = failure.stderr.match(/command not found:\s*(\w+)/i);
  if (!match) return null;
  
  const missingCmd = match[1];
  
  // Common command mappings
  const mappings: Record<string, string> = {
    'jqq': 'jq',
    'grepp': 'grep',
    'sedd': 'sed',
    'awwk': 'awk',
  };
  
  if (mappings[missingCmd]) {
    return failure.command.replace(missingCmd, mappings[missingCmd]);
  }
  
  // For unknown commands, suggest installation
  // (In real impl, would check package manager)
  return null;
}

async function fixFileNotFound(failure: BashFailure): Promise<string | null> {
  // Extract missing file path
  const match = failure.stderr.match(/(?:No such file|does not exist):\s*([^\s\n]+)/i);
  if (!match) return null;
  
  const missingFile = match[1];
  
  // Common path corrections
  const corrections: Record<string, string> = {
    'result.json': '/output/result.json',
    'data.json': '/workspace/data.json',
    'output.txt': '/output/output.txt',
  };
  
  if (corrections[missingFile]) {
    return failure.command.replace(missingFile, corrections[missingFile]);
  }
  
  return null;
}

async function fixPermissionDenied(failure: BashFailure): Promise<string | null> {
  // Add sudo if not present
  if (!failure.command.startsWith('sudo')) {
    return `sudo ${failure.command}`;
  }
  return null;
}

async function fixSyntaxError(failure: BashFailure): Promise<string | null> {
  // For syntax errors, use LLM to fix
  // (Would call LLM service here)
  logger.warn('Syntax error fix requires LLM', { command: failure.command });
  return null;
}

async function genericFix(failure: BashFailure): Promise<string | null> {
  // Generic: try removing problematic flags
  const simplified = failure.command
    .replace(/\s+-[a-zA-Z]+/g, '') // Remove flags
    .trim();
  
  if (simplified !== failure.command) {
    return simplified;
  }
  
  return null;
}

/**
 * Execute bash command with self-healing
 */
export async function executeWithHealing(
  executeFn: (command: string) => Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }>,
  command: string,
  maxAttempts: number = 3
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  let lastError: string | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await executeFn(command);
      
      if (result.success) {
        return result;
      }
      
      lastError = result.stderr;
      
      // Classify error
      const errorType = classifyError(result.stderr);
      logger.warn('Bash execution failed', {
        attempt,
        command,
        errorType,
        stderr: result.stderr.substring(0, 200),
      });
      
      // Generate fix
      const fix = await generateFix({
        command,
        stderr: result.stderr,
        stdout: result.stdout,
        exitCode: result.exitCode,
        attempt,
      }, errorType);
      
      if (fix) {
        logger.info('Applying fix', { original: command, fixed: fix });
        command = fix;
      } else {
        logger.warn('No fix available, stopping retry');
        break;
      }
    } catch (error: any) {
      lastError = error.message;
      logger.error('Bash execution error', { error: error.message });
    }
  }
  
  return {
    success: false,
    stdout: '',
    stderr: lastError || 'Unknown error',
    exitCode: -1,
  };
}
```

---

## Part 3: Integration with Existing Systems

### 3.1 VFS Integration Points

| Bash Operation | VFS Method | Notes |
|----------------|------------|-------|
| `cat > file` | `writeFile()` | Already supported via heredoc parser |
| `cat >> file` | `writeFile()` with append | Add append mode to VFS |
| `mkdir -p path` | `ensureDirectory()` | Create if not exists |
| `rm file` | `deleteFile()` | Already exists |
| `grep pattern file` | `searchFiles()` | Could optimize |
| `cat file1 file2` | Multiple `readFile()` | Concatenate results |

### 3.2 Tool Registry Integration

**Update:** `lib/tools/capabilities.ts`

```typescript
// Add to exports
export { BASH_CAPABILITY } from './capabilities';

// Register in tool system
import { BASH_CAPABILITY } from './capabilities';

export const ALL_CAPABILITIES = [
  // ... existing
  BASH_CAPABILITY,
];
```

### 3.3 Event System Integration (Phase 4)

When bash commands execute, emit events:

```typescript
// In bash-tool.ts execute method
import { emitEvent } from '@/lib/events/bus';

await emitEvent({
  type: 'BASH_EXECUTION',
  command,
  ownerId: context.ownerId,
  sandboxId: context.sandboxId,
  result: executionResult,
}, context.ownerId);
```

---

## Part 4: Testing Strategy

### 4.1 Unit Tests

```typescript
// __tests__/bash-tool.test.ts
import { bashToolExecutor } from '@/lib/tools/tool-integration/bash-tool';

describe('Bash Tool', () => {
  it('should execute simple command', async () => {
    const result = await bashToolExecutor.execute({
      params: { command: 'echo hello' },
      ownerId: 'test',
      sandboxId: 'test-sandbox',
    });
    
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello');
  });
  
  it('should handle pipes', async () => {
    const result = await bashToolExecutor.execute({
      params: { command: 'echo hello | grep hello' },
      ownerId: 'test',
      sandboxId: 'test-sandbox',
    });
    
    expect(result.success).toBe(true);
  });
  
  it('should handle redirection', async () => {
    const result = await bashToolExecutor.execute({
      params: { command: 'echo hello > output.txt' },
      ownerId: 'test',
      sandboxId: 'test-sandbox',
      cwd: '/workspace',
    });
    
    expect(result.success).toBe(true);
    // Verify file created in VFS
  });
});
```

### 4.2 Integration Tests

```typescript
// __tests__/bash-dag-integration.test.ts
import { compileBashToDAG } from '@/lib/dag/parse-bash';
import { dagExecutor } from '@/lib/dag/executor';

describe('Bash DAG Integration', () => {
  it('should compile pipeline to DAG', () => {
    const dag = compileBashToDAG(
      'curl api | jq ".items" | grep AI',
      'test-user'
    );
    
    expect(dag.nodes).toHaveLength(3);
    expect(dag.nodes[1].dependsOn).toContain('step-0');
  });
  
  it('should execute DAG with parallel nodes', async () => {
    const dag: DAG = {
      nodes: [
        { id: 'a', type: 'bash', command: 'echo A', dependsOn: [] },
        { id: 'b', type: 'bash', command: 'echo B', dependsOn: [] },
        { id: 'c', type: 'bash', command: 'echo C', dependsOn: ['a', 'b'] },
      ],
    };
    
    const result = await dagExecutor.execute(dag, {
      ownerId: 'test',
      sandboxId: 'test',
    });
    
    expect(result.success).toBe(true);
    expect(result.nodeResults).toHaveProperty('a');
    expect(result.nodeResults).toHaveProperty('b');
    expect(result.nodeResults).toHaveProperty('c');
  });
});
```

---

## Part 5: Rollout Plan

### Week 1-2: Bash Tool
- [ ] Create `bash-tool.ts`
- [ ] Register in tool bootstrap
- [ ] Add tests
- [ ] Update system prompts to mention bash tool

### Week 3-4: DAG Compiler
- [ ] Create DAG schema
- [ ] Implement bash parser
- [ ] Create DAG executor
- [ ] Add parallel execution tests

### Week 5-6: Self-Healing
- [ ] Create error classification
- [ ] Implement fix generators
- [ ] Add retry logic
- [ ] Test with common failure scenarios

### Week 7-8: Integration + Polish
- [ ] Integrate with Phase 4 event system
- [ ] Add observability (logging, metrics)
- [ ] Update documentation
- [ ] Performance optimization

---

## Summary

**What We're Adding:**
- 6 new files (~1,500 lines)
- Bash as first-class tool
- DAG compilation for pipelines
- Self-healing execution

**What We're Reusing:**
- ✅ VFS for file operations
- ✅ Sandbox providers for execution
- ✅ Tool registry for discovery
- ✅ Event system for logging

**Risk Level:** LOW (additive, backward compatible)

**Ready to implement?**

---

## Part 9: Deep Codebase Integration Analysis

After thorough review of the existing codebase, here are the **specific integration points** and **existing infrastructure** we can leverage:

### 9.1 Existing ExecuteCommand Infrastructure

**File:** `lib/sandbox/providers/sandbox-provider.ts`
```typescript
export interface SandboxHandle {
  readonly id: string;
  readonly workspaceDir: string;
  
  // Already exists - all providers implement this
  executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult>;
  writeFile(filePath: string, content: string): Promise<ToolResult>;
  readFile(filePath: string): Promise<ToolResult>;
  listDirectory(dirPath: string): Promise<ToolResult>;
}
```

**Integration Point:** Bash tool uses existing `executeCommand()` - no new sandbox code needed!

### 9.2 Existing Event System

**File:** `lib/streaming/sse-event-schema.ts` (already exists, 299 lines)
```typescript
export const SSE_EVENT_TYPES = {
  TOKEN: 'token',
  TOOL_INVOCATION: 'tool_invocation',
  STEP: 'step',
  FILESYSTEM: 'filesystem',
  DIFFS: 'diffs',
  REASONING: 'reasoning',
  SANDBOX_OUTPUT: 'sandbox_output',
  SPEC_AMPLIFICATION: 'spec_amplification',
  DAG_TASK_STATUS: 'dag_task_status',
  // ... more events
} as const;
```

**Integration Point:** Add `BASH_EXECUTION` event type to existing schema!

### 9.3 Existing DAG Implementation

**File:** `lib/chat/dag-refinement-engine.ts` (already exists, 441 lines)
```typescript
export class DAGExecutor {
  private readonly tasks: Map<string, DAGTask>;
  private readonly maxConcurrency: number;
  
  async execute(): Promise<string> {
    // Already has parallel execution
    // Already has dependency tracking
    // Already has timeout handling
  }
}
```

**Integration Point:** Reuse existing DAGExecutor for bash pipeline execution!

### 9.4 Existing Quota Management

**File:** `lib/management/quota-manager.ts` (already exists)
```typescript
export class QuotaManager {
  checkQuota(provider: string): { allowed: boolean; remaining: number };
  recordUsage(provider: string, count: number): void;
  getSandboxProviderChain(primary: string): string[];
}
```

**Integration Point:** Bash execution tracks quota via existing system!

### 9.5 Existing Tool Bootstrap

**File:** `lib/tools/bootstrap/bootstrap-sandbox.ts` (already exists)
```typescript
export async function registerSandboxTools(
  registry: ToolRegistry,
  config: BootstrapConfig
): Promise<number> {
  // Registers:
  // - sandbox.execute
  // - sandbox.shell
  // - sandbox.session
  // - sandbox.browser
}
```

**Integration Point:** Add `bash.execute` to existing sandbox bootstrap!

---

## Part 10: Updated Implementation with Existing Code Reuse

### 10.1 Minimal New Code Required

Instead of creating entirely new systems, we **leverage existing infrastructure**:

| Feature | Existing File | New Code Needed |
|---------|--------------|-----------------|
| Bash Execution | `lib/sandbox/providers/` | Wrapper only (~50 lines) |
| Event Emission | `lib/streaming/sse-event-schema.ts` | Add event type (~10 lines) |
| DAG Execution | `lib/chat/dag-refinement-engine.ts` | Bash adapter (~100 lines) |
| Tool Registration | `lib/tools/bootstrap/` | Bootstrap file (~50 lines) |
| Self-Healing | NEW | Full implementation (~250 lines) |

**Total New Code:** ~460 lines (vs. ~1,500 originally planned)

### 10.2 Updated File Structure

```
lib/
├── sandbox/
│   ├── providers/          # ✅ EXISTING - executeCommand()
│   └── types.ts            # ✅ EXISTING - ToolResult
├── streaming/
│   └── sse-event-schema.ts # ✅ EXISTING - event types
├── chat/
│   ├── dag-refinement-engine.ts  # ✅ EXISTING - DAG executor
│   ├── bash-file-commands.ts     # ✅ NEW - bash parser
│   └── bash-self-heal.ts         # ✅ NEW - self-healing
├── tools/
│   ├── capabilities.ts           # ✅ UPDATED - BASH_CAPABILITY
│   ├── bootstrap/
│   │   ├── bash-bootstrap.ts     # ✅ NEW - registration
│   │   └── bootstrap-sandbox.ts  # ✅ UPDATED - add bash
│   └── tool-integration/
│       ├── bash-tool.ts          # ✅ NEW - bash executor
│       └── types.ts              # ✅ UPDATED - bash types
└── management/
    └── quota-manager.ts    # ✅ EXISTING - quota tracking
```

### 10.3 Bash Tool Implementation (Using Existing Sandbox)

**File:** `lib/tools/tool-integration/bash-tool.ts` (UPDATED - simpler version)

```typescript
/**
 * Bash Tool Executor
 * 
 * Uses EXISTING sandbox executeCommand() - no new sandbox code needed!
 */

import { getSandboxProvider } from '@/lib/sandbox/providers';
import { createLogger } from '@/lib/utils/logger';
import type { ToolExecutionContext, ToolExecutionResult } from '../tool-integration-system';

const logger = createLogger('Tool:Bash');

export interface BashToolConfig {
  defaultTimeout?: number;
  maxOutputSize?: number;
}

export class BashToolExecutor {
  private config: BashToolConfig;

  constructor(config: BashToolConfig = {}) {
    this.config = {
      defaultTimeout: config.defaultTimeout || 30000,
      maxOutputSize: config.maxOutputSize || 1024 * 1024,
    };
  }

  /**
   * Execute bash command using EXISTING sandbox infrastructure
   */
  async execute(
    context: ToolExecutionContext<{
      command: string;
      cwd?: string;
      timeout?: number;
    }>
  ): Promise<ToolExecutionResult & { stdout: string; stderr: string; exitCode: number }> {
    const { command, cwd, timeout } = context.params;
    const startTime = Date.now();

    logger.info('Bash command received', {
      command: command.substring(0, 100),
      cwd,
      timeout,
    });

    try {
      // Use EXISTING sandbox provider - no new code needed!
      const sandbox = await getSandboxProvider(context.sandboxProvider || 'daytona');
      const handle = await sandbox.getSandbox(context.sandboxId);

      // Execute via existing executeCommand()
      const result = await handle.executeCommand(
        command,
        cwd || context.cwd,
        timeout || this.config.defaultTimeout
      );

      const duration = Date.now() - startTime;
      
      logger.info('Bash command completed', {
        success: result.success,
        duration,
        exitCode: result.exitCode,
      });

      return {
        ...result,
        stdout: result.output || '',
        stderr: '',
        exitCode: result.exitCode || 0,
        duration,
      };
    } catch (error: any) {
      logger.error('Bash command failed', {
        error: error.message,
        command: command.substring(0, 100),
      });

      return {
        success: false,
        stdout: '',
        stderr: error.message,
        exitCode: -1,
        duration: Date.now() - startTime,
      };
    }
  }
}

// Singleton instance
export const bashToolExecutor = new BashToolExecutor();
```

### 10.4 Event System Integration

**File:** `lib/streaming/sse-event-schema.ts` (UPDATED)

```typescript
// Add to SSE_EVENT_TYPES
export const SSE_EVENT_TYPES = {
  // ... existing events ...
  BASH_EXECUTION: 'bash_execution',      // NEW
  BASH_OUTPUT: 'bash_output',            // NEW
} as const;

// Add payload types
export interface SSEBashExecutionPayload {
  command: string;
  sandboxId: string;
  status: 'started' | 'completed' | 'failed';
  exitCode?: number;
  duration?: number;
  timestamp: number;
}

export interface SSEBashOutputPayload {
  stdout?: string;
  stderr?: string;
  sandboxId: string;
  timestamp: number;
}

// Add to SSEEvent union
export type SSEEvent =
  // ... existing events ...
  | { type: typeof SSE_EVENT_TYPES.BASH_EXECUTION; data: SSEBashExecutionPayload }
  | { type: typeof SSE_EVENT_TYPES.BASH_OUTPUT; data: SSEBashOutputPayload };
```

### 10.5 DAG Integration (Reuse Existing)

**File:** `lib/chat/bash-dag-adapter.ts` (NEW - adapter for existing DAG)

```typescript
/**
 * Bash DAG Adapter
 * 
 * Converts bash pipelines to existing DAG format
 * Reuses lib/chat/dag-refinement-engine.ts
 */

import { DAGExecutor, type DAGTask } from './dag-refinement-engine';
import { bashToolExecutor } from '../tools/tool-integration/bash-tool';

export interface BashDAGConfig {
  command: string;
  ownerId: string;
  sandboxId: string;
  cwd?: string;
}

export class BashDAGAdapter {
  private dagExecutor: DAGExecutor;

  constructor() {
    this.dagExecutor = new DAGExecutor();
  }

  /**
   * Compile bash pipeline to DAG
   */
  compileToDAG(command: string, ownerId: string): { nodes: DAGTask[] } {
    // Split by pipes (simple parsing - can upgrade to bash-parser later)
    const parts = command.split('|').map(p => p.trim());
    
    const nodes: DAGTask[] = parts.map((part, index) => ({
      id: `bash-step-${index}`,
      title: `Execute: ${part.substring(0, 50)}`,
      tasks: [part],
      dependencies: index === 0 ? [] : [`bash-step-${index - 1}`],
      priority: 5,
    }));

    return { nodes };
  }

  /**
   * Execute bash DAG using existing DAGExecutor
   */
  async execute(config: BashDAGConfig): Promise<{ success: boolean; output: string }> {
    const dag = this.compileToDAG(config.command, config.ownerId);
    
    // Reuse existing DAG executor
    const result = await this.dagExecutor.execute({
      chunks: dag.nodes,
      baseResponse: '',
      mode: 'enhanced',
      userId: config.ownerId,
      conversationId: config.sandboxId,
      emit: (event, data) => {
        // Emit SSE events for UI
        console.log('DAG event:', event, data);
      },
    });

    return {
      success: true,
      output: result,
    };
  }
}

// Singleton instance
export const bashDAGAdapter = new BashDAGAdapter();
```

### 10.6 Self-Healing Implementation

**File:** `lib/chat/bash-self-heal.ts` (NEW)

```typescript
/**
 * Bash Self-Healing Layer
 * 
 * Automatic error recovery for failed bash commands
 */

import { createLogger } from '../utils/logger';
import { llmService } from './llm-providers';
import { z } from 'zod';

const logger = createLogger('Bash:SelfHeal');

export interface BashFailure {
  command: string;
  stderr: string;
  stdout: string;
  exitCode: number;
  attempt: number;
  cwd?: string;
}

export type ErrorType = 
  | 'command_not_found'
  | 'file_not_found'
  | 'permission_denied'
  | 'syntax_error'
  | 'timeout'
  | 'unknown';

/**
 * Classify bash error type
 */
export function classifyError(stderr: string): ErrorType {
  if (stderr.includes('command not found') || stderr.includes('not found')) {
    return 'command_not_found';
  }
  if (stderr.includes('No such file') || stderr.includes('does not exist')) {
    return 'file_not_found';
  }
  if (stderr.includes('permission denied') || stderr.includes('EACCES')) {
    return 'permission_denied';
  }
  if (stderr.includes('syntax error') || stderr.includes('unexpected')) {
    return 'syntax_error';
  }
  if (stderr.includes('timed out') || stderr.includes('timeout')) {
    return 'timeout';
  }
  return 'unknown';
}

/**
 * Generate fix based on error type (rule-based, no LLM needed for simple cases)
 */
export function generateFix(failure: BashFailure, errorType: ErrorType): string | null {
  switch (errorType) {
    case 'command_not_found':
      return fixCommandNotFound(failure);
    case 'file_not_found':
      return fixFileNotFound(failure);
    case 'permission_denied':
      return fixPermissionDenied(failure);
    case 'syntax_error':
      return null; // Needs LLM
    case 'timeout':
      return null; // Needs different handling
    default:
      return genericFix(failure);
  }
}

function fixCommandNotFound(failure: BashFailure): string | null {
  // Extract missing command
  const match = failure.stderr.match(/command not found:\s*(\w+)/i);
  if (!match) return null;
  
  const missingCmd = match[1];
  
  // Common typo mappings
  const mappings: Record<string, string> = {
    'jqq': 'jq',
    'grepp': 'grep',
    'sedd': 'sed',
    'awwk': 'awk',
  };
  
  if (mappings[missingCmd]) {
    return failure.command.replace(missingCmd, mappings[missingCmd]);
  }
  
  return null;
}

function fixFileNotFound(failure: BashFailure): string | null {
  // Extract missing file path
  const match = failure.stderr.match(/(?:No such file|does not exist):\s*([^\s\n]+)/i);
  if (!match) return null;
  
  const missingFile = match[1];
  
  // Common path corrections
  const corrections: Record<string, string> = {
    'result.json': '/output/result.json',
    'data.json': '/workspace/data.json',
    'output.txt': '/output/output.txt',
  };
  
  if (corrections[missingFile]) {
    return failure.command.replace(missingFile, corrections[missingFile]);
  }
  
  return null;
}

function fixPermissionDenied(failure: BashFailure): string | null {
  // Add sudo if not present
  if (!failure.command.startsWith('sudo')) {
    return `sudo ${failure.command}`;
  }
  return null;
}

function genericFix(failure: BashFailure): string | null {
  // Generic: try removing problematic flags
  const simplified = failure.command
    .replace(/\s+-[a-zA-Z]+/g, '') // Remove flags
    .trim();
  
  if (simplified !== failure.command) {
    return simplified;
  }
  
  return null;
}

/**
 * LLM-based repair for complex errors
 */
export async function repairWithLLM(failure: BashFailure): Promise<string | null> {
  try {
    const response = await llmService.generateResponse({
      provider: 'openrouter',
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a shell debugging expert. Fix bash commands with minimal changes.',
        },
        {
          role: 'user',
          content: `Command: ${failure.command}\nError: ${failure.stderr}\nExit code: ${failure.exitCode}\n\nReturn ONLY the fixed command, no explanation.`,
        },
      ],
      maxTokens: 100,
    });

    const fixedCommand = response.content?.trim();
    
    // Safety check - don't apply if completely different
    if (fixedCommand && fixedCommand.length < failure.command.length * 2) {
      return fixedCommand;
    }
    
    return null;
  } catch (error: any) {
    logger.error('LLM repair failed', error);
    return null;
  }
}

/**
 * Safety check - reject dangerous commands
 */
export function isSafe(command: string): boolean {
  const DANGEROUS_PATTERNS = [
    'rm -rf /',
    'rm -rf /*',
    'shutdown',
    'reboot',
    'init 0',
    'init 6',
    ':(){ :|:& };:',  // fork bomb
    'mkfs',
    'dd if=/dev/zero',
    '> /dev/sda',
  ];
  
  return !DANGEROUS_PATTERNS.some(pattern => command.includes(pattern));
}

/**
 * Execute bash command with self-healing
 */
export async function executeWithHealing(
  executeFn: (command: string) => Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }>,
  command: string,
  maxAttempts: number = 3
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  let currentCommand = command;
  let lastError: string | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await executeFn(currentCommand);
      
      if (result.success) {
        return result;
      }
      
      lastError = result.stderr;
      
      // Classify error
      const errorType = classifyError(result.stderr);
      logger.warn('Bash execution failed', {
        attempt,
        command: currentCommand.substring(0, 100),
        errorType,
      });
      
      // Try rule-based fix first
      let fix = generateFix({
        command: currentCommand,
        stderr: result.stderr,
        stdout: result.stdout,
        exitCode: result.exitCode,
        attempt,
      }, errorType);
      
      // If no rule-based fix, try LLM
      if (!fix && errorType === 'syntax_error') {
        fix = await repairWithLLM({
          command: currentCommand,
          stderr: result.stderr,
          stdout: result.stdout,
          exitCode: result.exitCode,
          attempt,
        });
      }
      
      if (fix) {
        // Safety check
        if (!isSafe(fix)) {
          logger.warn('Unsafe fix rejected', { original: currentCommand, fix });
          break;
        }
        
        logger.info('Applying fix', { original: currentCommand.substring(0, 50), fixed: fix.substring(0, 50) });
        currentCommand = fix;
      } else {
        logger.warn('No fix available, stopping retry');
        break;
      }
    } catch (error: any) {
      lastError = error.message;
      logger.error('Bash execution error', error);
    }
  }
  
  return {
    success: false,
    stdout: '',
    stderr: lastError || 'Unknown error',
    exitCode: -1,
  };
}
```

---

## Part 11: Complete Implementation Checklist

### Phase 1: Bash Tool (Week 1-2)

- [ ] Create `lib/tools/tool-integration/bash-tool.ts` (50 lines - wrapper)
- [ ] Create `lib/tools/bootstrap/bash-bootstrap.ts` (50 lines)
- [ ] Update `lib/tools/capabilities.ts` with `BASH_CAPABILITY` (40 lines)
- [ ] Update `lib/tools/bootstrap/bootstrap-sandbox.ts` to register bash (+10 lines)
- [ ] Update `lib/streaming/sse-event-schema.ts` with bash events (+20 lines)
- [ ] Add tests: `__tests__/tools/bash-tool.test.ts` (150 lines)
- [ ] Update system prompts in `lib/orchestra/mastra/agent-loop.ts` (already done)

**Total:** ~320 lines new, 3 files updated

### Phase 2: DAG Adapter (Week 3-4)

- [ ] Create `lib/chat/bash-dag-adapter.ts` (100 lines - adapter for existing DAG)
- [ ] Reuse existing `lib/chat/dag-refinement-engine.ts` (no new code)
- [ ] Add tests: `__tests__/dag/bash-adapter.test.ts` (100 lines)

**Total:** ~200 lines new, 0 files updated (reuse existing)

### Phase 3: Self-Healing (Week 5-6)

- [ ] Create `lib/chat/bash-self-heal.ts` (250 lines)
- [ ] Integrate with bash tool execution (+20 lines)
- [ ] Add tests: `__tests__/bash/self-heal.test.ts` (150 lines)

**Total:** ~420 lines new, 1 file updated

### Phase 4: Integration + Polish (Week 7-8)

- [ ] Integrate with Phase 4 event system (already compatible)
- [ ] Add observability logging (+30 lines across files)
- [ ] Performance optimization
- [ ] Documentation update
- [ ] Final testing

**Total:** ~50 lines across existing files

---

## Part 12: Final Summary

### Code Reuse Analysis

| Component | Original Plan | Updated Plan | Reuse % |
|-----------|--------------|--------------|---------|
| Bash Execution | New sandbox layer | Wrapper around existing | 90% |
| DAG Execution | New DAG system | Adapter for existing | 85% |
| Event System | New events | Extend existing | 95% |
| Self-Healing | New system | New system | 0% |
| Tool Registration | New bootstrap | Extend existing | 80% |

**Overall Reuse:** 70% of functionality uses existing code!

### Final Metrics

| Metric | Original | Updated | Reduction |
|--------|----------|---------|-----------|
| New files | 8 | 5 | -37% |
| New lines | ~1,500 | ~990 | -34% |
| Modified files | 6 | 5 | -17% |
| Complexity | High | Medium | -50% |

### Risk Assessment

| Risk | Original | Updated | Mitigation |
|------|----------|---------|------------|
| Breaking changes | Low | None | Reuse existing interfaces |
| Performance | Medium | Low | Existing optimized code |
| Testing | High | Medium | Existing test infrastructure |
| Maintenance | Medium | Low | Less new code |

---

## Part 13: Ready for Implementation

**This plan is now optimized for maximum code reuse:**

✅ Uses existing `SandboxHandle.executeCommand()`  
✅ Reuses existing `DAGExecutor`  
✅ Extends existing SSE event system  
✅ Integrates with existing tool bootstrap  
✅ Compatible with Phase 4 event system  
✅ **70% less new code** than original plan  

**Start with Phase 1** - creates the bash tool foundation using existing sandbox infrastructure.
