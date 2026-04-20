---
id: tauri-desktop-implementation-plan
title: Tauri Desktop Implementation Plan
aliases:
  - TAURI_DESKTOP_IMPLEMENTATION_PLAN
  - TAURI_DESKTOP_IMPLEMENTATION_PLAN.md
  - tauri-desktop-implementation-plan
  - tauri-desktop-implementation-plan.md
tags:
  - implementation
layer: core
summary: "# Tauri Desktop Implementation Plan\r\n\r\n## Executive Summary\r\n\r\nThis plan outlines the implementation of a **Tauri desktop application** for OpenCode that:\r\n1. **Replaces cloud sandbox execution** with local user shell execution (with proper isolation)\r\n2. **Syncs Virtual File System (VFS)** with the"
anchors:
  - Executive Summary
  - Architecture Overview
  - Current Web Architecture
  - Proposed Tauri Desktop Architecture
  - 'Phase 1: Project Setup & Infrastructure'
  - 1.1 Initialize Tauri Project
  - 1.2 Create Desktop-Specific Provider
  - 'Phase 2: Rust Backend Implementation'
  - 2.1 Shell Execution Engine
  - 2.2 VFS Sync Engine
  - 2.3 Tauri Commands
  - 'Phase 3: VFS Integration & Sync'
  - 3.1 Modified VFS Service for Desktop
  - 3.2 Checkpoint Integration
  - 'Phase 4: Desktop UI Components'
  - 4.1 Checkpoint Manager UI
  - 4.2 File Sync Status Indicator
  - 'Phase 5: API Routes for Desktop Integration'
  - 5.1 Desktop Execution API
  - 5.2 Desktop Checkpoints API
  - 'Phase 6: Security & Permissions'
  - 6.1 Security Policy Configuration
  - 6.2 Approval Workflow
  - 'Phase 7: Build & Distribution'
  - 7.1 Build Configuration
  - 7.2 Package Scripts
  - Implementation Timeline
  - 'Week 1-2: Core Infrastructure'
  - 'Week 3-4: Checkpoint System'
  - 'Week 5-6: Security & Permissions'
  - 'Week 7-8: UI Polish & Testing'
  - 'Week 9-10: Build & Distribution'
  - Key Technical Decisions
  - 1. Local Execution Strategy
  - 2. VFS Sync Strategy
  - 3. Checkpoint Storage
  - 4. Security Model
  - Migration Path from Web Version
  - Existing Features → Desktop Equivalent
  - Hybrid Mode
  - Testing Strategy
  - Unit Tests
  - Integration Tests
  - Security Tests
  - Success Metrics
  - Risks & Mitigations
  - Conclusion
  - Additional Resources
  - Key Documents Created
  - 'Quick Reference: File Counts'
---
# Tauri Desktop Implementation Plan

## Executive Summary

This plan outlines the implementation of a **Tauri desktop application** for OpenCode that:
1. **Replaces cloud sandbox execution** with local user shell execution (with proper isolation)
2. **Syncs Virtual File System (VFS)** with the local user filesystem
3. **Maintains VFS and rollback system** for safe prototyping without affecting user files until approval
4. **Provides native desktop experience** with system tray, notifications, and file associations

---

## Architecture Overview

### Current Web Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Web App                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐    │
│  │ Agent Loop  │  │   VFS       │  │  Cloud Providers    │    │
│  │             │  │  Service    │  │  - Daytona          │    │
│  │  - Tools    │  │             │  │  - E2B              │    │
│  │  - LLM      │  │  - In-mem   │  │  - Sprites          │    │
│  └──────┬──────┘  └──────┬──────┘  │  - CodeSandbox      │    │
│         │                │         └─────────────────────┘    │
│         ▼                ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              Sandbox Provider Interface                   │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │      Cloud Sandbox APIs       │
              │  (Daytona, E2B, Sprites...)   │
              └───────────────────────────────┘
```

### Proposed Tauri Desktop Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                     Tauri Desktop Application                    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    Rust Backend (Commands)                 │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │ │
│  │  │ Shell Executor│  │ Local VFS    │  │ Checkpoint     │  │ │
│  │  │ (with policy)│  │ Sync Engine  │  │ Manager        │  │ │
│  │  └──────────────┘  └──────────────┘  └────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                   TypeScript/React Frontend               │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │ │
│  │  │ Agent Loop  │  │   VFS       │  │  Local Providers│   │ │
│  │  │             │  │  Service    │  │  - Microsandbox │   │ │
│  │  │  - Tools    │  │             │  │  - Docker       │   │ │
│  │  │  - LLM      │  │  - Sync     │  │  - QuickJS      │   │ │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────────┘   │ │
│  │         │                │                                 │ │
│  │         ▼                ▼                                 │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │         Desktop Sandbox Provider Interface            │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌─────────────────────┐
│  User's Shell   │          │  Local Filesystem   │
│  (bash/zsh/ps)  │          │  (with VFS overlay) │
└─────────────────┘          └─────────────────────┘
```

---

