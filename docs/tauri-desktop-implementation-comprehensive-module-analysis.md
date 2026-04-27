---
id: tauri-desktop-implementation-comprehensive-module-analysis
title: Tauri Desktop Implementation - Comprehensive Module Analysis
aliases:
  - TAURI_DESKTOP_COMPREHENSIVE_ANALYSIS
  - TAURI_DESKTOP_COMPREHENSIVE_ANALYSIS.md
  - tauri-desktop-implementation-comprehensive-module-analysis
  - tauri-desktop-implementation-comprehensive-module-analysis.md
tags:
  - implementation
layer: core
summary: "# Tauri Desktop Implementation - Comprehensive Module Analysis\r\n\r\n## Appendix A: Complete Module Change Summary\r\n\r\nThis document provides an exhaustive analysis of all modules requiring changes for Tauri desktop integration, organized by functional area.\r\n\r\n---\r\n\r\n## Module Area 1: Quota & Resource"
anchors:
  - 'Appendix A: Complete Module Change Summary'
  - 'Module Area 1: Quota & Resource Management'
  - Current Implementation
  - Desktop Changes Required
  - 1. Desktop-Specific Quota Model
  - 2. Resource Monitoring
  - 3. Quota UI for Desktop
  - Changes Summary for Quota Management
  - 'Module Area 2: Unified Agent Service'
  - Current Implementation
  - Desktop Changes Required
  - 1. Desktop Agent Mode
  - 2. Desktop Agent Loop
  - 3. Desktop LLM Options
  - Changes Summary for Unified Agent Service
  - 'Module Area 3: Agent Workspace Management'
  - Current Implementation
  - Desktop Changes Required
  - 1. Desktop Workspace with Local Path
  - 2. Workspace UI for Desktop
  - Changes Summary for Workspace Management
  - 'Module Area 4: Stateful Agent & HITL'
  - Current Implementation
  - Desktop Changes Required
  - 1. Tauri Dialog Provider
  - 2. Diff Editor Window
  - 3. Approval Center
  - Changes Summary for Stateful Agent & HITL
  - 'Module Area 5: MCP Integration (Deep Dive)'
  - Additional Desktop MCP Considerations
  - 1. Bundled MCP Servers
  - '2. MCP Server: Filesystem'
  - 3. MCP Connection Manager for Desktop
  - 'Summary: Complete File Inventory'
  - New Files Required (Complete List)
  - Rust Backend (`src-tauri/`)
  - TypeScript Frontend (`lib/`)
  - UI Components (`components/` & `app/`)
  - Modified Files (Key Changes)
  - Implementation Priority Matrix
  - 'Phase 1: Core Execution (Weeks 1-4)'
  - 'Phase 2: User Experience (Weeks 5-8)'
  - 'Phase 3: Advanced Features (Weeks 9-12)'
  - Testing Strategy for Desktop
  - Unit Tests
  - Integration Tests
  - E2E Tests
relations:
  - type: implements
    id: tauri-desktop-implementation-plan
    title: Tauri Desktop Implementation Plan
    path: tauri-desktop-implementation-plan.md
    confidence: 0.383
    classified_score: 0.392
    auto_generated: true
    generator: apply-classified-suggestions
  - type: implements
    id: next-steps-implementation-summary
    title: Next Steps Implementation Summary
    path: next-steps-implementation-summary.md
    confidence: 0.325
    classified_score: 0.332
    auto_generated: true
    generator: apply-classified-suggestions
  - type: implements
    id: zod-validation-implementation-summary
    title: Zod Validation Implementation Summary
    path: zod-validation-implementation-summary.md
    confidence: 0.325
    classified_score: 0.33
    auto_generated: true
    generator: apply-classified-suggestions
  - type: implements
    id: event-store-implementation-summary
    title: Event Store Implementation Summary
    path: event-store-implementation-summary.md
    confidence: 0.324
    classified_score: 0.331
    auto_generated: true
    generator: apply-classified-suggestions
---
# Tauri Desktop Implementation - Comprehensive Module Analysis

## Appendix A: Complete Module Change Summary

This document provides an exhaustive analysis of all modules requiring changes for Tauri desktop integration, organized by functional area.

---

## Module Area 1: Quota & Resource Management

### Current Implementation

**File: `/root/bing/lib/management/quota-manager.ts`**

The quota manager tracks usage for cloud providers with monthly limits:

```typescript
export interface ProviderQuota {
  provider: string;
  monthlyLimit: number;
  currentUsage: number;
  resetDate: string;
  isDisabled: boolean;
}

const DEFAULT_QUOTAS: Record<string, number> = {
  composio: 20000,    // Tool calls
  arcade: 10000,      // Tool calls
  nango: 10000,       // Tool calls
  daytona: 5000,      // Sandbox sessions
  runloop: 5000,      // Sandbox sessions
  microsandbox: 10000, // Sandbox sessions
  e2b: 1000,          // E2B sandbox sessions
  mistral: 2000,      // Mistral code interpreter
  blaxel: 5000,       // Blaxel sandbox
  sprites: 2000,      // Sprites persistent VMs
};
```

**Storage:**
- SQLite database (`provider_quotas` table)
- JSON fallback file (`data/provider-quotas.json`)
- In-memory cache with lazy loading

### Desktop Changes Required

#### 1. Desktop-Specific Quota Model

**New File: `/root/bing/lib/management/desktop-quota-manager.ts`**