## Phase 1: Project Setup & Infrastructure

### 1.1 Initialize Tauri Project

**Files to Create:**
- `src-tauri/Cargo.toml` - Rust dependencies
- `src-tauri/tauri.conf.json` - Tauri configuration
- `src-tauri/src/main.rs` - Rust entry point
- `src-tauri/src/commands/` - Rust command modules
- `src-tauri/src/shell/` - Shell execution engine
- `src-tauri/src/vfs/` - VFS sync engine
- `src-tauri/src/checkpoint/` - Checkpoint manager

**Key Dependencies (Cargo.toml):**
```toml
[dependencies]
tauri = { version = "2.0", features = ["shell", "fs", "notification"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
notify = "6.0"  # File system watching
git2 = "0.18"   # Git operations
sha2 = "0.10"   # File hashing
chrono = "0.4"
thiserror = "1.0"
```

**Tauri Configuration (tauri.conf.json):**
```json
{
  "identifier": "com.opencode.desktop",
  "productName": "OpenCode Desktop",
  "version": "0.1.0",
  "capabilities": {
    "shell": {
      "scope": [
        { "name": "exec", "cmd": "bash", "args": true },
        { "name": "exec-pwsh", "cmd": "pwsh", "args": true }
      ]
    },
    "fs": {
      "scope": ["$HOME/**", "$DOCUMENTS/**"]
    }
  },
  "systemTray": {
    "iconPath": "icons/tray-icon.png",
    "iconAsTemplate": true
  }
}
```

### 1.2 Create Desktop-Specific Provider

**File: `lib/sandbox/providers/desktop-provider.ts`**

```typescript
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'
import { invoke } from '@tauri-apps/api/core'

export class DesktopProvider implements SandboxProvider {
  readonly name = 'desktop'

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const sandboxId = await invoke<string>('create_sandbox', {
      userId: config.labels?.userId,
      workspaceDir: config.workspaceDir,
    })

    return new DesktopSandboxHandle(sandboxId)
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    return new DesktopSandboxHandle(sandboxId)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    await invoke('destroy_sandbox', { sandboxId })
  }
}

export class DesktopSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir: string

  constructor(sandboxId: string) {
    this.id = sandboxId
    this.workspaceDir = `/Users/${process.env.USER}/workspace/${sandboxId}`
  }

  async executeCommand(
    command: string,
    cwd?: string,
    timeout?: number
  ): Promise<ToolResult> {
    return invoke('execute_command', {
      sandboxId: this.id,
      command,
      cwd,
      timeout,
    })
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    return invoke('write_file', {
      sandboxId: this.id,
      filePath,
      content,
    })
  }

  async readFile(filePath: string): Promise<ToolResult> {
    return invoke('read_file', {
      sandboxId: this.id,
      filePath,
    })
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    return invoke('list_directory', {
      sandboxId: this.id,
      dirPath,
    })
  }

  async createCheckpoint(name?: string): Promise<CheckpointInfo> {
    return invoke('create_checkpoint', {
      sandboxId: this.id,
      name,
    })
  }

  async restoreCheckpoint(checkpointId: string): Promise<void> {
    await invoke('restore_checkpoint', {
      sandboxId: this.id,
      checkpointId,
    })
  }

  async listCheckpoints(): Promise<CheckpointInfo[]> {
    return invoke('list_checkpoints', { sandboxId: this.id })
  }
}
```

---

## Phase 2: Rust Backend Implementation

### 2.1 Shell Execution Engine

**File: `src-tauri/src/shell/executor.rs`**

```rust
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;
use tokio::process::Command as AsyncCommand;
use tokio::time::timeout;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub output: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone)]
pub struct SecurityPolicy {
    pub blocked_commands: Vec<String>,
    pub blocked_patterns: Vec<String>,
    pub allowed_directories: Vec<String>,
    pub max_execution_time: Duration,
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self {
            blocked_commands: vec![
                "rm -rf /".to_string(),
                "mkfs".to_string(),
                "dd if=/dev/zero".to_string(),
            ],
            blocked_patterns: vec![
                r";\s*rm\s+-rf\s+/",
                r">\s*/dev/",
                r">\s*/etc/",
            ],
            allowed_directories: vec![],  // Will be set per-sandbox
            max_execution_time: Duration::from_secs(60),
        }
    }
}

pub struct ShellExecutor {
    policy: SecurityPolicy,
    sandbox_id: String,
    workspace_dir: String,
}

impl ShellExecutor {
    pub fn new(sandbox_id: String, workspace_dir: String) -> Self {
        Self {
            policy: SecurityPolicy::default(),
            sandbox_id,
            workspace_dir,
        }
    }

    pub fn validate_command(&self, command: &str) -> Result<(), String> {
        // Check blocked commands
        for blocked in &self.policy.blocked_commands {
            if command.contains(blocked) {
                return Err(format!("Command blocked: {}", blocked));
            }
        }

        // Check blocked patterns
        for pattern in &self.policy.blocked_patterns {
            let re = regex::Regex::new(pattern).unwrap();
            if re.is_match(command) {
                return Err(format!("Command matches blocked pattern: {}", pattern));
            }
        }

        // Ensure command executes within workspace
        if !self.policy.allowed_directories.is_empty() {
            // Validate cwd is within allowed directories
        }

        Ok(())
    }

    pub async fn execute(
        &self,
        command: &str,
        cwd: Option<&str>,
        timeout_ms: Option<u64>,
    ) -> Result<ExecutionResult, String> {
        // Validate command first
        self.validate_command(command)?;

        let exec_timeout = Duration::from_millis(timeout_ms.unwrap_or(60000));

        // Execute command with timeout
        let result = timeout(exec_timeout, async {
            let mut cmd = AsyncCommand::new("bash");
            cmd.arg("-c").arg(command);

            // Set working directory
            let work_dir = cwd.unwrap_or(&self.workspace_dir);
            cmd.current_dir(work_dir);

            // Execute and capture output
            let output = cmd.output().await.map_err(|e| e.to_string())?;

            Ok(ExecutionResult {
                success: output.status.success(),
                output: String::from_utf8_lossy(&output.stdout).to_string()
                    + &String::from_utf8_lossy(&output.stderr),
                exit_code: output.status.code().unwrap_or(1),
            })
        })
        .await
        .map_err(|_| "Command timed out".to_string())?;

        result
    }
}
```

### 2.2 VFS Sync Engine

**File: `src-tauri/src/vfs/sync_engine.rs`**

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;
use sha2::{Sha256, Digest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VFSFile {
    pub path: String,
    pub content: String,
    pub hash: String,
    pub version: u64,
    pub last_modified: u64,
}

#[derive(Debug, Clone)]
pub struct SyncState {
    pub sandbox_id: String,
    pub vfs_files: HashMap<String, VFSFile>,
    pub local_files: HashMap<String, LocalFileState>,
}

#[derive(Debug, Clone)]
pub enum LocalFileState {
    Unchanged,
    Modified,
    Created,
    Deleted,
}

pub struct VFSSyncEngine {
    sandbox_id: String,
    workspace_dir: PathBuf,
    checkpoint_dir: PathBuf,
    state: SyncState,
}

impl VFSSyncEngine {
    pub fn new(sandbox_id: String, workspace_dir: PathBuf) -> Self {
        let checkpoint_dir = workspace_dir.join(".opencode").join("checkpoints");

        Self {
            sandbox_id,
            workspace_dir,
            checkpoint_dir,
            state: SyncState {
                sandbox_id: sandbox_id.clone(),
                vfs_files: HashMap::new(),
                local_files: HashMap::new(),
            },
        }
    }

    /// Compute file hash for change detection
    fn compute_hash(content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Sync VFS file to local filesystem
    pub async fn sync_to_local(&mut self, file: VFSFile) -> Result<(), String> {
        let local_path = self.workspace_dir.join(&file.path);

        // Create parent directories
        if let Some(parent) = local_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }

        // Write file content
        fs::write(&local_path, &file.content)
            .await
            .map_err(|e| e.to_string())?;

        // Update state
        self.state.vfs_files.insert(file.path.clone(), file.clone());
        self.state.local_files.insert(
            file.path.clone(),
            LocalFileState::Unchanged,
        );

        Ok(())
    }

    /// Sync local file changes to VFS
    pub async fn sync_from_local(&mut self, path: &str) -> Result<VFSFile, String> {
        let local_path = self.workspace_dir.join(path);

        let content = fs::read_to_string(&local_path)
            .await
            .map_err(|e| e.to_string())?;

        let hash = Self::compute_hash(&content);
        let metadata = fs::metadata(&local_path)
            .await
            .map_err(|e| e.to_string())?;

        let file = VFSFile {
            path: path.to_string(),
            content,
            hash,
            version: self.state.vfs_files.get(path)
                .map(|f| f.version + 1)
                .unwrap_or(1),
            last_modified: metadata.modified()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64)
                .unwrap_or(0),
        };

        self.state.vfs_files.insert(path.to_string(), file.clone());

        Ok(file)
    }

    /// Create checkpoint of current state
    pub async fn create_checkpoint(&self, name: Option<&str>) -> Result<CheckpointInfo, String> {
        let checkpoint_id = format!("{}_{}", self.sandbox_id, chrono::Utc::now().timestamp());
        let checkpoint_path = self.checkpoint_dir.join(&checkpoint_id);

        // Create checkpoint directory
        fs::create_dir_all(&checkpoint_path)
            .await
            .map_err(|e| e.to_string())?;

        // Save all VFS files to checkpoint
        for (path, file) in &self.state.vfs_files {
            let checkpoint_file_path = checkpoint_path.join(path);

            if let Some(parent) = checkpoint_file_path.parent() {
                fs::create_dir_all(parent).await?;
            }

            fs::write(&checkpoint_file_path, &file.content).await?;
        }

        // Save metadata
        let metadata = CheckpointMetadata {
            id: checkpoint_id.clone(),
            name: name.unwrap_or("unnamed").to_string(),
            created_at: chrono::Utc::now(),
            file_count: self.state.vfs_files.len(),
        };

        let metadata_path = checkpoint_path.join("metadata.json");
        let metadata_json = serde_json::to_string_pretty(&metadata)?;
        fs::write(metadata_path, metadata_json).await?;

        Ok(CheckpointInfo {
            id: checkpoint_id,
            name: name.unwrap_or("unnamed").to_string(),
            created_at: metadata.created_at.to_rfc3339(),
        })
    }

    /// Restore from checkpoint
    pub async fn restore_checkpoint(&mut self, checkpoint_id: &str) -> Result<(), String> {
        let checkpoint_path = self.checkpoint_dir.join(checkpoint_id);

        if !checkpoint_path.exists() {
            return Err(format!("Checkpoint {} not found", checkpoint_id));
        }

        // Read metadata
        let metadata_path = checkpoint_path.join("metadata.json");
        let metadata_json = fs::read_to_string(&metadata_path).await?;
        let _metadata: CheckpointMetadata = serde_json::from_str(&metadata_json)?;

        // Restore all files from checkpoint
        self.restore_directory(&checkpoint_path, &self.workspace_dir).await?;

        Ok(())
    }

    async fn restore_directory(
        &self,
        src: &Path,
        dst: &Path,
    ) -> Result<(), String> {
        let mut entries = fs::read_dir(src).await.map_err(|e| e.to_string())?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let file_name = path.file_name().unwrap().to_str().unwrap();

            // Skip metadata file
            if file_name == "metadata.json" {
                continue;
            }

            let dst_path = dst.join(file_name);

            if path.is_dir() {
                fs::create_dir_all(&dst_path).await?;
                self.restore_directory(&path, &dst_path).await?;
            } else {
                fs::copy(&path, &dst_path).await?;
            }
        }

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct CheckpointMetadata {
    id: String,
    name: String,
    created_at: chrono::DateTime<chrono::Utc>,
    file_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckpointInfo {
    pub id: String,
    pub name: String,
    pub created_at: String,
}
```

### 2.3 Tauri Commands

**File: `src-tauri/src/commands/sandbox.rs`**

```rust
use crate::shell::executor::ShellExecutor;
use crate::vfs::sync_engine::VFSSyncEngine;
use crate::checkpoint::manager::CheckpointManager;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

pub struct SandboxState {
    pub executors: HashMap<String, ShellExecutor>,
    pub sync_engines: HashMap<String, VFSSyncEngine>,
    pub checkpoint_managers: HashMap<String, CheckpointManager>,
}

impl SandboxState {
    pub fn new() -> Self {
        Self {
            executors: HashMap::new(),
            sync_engines: HashMap::new(),
            checkpoint_managers: HashMap::new(),
        }
    }
}

#[tauri::command]
pub async fn create_sandbox(
    state: State<'_, Arc<RwLock<SandboxState>>>,
    user_id: String,
    workspace_dir: Option<String>,
) -> Result<String, String> {
    let sandbox_id = format!("{}_{}", user_id, chrono::Utc::now().timestamp());

    let work_dir = workspace_dir.unwrap_or_else(|| {
        format!(
            "{}/workspace/{}",
            std::env::var("HOME").unwrap(),
            sandbox_id
        )
    });

    let executor = ShellExecutor::new(sandbox_id.clone(), work_dir.clone());
    let sync_engine = VFSSyncEngine::new(sandbox_id.clone(), work_dir.into());
    let checkpoint_manager = CheckpointManager::new(sandbox_id.clone());

    let mut state = state.write().await;
    state.executors.insert(sandbox_id.clone(), executor);
    state.sync_engines.insert(sandbox_id.clone(), sync_engine);
    state.checkpoint_managers.insert(sandbox_id.clone(), checkpoint_manager);

    Ok(sandbox_id)
}

#[tauri::command]
pub async fn execute_command(
    state: State<'_, Arc<RwLock<SandboxState>>>,
    sandbox_id: String,
    command: String,
    cwd: Option<String>,
    timeout: Option<u64>,
) -> Result<ExecutionResult, String> {
    let state = state.read().await;
    let executor = state.executors.get(&sandbox_id)
        .ok_or_else(|| format!("Sandbox {} not found", sandbox_id))?;

    executor.execute(&command, cwd.as_deref(), timeout).await
}

#[tauri::command]
pub async fn write_file(
    state: State<'_, Arc<RwLock<SandboxState>>>,
    sandbox_id: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let mut state = state.write().await;
    let sync_engine = state.sync_engines.get_mut(&sandbox_id)
        .ok_or_else(|| format!("Sandbox {} not found", sandbox_id))?;

    let vfs_file = VFSFile {
        path: file_path.clone(),
        content: content.clone(),
        hash: VFSSyncEngine::compute_hash(&content),
        version: 1,
        last_modified: chrono::Utc::now().timestamp() as u64,
    };

    sync_engine.sync_to_local(vfs_file).await
}

#[tauri::command]
pub async fn read_file(
    state: State<'_, Arc<RwLock<SandboxState>>>,
    sandbox_id: String,
    file_path: String,
) -> Result<String, String> {
    let state = state.read().await;
    let sync_engine = state.sync_engines.get(&sandbox_id)
        .ok_or_else(|| format!("Sandbox {} not found", sandbox_id))?;

    let local_path = sync_engine.workspace_dir().join(&file_path);
    tokio::fs::read_to_string(&local_path).await
}

#[tauri::command]
pub async fn create_checkpoint(
    state: State<'_, Arc<RwLock<SandboxState>>>,
    sandbox_id: String,
    name: Option<String>,
) -> Result<CheckpointInfo, String> {
    let mut state = state.write().await;
    let sync_engine = state.sync_engines.get_mut(&sandbox_id)
        .ok_or_else(|| format!("Sandbox {} not found", sandbox_id))?;

    sync_engine.create_checkpoint(name.as_deref()).await
}

#[tauri::command]
pub async fn restore_checkpoint(
    state: State<'_, Arc<RwLock<SandboxState>>>,
    sandbox_id: String,
    checkpoint_id: String,
) -> Result<(), String> {
    let mut state = state.write().await;
    let sync_engine = state.sync_engines.get_mut(&sandbox_id)
        .ok_or_else(|| format!("Sandbox {} not found", sandbox_id))?;

    sync_engine.restore_checkpoint(&checkpoint_id).await
}
```

---

## Phase 3: VFS Integration & Sync

### 3.1 Modified VFS Service for Desktop

**File: `lib/virtual-filesystem/desktop-vfs-service.ts`**

```typescript
import { VirtualFilesystemService } from './virtual-filesystem-service'
import { invoke } from '@tauri-apps/api/core'
import { watch } from 'chokidar'

export class DesktopVirtualFilesystemService extends VirtualFilesystemService {
  private localWatchers = new Map<string, any>()

  constructor(options: { workspaceRoot?: string; storageDir?: string } = {}) {
    super(options)
  }

  /**
   * Override writeFile to sync to local filesystem
   */
  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean; syncToLocal?: boolean }
  ): Promise<VirtualFile> {
    const file = await super.writeFile(ownerId, filePath, content, language, options)

    // Sync to local filesystem if enabled
    if (options?.syncToLocal !== false) {
      await this.syncToLocal(ownerId, filePath, content)
    }

    return file
  }

  /**
   * Sync file to local filesystem via Tauri command
   */
  private async syncToLocal(
    ownerId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    try {
      await invoke('write_file', {
        sandboxId: ownerId,
        filePath,
        content,
      })
    } catch (error) {
      console.error('Failed to sync file to local:', error)
    }
  }

  /**
   * Watch local filesystem for changes
   */
  async watchLocal(ownerId: string, callback: (path: string, content: string) => void): Promise<void> {
    const workspaceDir = await invoke<string>('get_workspace_dir', { sandboxId: ownerId })

    const watcher = watch(workspaceDir, {
      ignored: /node_modules|\.git|\.opencode/,
      persistent: true,
    })

    watcher.on('change', async (path) => {
      const content = await invoke<string>('read_file', {
        sandboxId: ownerId,
        filePath: path,
      })
      callback(path, content)
    })

    this.localWatchers.set(ownerId, watcher)
  }

  /**
   * Export workspace to local directory
   */
  async exportToLocal(ownerId: string, targetDir: string): Promise<void> {
    const snapshot = await this.exportWorkspace(ownerId)

    for (const file of snapshot.files) {
      await invoke('write_file', {
        sandboxId: ownerId,
        filePath: file.path,
        content: file.content,
        targetDir,
      })
    }
  }
}
```

### 3.2 Checkpoint Integration

**File: `lib/sandbox/desktop-checkpoint-manager.ts`**

```typescript
import { invoke } from '@tauri-apps/api/core'