```typescript
export interface DesktopQuotaConfig {
  // Local execution doesn't have API costs, but has resource limits
  maxConcurrentProcesses: number;      // Default: 10
  maxMemoryPerProcess: number;         // Default: 2GB
  maxDiskUsage: number;                // Default: 10GB
  maxCpuUsagePercent: number;          // Default: 80%
  maxFileOperationsPerMinute: number;  // Default: 100
  
  // Optional cloud provider quotas (if user enables hybrid mode)
  cloudProviderQuotas?: {
    e2b?: { monthlyLimit: number };
    daytona?: { monthlyLimit: number };
    sprites?: { monthlyLimit: number };
  };
}

class DesktopQuotaManager {
  private config: DesktopQuotaConfig;
  private resourceMonitor: ResourceMonitor;
  
  async checkResourceAvailability(task: TaskRequest): Promise<{
    allowed: boolean;
    reason?: string;
    estimatedUsage: ResourceUsage;
  }> {
    // Check local resource availability
    const currentUsage = await this.resourceMonitor.getCurrentUsage();
    
    if (currentUsage.cpuPercent > this.config.maxCpuUsagePercent) {
      return {
        allowed: false,
        reason: `CPU usage too high: ${currentUsage.cpuPercent.toFixed(1)}%`,
        estimatedUsage: currentUsage,
      };
    }
    
    if (currentUsage.activeProcesses >= this.config.maxConcurrentProcesses) {
      return {
        allowed: false,
        reason: `Too many concurrent processes: ${currentUsage.activeProcesses}`,
        estimatedUsage: currentUsage,
      };
    }
    
    return { allowed: true, estimatedUsage: currentUsage };
  }
}
```

#### 2. Resource Monitoring

**New File: `/root/bing/src-tauri/src/resource_monitor.rs`**

```rust
use sysinfo::{ProcessExt, System, SystemExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub cpu_percent: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    pub active_processes: u32,
}

#[tauri::command]
async fn get_resource_usage() -> Result<ResourceUsage, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_percent = sys.global_cpu_usage();
    let memory_used = sys.used_memory() / 1024; // MB
    let memory_total = sys.total_memory() / 1024; // MB

    // Get disk usage for app data directory
    let app_data_dir = std::env::var("APP_DATA_DIR")
        .map_err(|e| e.to_string())?;
    let disk_usage = get_disk_usage(&app_data_dir)?;

    let active_processes = sys.processes().len() as u32;

    Ok(ResourceUsage {
        cpu_percent,
        memory_used_mb: memory_used,
        memory_total_mb: memory_total,
        disk_used_gb: disk_usage.used,
        disk_total_gb: disk_usage.total,
        active_processes,
    })
}

#[tauri::command]
async fn enforce_resource_limits(limits: ResourceLimits) -> Result<(), String> {
    // Monitor and kill processes exceeding limits
    // This runs as a background task
}
```

#### 3. Quota UI for Desktop

**New Component: `/root/bing/components/desktop/resource-monitor.tsx`**

```tsx
export function ResourceMonitor() {
  const [usage, setUsage] = useState<ResourceUsage | null>(null);

  useEffect(() => {
    const unsubscribe = listen<ResourceUsage>('resource-update', (event) => {
      setUsage(event.payload);
    });

    // Poll every 5 seconds
    const interval = setInterval(async () => {
      const current = await invoke('get_resource_usage');
      setUsage(current);
    }, 5000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="resource-monitor">
      <div className="resource-item">
        <span>CPU</span>
        <ProgressBar value={usage?.cpu_percent || 0} max={100} />
        <span>{usage?.cpu_percent.toFixed(1)}%</span>
      </div>
      <div className="resource-item">
        <span>Memory</span>
        <ProgressBar 
          value={usage?.memory_used_mb || 0} 
          max={usage?.memory_total_mb || 1} 
        />
        <span>{usage?.memory_used_mb} / {usage?.memory_total_mb} MB</span>
      </div>
      <div className="resource-item">
        <span>Disk</span>
        <ProgressBar 
          value={usage?.disk_used_gb || 0} 
          max={usage?.disk_total_gb || 1} 
        />
        <span>{usage?.disk_used_gb.toFixed(1)} / {usage?.disk_total_gb.toFixed(1)} GB</span>
      </div>
    </div>
  );
}
```

### Changes Summary for Quota Management

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/management/desktop-quota-manager.ts` | NEW | Desktop-specific quota management |
| `src-tauri/src/resource_monitor.rs` | NEW | Native resource monitoring |
| `src-tauri/src/resource_limits.rs` | NEW | Resource limit enforcement |
| `components/desktop/resource-monitor.tsx` | NEW | UI for resource monitoring |
| `lib/management/quota-manager.ts` | MODIFY | Add desktop mode detection |

---

## Module Area 2: Unified Agent Service

### Current Implementation

**File: `/root/bing/lib/orchestra/unified-agent-service.ts`**

Routes tasks between different agent modes:

```typescript
export interface UnifiedAgentConfig {
  userMessage: string;
  sandboxId?: string;
  mode?: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'mastra-workflow' | 'auto';
  // ... other options
}

export function checkProviderHealth(): ProviderHealth {
  const v2Containerized = containerized && !!sandboxKey;
  const v2Local = !containerized && process.env.LLM_PROVIDER === 'opencode';
  const v2Native = v2Local || v2Containerized;
  const v1Api = !!process.env[apiKeyEnv];
  
  // Determine preferred mode
  let preferredMode = v2Native ? 'v2-native' : 'v1-api';
}
```

**Routing Logic:**
- StatefulAgent for complex multi-step tasks
- V2 (OpenCode) for agentic work
- V1 API as fallback
- Mastra workflows for structured tasks

### Desktop Changes Required

#### 1. Desktop Agent Mode

**Modify: `/root/bing/lib/orchestra/unified-agent-service.ts`**

```typescript
export type UnifiedAgentMode = 
  | 'v1-api' 
  | 'v2-containerized' 
  | 'v2-local' 
  | 'v2-native' 
  | 'mastra-workflow'
  | 'desktop-local'  // NEW: Desktop native execution
  | 'auto';