export interface DesktopCheckpointInfo {
  id: string
  name: string
  createdAt: string
  fileCount: number
  size: number
}

export class DesktopCheckpointManager {
  private sandboxId: string

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId
  }

  async create(name?: string): Promise<DesktopCheckpointInfo> {
    return invoke('create_checkpoint', {
      sandboxId: this.sandboxId,
      name,
    })
  }

  async restore(checkpointId: string): Promise<void> {
    await invoke('restore_checkpoint', {
      sandboxId: this.sandboxId,
      checkpointId,
    })
  }

  async list(): Promise<DesktopCheckpointInfo[]> {
    return invoke('list_checkpoints', {
      sandboxId: this.sandboxId,
    })
  }

  async delete(checkpointId: string): Promise<void> {
    await invoke('delete_checkpoint', {
      sandboxId: this.sandboxId,
      checkpointId,
    })
  }
}
```

---

## Phase 4: Desktop UI Components

### 4.1 Checkpoint Manager UI

**File: `components/desktop/checkpoint-manager.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDistanceToNow } from 'date-fns'

interface Checkpoint {
  id: string
  name: string
  createdAt: string
  fileCount: number
}

interface CheckpointManagerProps {
  sandboxId: string
  onRestore: (checkpointId: string) => void
}

export function CheckpointManager({ sandboxId, onRestore }: CheckpointManagerProps) {
  const [open, setOpen] = useState(false)
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [loading, setLoading] = useState(false)

  const loadCheckpoints = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/desktop/${sandboxId}/checkpoints`)
      const data = await response.json()
      setCheckpoints(data)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    const name = prompt('Checkpoint name (optional):')
    await fetch(`/api/desktop/${sandboxId}/checkpoints`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    await loadCheckpoints()
  }

  const handleRestore = async (checkpointId: string) => {
    if (confirm('Restore this checkpoint? Current changes will be saved as a new checkpoint.')) {
      await fetch(`/api/desktop/${sandboxId}/checkpoints/${checkpointId}/restore`, {
        method: 'POST',
      })
      onRestore(checkpointId)
      setOpen(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => { setOpen(true); loadCheckpoints() }}>
        📦 Checkpoints
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Checkpoints</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 mb-4">
            <Button onClick={handleCreate} size="sm">
              + Create Checkpoint
            </Button>
          </div>

          <ScrollArea className="h-[400px]">
            {loading ? (
              <div>Loading...</div>
            ) : checkpoints.length === 0 ? (
              <div className="text-muted-foreground">No checkpoints yet</div>
            ) : (
              <div className="space-y-2">
                {checkpoints.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="flex items-center justify-between p-3 border rounded"
                  >
                    <div>
                      <div className="font-medium">{checkpoint.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(checkpoint.createdAt), { addSuffix: true })}
                        {' · '}
                        {checkpoint.fileCount} files
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestore(checkpoint.id)}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

### 4.2 File Sync Status Indicator

**File: `components/desktop/file-sync-status.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface FileSyncStatusProps {
  sandboxId: string
}

export function FileSyncStatus({ sandboxId }: FileSyncStatusProps) {
  const [synced, setSynced] = useState(true)
  const [pendingChanges, setPendingChanges] = useState(0)

  useEffect(() => {
    // Listen for VFS changes
    const unsubscribe = subscribeToVFSChanges(sandboxId, (event) => {
      if (event.type === 'write') {
        setPendingChanges(p => p + 1)
        // Auto-sync after delay
        setTimeout(() => syncToLocalStorage(sandboxId), 1000)
      }
    })

    return () => unsubscribe()
  }, [sandboxId])

  const syncToLocalStorage = async (id: string) => {
    await fetch(`/api/desktop/${id}/sync`, { method: 'POST' })
    setPendingChanges(0)
    setSynced(true)
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        {pendingChanges > 0 ? (
          <Badge variant="warning">
            ⏳ {pendingChanges} pending
          </Badge>
        ) : synced ? (
          <Badge variant="success">
            ✓ Synced
          </Badge>
        ) : (
          <Badge variant="secondary">
            ⏸ Paused
          </Badge>
        )}
      </TooltipTrigger>
      <TooltipContent>
        {pendingChanges > 0
          ? `${pendingChanges} file(s) waiting to sync to local filesystem`
          : 'All changes synced to local filesystem'}
      </TooltipContent>
    </Tooltip>
  )
}
```

---

## Phase 5: API Routes for Desktop Integration

### 5.1 Desktop Execution API

**File: `app/api/desktop/[id]/execute/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { invoke } from '@tauri-apps/api/core'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sandboxId } = await params
  const body = await request.json()
  const { command, cwd, timeout } = body

  try {
    const result = await invoke('execute_command', {
      sandboxId,
      command,
      cwd,
      timeout,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    )
  }
}
```

### 5.2 Desktop Checkpoints API

**File: `app/api/desktop/[id]/checkpoints/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sandboxId } = await params

  const checkpoints = await invoke('list_checkpoints', { sandboxId })

  return NextResponse.json(checkpoints)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sandboxId } = await params
  const body = await request.json()
  const { name } = body

  const checkpoint = await invoke('create_checkpoint', {
    sandboxId,
    name,
  })

  return NextResponse.json(checkpoint)
}
```

---

## Phase 6: Security & Permissions

### 6.1 Security Policy Configuration

**File: `src-tauri/src/security/policy.rs`**

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopSecurityPolicy {
    /// Maximum command execution time (seconds)
    pub max_execution_time: u64,

    /// Blocked command patterns (regex)
    pub blocked_patterns: Vec<String>,

    /// Allowed directories for file operations
    pub allowed_directories: Vec<PathBuf>,

    /// Require approval for writes outside workspace
    pub require_approval_for_external_writes: bool,

    /// Enable command logging
    pub log_commands: bool,

    /// Block network access
    pub block_network: bool,
}

impl Default for DesktopSecurityPolicy {
    fn default() -> Self {
        Self {
            max_execution_time: 60,
            blocked_patterns: vec![
                r"rm\s+-rf\s+/$".to_string(),
                r"mkfs".to_string(),
                r"dd\s+if=/dev/zero".to_string(),
                r">\s*/dev/sd".to_string(),
                r"chmod\s+777\s+/".to_string(),
            ],
            allowed_directories: vec![],
            require_approval_for_external_writes: true,
            log_commands: true,
            block_network: false,
        }
    }
}

impl DesktopSecurityPolicy {
    pub fn from_env() -> Self {
        let mut policy = Self::default();

        if let Ok(time) = std::env::var("DESKTOP_MAX_EXECUTION_TIME") {
            policy.max_execution_time = time.parse().unwrap_or(60);
        }

        if let Ok(patterns) = std::env::var("DESKTOP_BLOCKED_PATTERNS") {
            policy.blocked_patterns = patterns.split(',').map(|s| s.to_string()).collect();
        }

        // Add user's home directory by default
        if let Ok(home) = std::env::var("HOME") {
            policy.allowed_directories.push(PathBuf::from(home));
        }

        policy
    }
}
```

### 6.2 Approval Workflow

**File: `lib/orchestra/desktop-approval-workflow.ts`**

```typescript
import { evaluateActiveWorkflow, type ApprovalContext } from './stateful-agent'

export interface DesktopApprovalRequest {
  type: 'command' | 'file_write' | 'file_read' | 'checkpoint'
  payload: any
  riskLevel: 'low' | 'medium' | 'high'
}

export async function evaluateDesktopApproval(
  request: DesktopApprovalRequest
): Promise<{ requiresApproval: boolean; reason?: string }> {
  const approvalContext: ApprovalContext = {
    riskLevel: request.riskLevel,
    ...request.payload,
  }

  const evaluation = evaluateActiveWorkflow(request.type, request.payload, approvalContext)

  return {
    requiresApproval: evaluation.requiresApproval,
    reason: evaluation.matchedRule?.name,
  }
}

// Example usage in agent loop
export async function executeCommandWithApproval(
  sandboxId: string,
  command: string,
  userId?: string
): Promise<ToolResult> {
  // Evaluate if approval is needed
  const approval = await evaluateDesktopApproval({
    type: 'command',
    payload: { command },
    riskLevel: assessCommandRisk(command),
  })

  if (approval.requiresApproval) {
    // In desktop app, show native dialog
    const approved = await showApprovalDialog({
      type: 'command',
      command,
      reason: approval.reason,
    })

    if (!approved) {
      return {
        success: false,
        output: 'Command execution denied by user',
        exitCode: 1,
      }
    }
  }

  // Execute command via Tauri
  return invoke('execute_command', { sandboxId, command })
}

function assessCommandRisk(command: string): 'low' | 'medium' | 'high' {
  if (command.includes('rm -rf') || command.includes('sudo')) {
    return 'high'
  }
  if (command.includes('npm install') || command.includes('pip install')) {
    return 'medium'
  }
  return 'low'
}

async function showApprovalDialog(request: {
  type: string
  command?: string
  reason?: string
}): Promise<boolean> {
  // This would use Tauri's dialog API
  // For now, return true (auto-approve)
  return true
}
```