export function checkProviderHealth(): ProviderHealth {
  // ... existing checks ...
  
  // NEW: Desktop mode detection
  const isDesktop = typeof window !== 'undefined' && 
                    '__TAURI_INTERNALS__' in window;
  
  const v2Desktop = isDesktop && process.env.DESKTOP_LOCAL_EXECUTION !== 'false';
  
  // Update preferred mode logic
  let preferredMode: UnifiedAgentMode = 'v1-api';
  
  if (isDesktop) {
    preferredMode = 'desktop-local';  // Desktop is primary for desktop app
  } else if (v2Native) {
    preferredMode = 'v2-native';
  } else if (v1Api) {
    preferredMode = 'v1-api';
  }
  
  return {
    // ... existing fields ...
    v2Desktop,
    preferredMode,
  };
}
```

#### 2. Desktop Agent Loop

**New File: `/root/bing/lib/orchestra/desktop-agent-loop.ts`**

```typescript
import { invoke } from '@tauri-apps/api/core';
import { DesktopToolRouter } from '../sandbox/desktop-tool-router';
import { DesktopApprovalWorkflow } from '../hitl/desktop-approval-workflow';

export interface DesktopAgentLoopOptions {
  userMessage: string;
  workspaceId: string;
  conversationHistory?: any[];
  onStreamChunk?: (chunk: string) => void;
  onToolExecution?: (toolName: string, args: any, result: ToolResult) => void;
}

export async function runDesktopAgentLoop(
  options: DesktopAgentLoopOptions
): Promise<AgentLoopResult> {
  const { userMessage, workspaceId, conversationHistory } = options;
  
  const toolRouter = new DesktopToolRouter();
  const approvalWorkflow = new DesktopApprovalWorkflow();
  
  // Get system prompt for desktop
  const systemPrompt = getDesktopSystemPrompt(workspaceId);
  
  // Initialize LLM (local or cloud)
  const llm = getLLMProvider();
  
  const result = await llm.runAgentLoop({
    userMessage,
    conversationHistory,
    tools: toolRouter.getAllTools(),
    systemPrompt,
    maxSteps: 20,
    
    async executeTool(name: string, args: any): Promise<ToolResult> {
      // Check if tool requires approval
      const approval = await approvalWorkflow.evaluate(name, args);
      
      if (approval.requiresApproval) {
        const approved = await showDesktopApprovalDialog(approval);
        if (!approved) {
          return {
            success: false,
            output: 'Tool execution denied by user',
            exitCode: 1,
          };
        }
      }
      
      // Execute via Tauri command
      return invoke('execute_tool', {
        workspaceId,
        toolName: name,
        args,
      });
    },
    
    onStreamChunk: options.onStreamChunk,
    onToolExecution: options.onToolExecution,
  });
  
  return result;
}

function getDesktopSystemPrompt(workspaceDir: string): string {
  return `You are an expert software engineer with access to a local development environment.

You can:
- Execute shell commands directly on the user's system (with approval for risky operations)
- Read and write files in the user's workspace
- Use native GUI automation (click, type, screenshot)
- Access system information and processes

Workspace: ${workspaceDir}

Security Guidelines:
- Always use version control (git) before making changes
- Ask for approval before:
  - Deleting files
  - Installing system packages
  - Modifying system configuration
  - Accessing files outside the workspace
- Prefer non-destructive operations
- Create backups before significant changes`;
}
```

#### 3. Desktop LLM Options

**New File: `/root/bing/lib/orchestra/desktop-llm-options.ts`**

```typescript
export interface DesktopLLMConfig {
  mode: 'local' | 'cloud' | 'hybrid';
  
  // Local LLM options
  localModel?: {
    provider: 'ollama' | 'lmstudio' | 'llamafile';
    model: string;
    endpoint?: string;
  };
  
  // Cloud fallback options
  cloudModel?: {
    provider: 'openai' | 'anthropic' | 'google';
    model: string;
    apiKey?: string;
  };
  
  // Routing rules
  routingRules?: {
    simpleTasksUseLocal: boolean;
    complexTasksUseCloud: boolean;
    codeExecutionUseLocal: boolean;
  };
}

export function getDesktopLLMProvider(config: DesktopLLMConfig): LLMProvider {
  if (config.mode === 'local' && config.localModel) {
    return createLocalLLMProvider(config.localModel);
  }
  
  if (config.mode === 'cloud' && config.cloudModel) {
    return createCloudLLMProvider(config.cloudModel);
  }
  
  // Hybrid mode - router based on task complexity
  return createHybridLLMProvider(config);
}
```

### Changes Summary for Unified Agent Service

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/orchestra/unified-agent-service.ts` | MODIFY | Add desktop mode detection |
| `lib/orchestra/desktop-agent-loop.ts` | NEW | Desktop-native agent loop |
| `lib/orchestra/desktop-llm-options.ts` | NEW | Local/cloud LLM routing |
| `lib/sandbox/desktop-tool-router.ts` | NEW | Tool routing for desktop |

---

## Module Area 3: Agent Workspace Management

### Current Implementation

**File: `/root/bing/lib/agent/agent-workspace.ts`**

Manages workspace abstraction for agents:

```typescript
export interface AgentWorkspace {
  agentId: string;
  workspaceId: string;
  sandboxId?: string;
  name: string;
  description?: string;
  createdAt: string;
  status: 'active' | 'suspended' | 'deleted';
  sharedWith: string[];
  tags: string[];
  permissions: Map<string, 'read' | 'write' | 'admin'>;
}

class WorkspaceManager extends EventEmitter {
  private workspaces: Map<string, AgentWorkspace> = new Map();
  private shares: Map<string, Map<string, 'read' | 'write' | 'admin'>> = new Map();
  private marketplace: Map<string, WorkerListing> = new Map();
  
  async createWorkspace(agentId: string, name: string, ...): Promise<AgentWorkspace>
  async shareWorkspace(workspaceId: string, targetAgentIds: string[], ...): Promise<...>
  async checkAccess(workspaceId: string, agentId: string): Promise<...>
}
```