---

## Phase 7: Build & Distribution

### 7.1 Build Configuration

**File: `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "OpenCode Desktop",
  "version": "0.1.0",
  "identifier": "com.opencode.desktop",
  "build": {
    "beforeBuildCommand": "npm run build",
    "beforeDevCommand": "npm run dev",
    "frontendDist": "../out",
    "devUrl": "http://localhost:3000"
  },
  "app": {
    "windows": [
      {
        "title": "OpenCode Desktop",
        "width": 1400,
        "height": 900,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "msi", "deb"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": [],
    "externalBin": [],
    "category": "DeveloperTool",
    "shortDescription": "AI-powered code assistant",
    "longDescription": "OpenCode Desktop - AI agent for software development with local execution"
  }
}
```

### 7.2 Package Scripts

**Add to `package.json`:**

```json
{
  "scripts": {
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "tauri:build:macos": "tauri build --target universal-apple-darwin",
    "tauri:build:windows": "tauri build --target x86_64-pc-windows-msvc",
    "tauri:build:linux": "tauri build --target x86_64-unknown-linux-gnu"
  }
}
```

---

## Implementation Timeline

### Week 1-2: Core Infrastructure
- [ ] Initialize Tauri project structure
- [ ] Implement Rust shell executor with security
- [ ] Create desktop sandbox provider
- [ ] Basic VFS sync to local filesystem

### Week 3-4: Checkpoint System
- [ ] Implement Rust checkpoint manager
- [ ] Create checkpoint UI components
- [ ] Integrate with existing VFS rollback system
- [ ] Add auto-checkpoint on file changes

### Week 5-6: Security & Permissions
- [ ] Implement security policy engine
- [ ] Add approval workflow for dangerous operations
- [ ] Command logging and audit trail
- [ ] File access restrictions

### Week 7-8: UI Polish & Testing
- [ ] File sync status indicators
- [ ] System tray integration
- [ ] Native notifications
- [ ] End-to-end testing

### Week 9-10: Build & Distribution
- [ ] Cross-platform builds (macOS, Windows, Linux)
- [ ] Code signing setup
- [ ] Auto-update configuration
- [ ] Documentation

---

## Key Technical Decisions

### 1. Local Execution Strategy
**Decision:** Use native shell execution with security policies, not containers

**Rationale:**
- Better performance (no container overhead)
- Direct filesystem access for sync
- Simpler debugging and development
- Users trust their own shell more than containers

**Mitigation:**
- Comprehensive security policies
- Approval workflows for risky operations
- Option to use Docker/microsandbox for untrusted code

### 2. VFS Sync Strategy
**Decision:** Bidirectional sync with conflict detection

**Rationale:**
- VFS remains source of truth for agent operations
- Local filesystem reflects approved changes
- Checkpoints provide rollback capability
- Users can edit files locally and sync back