### Desktop Changes Required

#### 1. Desktop Workspace with Local Path

**New File: `/root/bing/lib/agent/desktop-workspace-manager.ts`**

```typescript
import { appDataDir, documentDir } from '@tauri-apps/api/path';
import { watch } from 'chokidar';

export interface DesktopAgentWorkspace extends AgentWorkspace {
  localPath: string;           // Absolute path on local filesystem
  vfsEnabled: boolean;          // Whether VFS sync is enabled
  checkpointEnabled: boolean;   // Whether auto-checkpoint is enabled
  lastSyncTime?: number;        // Last VFS ↔ Local sync time
  localChanges?: string[];      // Files changed locally since last sync
}

export interface DesktopWorkspaceConfig {
  baseDirectory?: string;      // Default: ~/Documents/binG-workspaces
  autoCheckpoint: boolean;     // Default: true
  checkpointInterval: number;  // Default: 5 minutes
  syncOnSave: boolean;         // Default: true
}

class DesktopWorkspaceManager extends WorkspaceManager {
  private config: DesktopWorkspaceConfig;
  private workspaceWatchers = new Map<string, any>();
  
  async createWorkspace(
    agentId: string,
    name: string,
    description?: string,
    tags?: string[]
  ): Promise<DesktopAgentWorkspace> {
    // Create in-memory workspace
    const workspace = await super.createWorkspace(agentId, name, description, tags) as DesktopAgentWorkspace;
    
    // Create local directory
    const baseDir = this.config.baseDirectory || await getDefaultWorkspaceBase();
    const localPath = join(baseDir, workspace.workspaceId);
    await fs.mkdir(localPath, { recursive: true });
    
    workspace.localPath = localPath;
    workspace.vfsEnabled = true;
    workspace.checkpointEnabled = this.config.autoCheckpoint;
    
    // Set up file watcher for local changes
    await this.setupWorkspaceWatcher(workspace);
    
    return workspace;
  }
  
  private async setupWorkspaceWatcher(workspace: DesktopAgentWorkspace): Promise<void> {
    const watcher = watch(workspace.localPath, {
      ignored: /node_modules|\.git|\.opencode|\.checkpoint/,
      persistent: true,
    });
    
    watcher.on('change', (path) => {
      // Track local changes for sync
      const relativePath = relative(workspace.localPath, path);
      if (!workspace.localChanges) {
        workspace.localChanges = [];
      }
      if (!workspace.localChanges.includes(relativePath)) {
        workspace.localChanges.push(relativePath);
      }
      
      // Emit event for UI
      this.emit('local-file-changed', {
        workspaceId: workspace.workspaceId,
        path: relativePath,
      });
    });
    
    this.workspaceWatchers.set(workspace.workspaceId, watcher);
  }
  
  async syncWorkspace(workspaceId: string): Promise<SyncResult> {
    const workspace = this.workspaces.get(workspaceId) as DesktopAgentWorkspace;
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    
    const syncResult: SyncResult = {
      filesSynced: 0,
      errors: [],
    };
    
    // Sync local changes to VFS
    if (workspace.localChanges && workspace.localChanges.length > 0) {
      for (const relativePath of workspace.localChanges) {
        try {
          const fullPath = join(workspace.localPath, relativePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          
          // Write to VFS
          await vfsService.writeFile(
            workspace.workspaceId,
            relativePath,
            content,
            undefined,
            { syncToLocal: false }  // Don't sync back to avoid loop
          );
          
          syncResult.filesSynced++;
        } catch (error: any) {
          syncResult.errors.push({
            path: relativePath,
            error: error.message,
          });
        }
      }
      
      workspace.localChanges = [];
      workspace.lastSyncTime = Date.now();
    }
    
    return syncResult;
  }
}

async function getDefaultWorkspaceBase(): Promise<string> {
  try {
    const docDir = await documentDir();
    return join(docDir, 'binG-workspaces');
  } catch {
    const appData = await appDataDir();
    return join(appData, 'workspaces');
  }
}
```

#### 2. Workspace UI for Desktop

**New Component: `/root/bing/components/desktop/workspace-browser.tsx`**