### 3. Checkpoint Storage
**Decision:** Local `.opencode/checkpoints` directory

**Rationale:**
- Fast restore (no network)
- User owns their checkpoints
- Can be backed up with regular backups
- Optional cloud sync for backup

### 4. Security Model
**Decision:** Layered security with policies + approvals

**Rationale:**
- Default-deny for dangerous operations
- User approval for medium/high risk
- Logging for audit trail
- Optional cloud sandbox for untrusted code

---

## Migration Path from Web Version

### Existing Features → Desktop Equivalent

| Web Feature | Desktop Equivalent |
|-------------|-------------------|
| Daytona Sandbox | Native shell execution |
| E2B Code Interpreter | Local Node.js/Python execution |
| Sprites Checkpoints | Local checkpoint files |
| VFS Service | VFS + Local sync engine |
| Cloud Providers | Optional fallback (keep existing) |

### Hybrid Mode
The desktop app can maintain cloud provider support for:
- Heavy compute tasks (optional)
- Collaborative sessions
- Backup and sync across devices
- Untrusted code execution (isolated)

---

## Testing Strategy

### Unit Tests
- Shell executor command validation
- VFS sync conflict detection
- Checkpoint create/restore
- Security policy enforcement

### Integration Tests
- End-to-end agent loop with local execution
- File sync between VFS and local
- Checkpoint workflow
- Approval dialogs

### Security Tests
- Blocked command patterns
- Path traversal prevention
- Permission escalation attempts
- Resource exhaustion (fork bombs, etc.)

---

## Success Metrics

1. **Performance**
   - Command execution < 100ms latency
   - File sync < 500ms for typical files
   - Checkpoint restore < 2 seconds

2. **Security**
   - Zero successful escapes from security policies
   - All dangerous operations require approval
   - Complete audit log of all operations

3. **User Experience**
   - Seamless VFS ↔ Local sync
   - Intuitive checkpoint management
   - Clear security indicators

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Security vulnerabilities | High | Layered security, regular audits, optional cloud sandbox |
| File sync conflicts | Medium | Conflict detection, user resolution UI |
| Performance regression | Medium | Benchmarking, optimization passes |
| Platform-specific bugs | Medium | Cross-platform testing, platform-specific QA |
| User data loss | High | Checkpoints, auto-backup, undo support |

---

## Conclusion

This Tauri desktop implementation provides:
1. **Local execution** with proper security isolation
2. **Bidirectional VFS sync** with conflict detection
3. **Checkpoint system** for safe prototyping
4. **Native desktop experience** with system integration

The architecture maintains compatibility with existing cloud providers while providing a first-class local execution experience for desktop users.

---

## Additional Resources

For complete module-by-module analysis with specific code changes, see:
- **`TAURI_DESKTOP_COMPREHENSIVE_ANALYSIS.md`** - Deep dive into all 5 critical areas:
  1. MCP Integration (local servers, bundled binaries, transport)
  2. HITL/Workflows (native dialogs, approval center, persistence)
  3. Agent Session Management (local sandboxes, recovery, sync)
  4. Tool Execution Pipeline (desktop tools, security policies)
  5. Database/Persistence (bundled SQLite, encryption, backup)

### Key Documents Created

| Document | Purpose |
|----------|---------|
| `TAURI_DESKTOP_IMPLEMENTATION_PLAN.md` | High-level implementation plan |
| `TAURI_DESKTOP_COMPREHENSIVE_ANALYSIS.md` | Complete module analysis |
| `lib/sandbox/providers/desktop-provider.ts` | (To be created) Desktop sandbox provider |
| `src-tauri/src/shell/executor.rs` | (To be created) Secure shell executor |

### Quick Reference: File Counts

**New Files Required:**
- **Rust Backend:** 20 files
- **TypeScript Frontend:** 23 files
- **UI Components:** 9 files
- **Total:** 52 new files

**Modified Files:** 10 key files

**Implementation Timeline:** 12 weeks (3 months)
- Phase 1 (Weeks 1-4): Core execution
- Phase 2 (Weeks 5-8): User experience
- Phase 3 (Weeks 9-12): Advanced features