```tsx
export function WorkspaceBrowser() {
  const [workspaces, setWorkspaces] = useState<DesktopAgentWorkspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  
  useEffect(() => {
    loadWorkspaces();
    
    // Listen for local file changes
    const unsubscribe = listen('local-file-changed', (event) => {
      const { workspaceId, path } = event.payload as {
        workspaceId: string;
        path: string;
      };
      
      // Show sync indicator
      toast.info(`Local change detected: ${path}`, {
        action: {
          label: 'Sync Now',
          onClick: () => syncWorkspace(workspaceId),
        },
      });
    });
    
    return unsubscribe;
  }, []);
  
  const syncWorkspace = async (workspaceId: string) => {
    await invoke('sync_workspace', { workspaceId });
    toast.success('Workspace synced');
  };
  
  return (
    <div className="workspace-browser">
      <div className="workspace-list">
        {workspaces.map(workspace => (
          <WorkspaceCard
            key={workspace.workspaceId}
            workspace={workspace}
            isSelected={workspace.workspaceId === selectedWorkspace}
            onSelect={() => setSelectedWorkspace(workspace.workspaceId)}
            onSync={() => syncWorkspace(workspace.workspaceId)}
          />
        ))}
      </div>
      
      {selectedWorkspace && (
        <WorkspaceDetails
          workspaceId={selectedWorkspace}
          onClose={() => setSelectedWorkspace(null)}
        />
      )}
    </div>
  );
}

function WorkspaceCard({ workspace, isSelected, onSelect, onSync }: {
  workspace: DesktopAgentWorkspace;
  isSelected: boolean;
  onSelect: () => void;
  onSync: () => void;
}) {
  const hasLocalChanges = workspace.localChanges && workspace.localChanges.length > 0;
  
  return (
    <div 
      className={`workspace-card ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="workspace-header">
        <h3>{workspace.name}</h3>
        {hasLocalChanges && (
          <Badge variant="warning">
            {workspace.localChanges!.length} local changes
          </Badge>
        )}
      </div>
      <div className="workspace-meta">
        <span>Created: {formatDate(workspace.createdAt)}</span>
        <span>Status: {workspace.status}</span>
      </div>
      {hasLocalChanges && (
        <Button size="sm" onClick={(e) => { e.stopPropagation(); onSync(); }}>
          Sync Changes
        </Button>
      )}
    </div>
  );
}
```

### Changes Summary for Workspace Management

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/agent/desktop-workspace-manager.ts` | NEW | Desktop workspace with local paths |
| `components/desktop/workspace-browser.tsx` | NEW | UI for browsing workspaces |
| `components/desktop/workspace-card.tsx` | NEW | Workspace card component |
| `lib/agent/agent-workspace.ts` | MODIFY | Extend for desktop support |

---

## Module Area 4: Stateful Agent & HITL

### Current Implementation

**File: `/root/bing/lib/orchestra/stateful-agent/human-in-the-loop.ts`**

```typescript
export interface InterruptRequest {
  type: 'approval_required';
  action: string;
  target: string;
  reason: string;
  diff?: string;
  metadata?: Record<string, any>;
}

export interface InterruptResponse {
  approved: boolean;
  feedback?: string;
  modified_value?: any;
}

class HumanInTheLoopManager {
  private pendingInterrupts: Map<string, {...}> = new Map();
  private handler: InterruptHandler | null = null;
  
  async requestInterrupt(request: InterruptRequest): Promise<InterruptResponse> {
    const interruptId = randomUUID();
    
    const promise = new Promise<InterruptResponse>((resolve) => {
      this.pendingInterrupts.set(interruptId, {
        request,
        resolve,
        createdAt: new Date(),
      });
    });
    
    // Notify handler (webhook, UI, etc.)
    this.handler?.(request);
    
    // Wait for response with timeout
    const response = await Promise.race([
      promise,
      timeout(300000).then(() => ({ approved: false, feedback: 'Timeout' })),
    ]);
    
    this.pendingInterrupts.delete(interruptId);
    return response;
  }
}
```

### Desktop Changes Required

#### 1. Tauri Dialog Provider

**New File: `/root/bing/lib/hitl/tauri-dialog-provider.ts`**

```typescript
import { ask, message, confirm, FilePickerDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export class TauriDialogProvider {
  async requestApproval(request: InterruptRequest): Promise<InterruptResponse> {
    const dialogOptions = {
      title: 'Action Requires Approval',
      kind: request.riskLevel === 'high' ? 'error' : 'warning' as const,
      okLabel: 'Approve',
      cancelLabel: 'Reject',
    };
    
    // Show approval dialog
    const approved = await ask<boolean>(
      `${request.reason}\n\nTarget: ${request.target}`,
      dialogOptions
    );
    
    if (!approved) {
      return {
        approved: false,
        feedback: 'User rejected via dialog',
      };
    }
    
    // If diff is available, show it
    if (request.diff) {
      const modified = await this.showDiffWithEdit(request.diff);
      if (modified === null) {
        return {
          approved: false,
          feedback: 'User cancelled after viewing diff',
        };
      }
      return {
        approved: true,
        modified_value: modified,
      };
    }
    
    return {
      approved: true,
      feedback: 'User approved via dialog',
    };
  }
  
  async showDiffWithEdit(diff: string): Promise<string | null> {
    // Open diff viewer window
    const result = await invoke<string | null>('show_diff_editor', { diff });
    return result;
  }
  
  async showFilePicker(options?: FilePickerDialog): Promise<string | null> {
    return await open(options);
  }
  
  async showSaveDialog(options?: FilePickerDialog): Promise<string | null> {
    return await save(options);
  }
}
```

#### 2. Diff Editor Window

**New File: `/root/bing/src-tauri/src/diff_editor.rs`**

```rust
use tauri::{AppHandle, Manager, WindowBuilder};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffEditorConfig {
    pub diff: String,
    pub title: String,
    pub allow_editing: bool,
}

#[tauri::command]
async fn show_diff_editor(
    app_handle: AppHandle,
    config: DiffEditorConfig,
) -> Result<Option<String>, String> {
    // Check if window already exists
    if let Some(window) = app_handle.get_window("diff-editor") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(None);
    }
    
    // Create diff editor window
    let window = WindowBuilder::new(&app_handle, "diff-editor")
        .title(&config.title)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    
    // Load diff viewer HTML
    let html = generate_diff_viewer_html(&config.diff, config.allow_editing);
    window.navigate(tauri::WebviewUrl::Html(html.into()))
        .map_err(|e| e.to_string())?;
    
    // Wait for user action (approve/reject/modify)
    // This would use Tauri's event system
    // For now, return None (user needs to interact in window)
    Ok(None)
}

fn generate_diff_viewer_html(diff: &str, allow_editing: bool) -> String {
    format!(
        r#"
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: monospace; margin: 20px; }}
                .diff-add {{ background-color: #d4edda; }}
                .diff-remove {{ background-color: #f8d7da; }}
                .diff-context {{ background-color: #f5f5f5; }}
                button {{ margin: 10px 5px; padding: 10px 20px; }}
            </style>
        </head>
        <body>
            <h2>Review Changes</h2>
            <pre id="diff">{diff}</pre>
            <div class="actions">
                <button onclick="window.__TAURI__.invoke('approve_diff')">Approve</button>
                <button onclick="window.__TAURI__.invoke('reject_diff')">Reject</button>
                {if allow_editing { "<button onclick=\"edit_diff()\">Edit</button>" } else { "" }}
            </div>
            <script>
                function edit_diff() {{
                    // Open editor for modifications
                }}
            </script>
        </body>
        </html>
        "#,
        diff = diff.replace('<', "&lt;").replace('>', "&gt;")
    )
}
```

#### 3. Approval Center

**New Component: `/root/bing/app/desktop/approval-center/page.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface PendingApproval {
  id: string;
  type: string;
  action: string;
  target: string;
  reason: string;
  diff?: string;
  createdAt: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export default function ApprovalCenter() {
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<any[]>([]);
  
  useEffect(() => {
    loadPendingApprovals();
    loadApprovalHistory();
    
    // Listen for new approval requests
    const unsubscribe = listen<PendingApproval>('approval-request', (event) => {
      setPendingApprovals(prev => [...prev, event.payload]);
      
      // Show notification
      new Notification('Approval Required', {
        body: event.payload.reason,
      });
    });
    
    return unsubscribe;
  }, []);
  
  const handleApprove = async (approvalId: string) => {
    await invoke('resolve_approval', {
      approvalId,
      decision: { approved: true },
    });
    
    setPendingApprovals(prev => prev.filter(a => a.id !== approvalId));
  };
  
  const handleReject = async (approvalId: string, feedback?: string) => {
    await invoke('resolve_approval', {
      approvalId,
      decision: { approved: false, feedback },
    });
    
    setPendingApprovals(prev => prev.filter(a => a.id !== approvalId));
  };
  
  return (
    <div className="approval-center">
      <h1>Approval Center</h1>
      
      <section className="pending-approvals">
        <h2>Pending Approvals ({pendingApprovals.length})</h2>
        {pendingApprovals.length === 0 ? (
          <p className="empty-state">No pending approvals</p>
        ) : (
          <div className="approval-list">
            {pendingApprovals.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onApprove={() => handleApprove(approval.id)}
                onReject={() => handleReject(approval.id)}
              />
            ))}
          </div>
        )}
      </section>
      
      <section className="approval-history">
        <h2>History</h2>
        <ApprovalHistoryTable history={approvalHistory} />
      </section>
    </div>
  );
}

function ApprovalCard({ approval, onApprove, onReject }: {
  approval: PendingApproval;
  onApprove: () => void;
  onReject: (feedback?: string) => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [feedback, setFeedback] = useState('');
  
  return (
    <div className={`approval-card risk-${approval.riskLevel}`}>
      <div className="approval-header">
        <h3>{approval.action}</h3>
        <Badge variant={approval.riskLevel === 'high' ? 'destructive' : 'default'}>
          {approval.riskLevel.toUpperCase()}
        </Badge>
      </div>
      
      <div className="approval-details">
        <p><strong>Target:</strong> {approval.target}</p>
        <p><strong>Reason:</strong> {approval.reason}</p>
        <p><strong>Time:</strong> {formatDistanceToNow(new Date(approval.createdAt))} ago</p>
      </div>
      
      {approval.diff && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? 'Hide Diff' : 'Show Diff'}
          </Button>
          {showDiff && (
            <pre className="diff-viewer">{approval.diff}</pre>
          )}
        </div>
      )}
      
      <div className="approval-actions">
        <input
          type="text"
          placeholder="Feedback (optional)"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="feedback-input"
        />
        <Button onClick={onApprove} variant="default">
          Approve
        </Button>
        <Button onClick={() => onReject(feedback)} variant="destructive">
          Reject
        </Button>
      </div>
    </div>
  );
}
```

### Changes Summary for Stateful Agent & HITL

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/hitl/tauri-dialog-provider.ts` | NEW | Native dialog integration |
| `src-tauri/src/diff_editor.rs` | NEW | Diff viewer window |
| `src-tauri/src/approval_manager.rs` | NEW | Approval request management |
| `app/desktop/approval-center/page.tsx` | NEW | Approval center UI |
| `components/desktop/approval-card.tsx` | NEW | Approval card component |
| `lib/orchestra/stateful-agent/human-in-the-loop.ts` | MODIFY | Add Tauri dialog handler |

---

## Module Area 5: MCP Integration (Deep Dive)

### Additional Desktop MCP Considerations

#### 1. Bundled MCP Servers

**Directory: `/root/bing/src-tauri/binaries/`**

Pre-compiled MCP servers to bundle:

```
src-tauri/binaries/
├── mcp-filesystem-server    # Filesystem access
├── mcp-sqlite-server        # SQLite database access
├── mcp-system-info-server   # System information
├── mcp-git-server          # Git operations
└── mcp-notification-server  # Desktop notifications
```

**Build Configuration:**

```toml
# src-tauri/Cargo.toml
[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[[bin]]
name = "mcp-filesystem-server"
path = "binaries/mcp-filesystem-server.rs"

[[bin]]
name = "mcp-sqlite-server"
path = "binaries/mcp-sqlite-server.rs"
```

#### 2. MCP Server: Filesystem

**New File: `/root/bing/src-tauri/binaries/mcp-filesystem-server.rs`**

```rust
use mcp_server::{Server, Tool, ToolCallResult};
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::fs;

struct FilesystemServer {
    allowed_roots: Vec<PathBuf>,
}

#[tokio::main]
async fn main() {
    let server = FilesystemServer {
        allowed_roots: vec![
            dirs::document_dir().unwrap(),
            dirs::home_dir().unwrap(),
        ],
    };
    
    server.run().await;
}

impl FilesystemServer {
    async fn run(self) {
        let mut mcp_server = Server::new("filesystem");
        
        // Register tools
        mcp_server.register_tool(Tool {
            name: "read_file".to_string(),
            description: "Read contents of a file".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path"}
                },
                "required": ["path"]
            }),
        });
        
        mcp_server.register_tool(Tool {
            name: "write_file".to_string(),
            description: "Write content to a file".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }),
        });
        
        // Run server
        mcp_server.serve(self).await;
    }
    
    async fn read_file(&self, path: &str) -> Result<String, String> {
        let full_path = self.validate_path(path)?;
        fs::read_to_string(full_path).await.map_err(|e| e.to_string())
    }
    
    async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let full_path = self.validate_path(path)?;
        fs::write(full_path, content).await.map_err(|e| e.to_string())
    }
    
    fn validate_path(&self, path: &str) -> Result<PathBuf, String> {
        let full_path = PathBuf::from(path);
        
        // Ensure path is within allowed roots
        for root in &self.allowed_roots {
            if full_path.starts_with(root) {
                return Ok(full_path);
            }
        }
        
        Err(format!("Path {} is outside allowed directories", path))
    }
}
```

#### 3. MCP Connection Manager for Desktop

**New File: `/root/bing/lib/mcp/desktop-connection-manager.ts`**

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { appDataDir } from '@tauri-apps/api/path';

export interface BundledMCPServer {
  id: string;
  name: string;
  binary: string;
  args?: string[];
  autoStart: boolean;
  transport: 'stdio' | 'http';
}

const BUNDLED_SERVERS: BundledMCPServer[] = [
  {
    id: 'desktop-fs',
    name: 'Desktop Filesystem',
    binary: 'mcp-filesystem-server',
    autoStart: true,
    transport: 'stdio',
  },
  {
    id: 'desktop-sqlite',
    name: 'Desktop SQLite',
    binary: 'mcp-sqlite-server',
    autoStart: true,
    transport: 'stdio',
  },
  {
    id: 'desktop-system',
    name: 'Desktop System Info',
    binary: 'mcp-system-info-server',
    autoStart: false,
    transport: 'stdio',
  },
];

class DesktopMCPConnectionManager {
  private processes = new Map<string, ChildProcess>();
  private connections = new Map<string, MCPClient>();
  
  async startServer(serverId: string): Promise<void> {
    const server = BUNDLED_SERVERS.find(s => s.id === serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    
    // Get binary path
    const appData = await appDataDir();
    const binaryPath = join(appData, 'binaries', server.binary);
    
    // Spawn process
    const proc = spawn(binaryPath, server.args || []);
    
    // Set up stdio transport
    const connection = await this.createStdioConnection(proc);
    
    this.processes.set(serverId, proc);
    this.connections.set(serverId, connection);
    
    // Handle process exit
    proc.on('exit', (code) => {
      console.log(`MCP server ${serverId} exited with code ${code}`);
      this.connections.delete(serverId);
      this.processes.delete(serverId);
    });
  }
  
  async stopServer(serverId: string): Promise<void> {
    const proc = this.processes.get(serverId);
    if (proc) {
      proc.kill();
      this.processes.delete(serverId);
      this.connections.delete(serverId);
    }
  }
  
  async startAllAutoStartServers(): Promise<void> {
    for (const server of BUNDLED_SERVERS) {
      if (server.autoStart) {
        await this.startServer(server.id);
      }
    }
  }
  
  getConnection(serverId: string): MCPClient | undefined {
    return this.connections.get(serverId);
  }
}
```

---

## Summary: Complete File Inventory

### New Files Required (Complete List)

#### Rust Backend (`src-tauri/`)

| Path | Purpose | Priority |
|------|---------|----------|
| `src/shell/executor.rs` | Secure shell execution | P0 |
| `src/shell/security_policy.rs` | Command validation | P0 |
| `src/vfs/sync_engine.rs` | VFS ↔ Local sync | P0 |
| `src/checkpoint/manager.rs` | Checkpoint operations | P0 |
| `src/db.rs` | SQLite database layer | P0 |
| `src/db_encryption.rs` | Database encryption | P2 |
| `src/db_backup.rs` | Auto-backup system | P1 |
| `src/db_commands.rs` | Tauri DB commands | P0 |
| `src/desktop_control.rs` | Mouse/keyboard control | P1 |
| `src/tray.rs` | System tray integration | P1 |
| `src/approval_background.rs` | Background approvals | P1 |
| `src/session_background.rs` | Background sessions | P1 |
| `src/resource_monitor.rs` | Resource monitoring | P1 |
| `src/resource_limits.rs` | Resource limits | P1 |
| `src/diff_editor.rs` | Diff viewer window | P1 |
| `src/mcp_commands.rs` | MCP server spawning | P1 |
| `binaries/mcp-filesystem-server.rs` | Bundled FS server | P1 |
| `binaries/mcp-sqlite-server.rs` | Bundled SQLite server | P2 |
| `binaries/mcp-system-info-server.rs` | Bundled system info | P2 |
| `schema.sql` | Desktop DB schema | P0 |

#### TypeScript Frontend (`lib/`)

| Path | Purpose | Priority |
|------|---------|----------|
| `lib/sandbox/providers/desktop-provider.ts` | Desktop sandbox provider | P0 |
| `lib/sandbox/desktop-checkpoint-manager.ts` | Checkpoint management | P0 |
| `lib/sandbox/desktop-computer-use.ts` | Desktop computer use tools | P1 |
| `lib/sandbox/desktop-fs-tools.ts` | Desktop filesystem tools | P0 |
| `lib/sandbox/desktop-process-tools.ts` | Process management tools | P2 |
| `lib/sandbox/desktop-system-tools.ts` | System info tools | P2 |
| `lib/sandbox/desktop-tool-router.ts` | Tool routing | P0 |
| `lib/virtual-filesystem/desktop-vfs-service.ts` | Desktop VFS with sync | P0 |
| `lib/hitl/tauri-dialog-provider.ts` | Native dialogs | P0 |
| `lib/hitl/desktop-approval-config.ts` | Approval configuration | P1 |
| `lib/hitl/desktop-approval-workflow.ts` | Desktop approval workflow | P0 |
| `lib/hitl/desktop-workflow-store.ts` | Workflow persistence | P1 |
| `lib/mcp/desktop-mcp-manager.ts` | MCP server management | P1 |
| `lib/mcp/desktop-transport.ts` | MCP Tauri transport | P1 |
| `lib/mcp/desktop-fs-tools.ts` | Desktop MCP tools | P1 |
| `lib/mcp/local-registry.ts` | Local MCP discovery | P2 |
| `lib/session/desktop-session-sync.ts` | Session state sync | P1 |
| `lib/agent/desktop-workspace-manager.ts` | Desktop workspace mgmt | P1 |
| `lib/management/desktop-quota-manager.ts` | Desktop quota mgmt | P1 |
| `lib/orchestra/desktop-agent-loop.ts` | Desktop agent loop | P0 |
| `lib/orchestra/desktop-llm-options.ts` | Local/cloud LLM routing | P1 |
| `lib/orchestra/desktop-approval-workflow.ts` | Desktop approval | P0 |
| `lib/database/desktop-migration.ts` | DB migration | P1 |

#### UI Components (`components/` & `app/`)

| Path | Purpose | Priority |
|------|---------|----------|
| `components/desktop/checkpoint-manager.tsx` | Checkpoint UI | P0 |
| `components/desktop/file-sync-status.tsx` | Sync indicator | P0 |
| `components/desktop/resource-monitor.tsx` | Resource monitor | P1 |
| `components/desktop/workspace-browser.tsx` | Workspace browser | P1 |
| `components/desktop/workspace-card.tsx` | Workspace card | P1 |
| `components/desktop/approval-card.tsx` | Approval card | P0 |
| `app/desktop/approval-center/page.tsx` | Approval center page | P0 |
| `app/desktop/settings/page.tsx` | Desktop settings | P1 |
| `app/desktop/workspaces/page.tsx` | Workspaces page | P1 |

### Modified Files (Key Changes)

| Path | Change Description | Priority |
|------|-------------------|----------|
| `lib/orchestra/unified-agent-service.ts` | Add desktop mode | P0 |
| `lib/orchestra/agent-loop.ts` | Desktop tool execution | P0 |
| `lib/orchestra/stateful-agent/human-in-the-loop.ts` | Tauri dialog handler | P0 |
| `lib/agent/agent-workspace.ts` | Desktop workspace support | P1 |
| `lib/management/quota-manager.ts` | Desktop quota model | P1 |
| `lib/mcp/client.ts` | Desktop transport option | P1 |
| `lib/mcp/server.ts` | Desktop filesystem tools | P1 |
| `lib/sandbox/providers/index.ts` | Register desktop provider | P0 |
| `lib/database/db.ts` | Desktop DB path | P0 |
| `lib/virtual-filesystem/virtual-filesystem-service.ts` | Desktop sync option | P0 |

---

## Implementation Priority Matrix

### Phase 1: Core Execution (Weeks 1-4)

**P0 - Must Have:**
- Shell executor with security
- Desktop sandbox provider
- VFS sync engine
- Checkpoint manager
- Desktop agent loop
- Tauri dialog provider
- Basic approval workflow

### Phase 2: User Experience (Weeks 5-8)

**P1 - Should Have:**
- Checkpoint UI
- File sync status
- Approval center
- Resource monitoring
- System tray integration
- Workspace browser
- MCP bundled servers

### Phase 3: Advanced Features (Weeks 9-12)

**P2 - Nice to Have:**
- Database encryption
- Local MCP discovery
- Process management tools
- System info tools
- Advanced approval workflows
- Auto-backup system

---

## Testing Strategy for Desktop

### Unit Tests

```typescript
// __tests__/desktop-shell-executor.test.ts
describe('DesktopShellExecutor', () => {
  it('should block dangerous commands', () => {
    const executor = new DesktopShellExecutor();
    expect(() => executor.validate('rm -rf /')).toThrow();
  });
  
  it('should allow safe commands', () => {
    const executor = new DesktopShellExecutor();
    expect(executor.validate('ls -la')).toBe(true);
  });
});

// __tests__/desktop-vfs-sync.test.ts
describe('DesktopVFSSync', () => {
  it('should sync VFS to local filesystem', async () => {
    const sync = new DesktopVFSSync();
    await sync.syncToLocal('test.txt', 'content');
    // Verify file exists locally
  });
});
```

### Integration Tests

```typescript
// __tests__/desktop-agent-integration.test.ts
describe('Desktop Agent Integration', () => {
  it('should execute complete agent loop locally', async () => {
    const result = await runDesktopAgentLoop({
      userMessage: 'Create a hello.txt file',
      workspaceId: 'test-workspace',
    });
    expect(result.success).toBe(true);
    expect(fs.existsSync('hello.txt')).toBe(true);
  });
});
```

### E2E Tests

```typescript
// __tests__/e2e/desktop-workflow.test.ts
describe('Desktop Workflow E2E', () => {
  it('should handle approval workflow', async () => {
    // Start agent with risky command
    // Verify approval dialog appears
    // Approve and verify execution
  });
});
```

---

This comprehensive analysis provides a complete roadmap for Tauri desktop integration across all modules in the codebase.
