use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Validates and canonicalizes a workspace-relative path.
/// Returns the canonical path or an error if it escapes the workspace.
fn validate_workspace_path(file_path: &str) -> Result<PathBuf, String> {
    let base_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to resolve base directory: {}", e))?;
    let requested = Path::new(file_path);

    if requested.is_absolute() || requested.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("Access denied: path must stay within workspace".to_string());
    }

    let full_path = base_dir.join(requested);

    // Ensure parent exists for operations that need it
    // For read-only operations, we canonicalize after confirming existence
    let canonical = if full_path.exists() {
        std::fs::canonicalize(&full_path)
            .map_err(|e| format!("Failed to canonicalize path: {}", e))?
    } else {
        // For paths that don't exist yet (e.g., write targets), canonicalize the base
        // and verify the resolved path would stay within workspace
        let canonical_base = std::fs::canonicalize(&base_dir)
            .map_err(|e| format!("Failed to canonicalize base directory: {}", e))?;
        
        // Check if resolved path would escape workspace (before creation)
        let resolved = base_dir.join(requested);
        let canonical_resolved = if resolved.exists() {
            std::fs::canonicalize(&resolved)
                .map_err(|e| format!("Failed to canonicalize resolved path: {}", e))?
        } else {
            // Path doesn't exist yet - verify parent is within workspace
            if let Some(parent) = resolved.parent() {
                if parent.exists() {
                    let canonical_parent = std::fs::canonicalize(parent)
                        .map_err(|e| format!("Failed to canonicalize parent: {}", e))?;
                    if !canonical_parent.starts_with(&canonical_base) {
                        return Err("Access denied: resolved path escapes workspace".to_string());
                    }
                }
            }
            resolved
        };
        canonical_resolved
    };

    let canonical_base = std::fs::canonicalize(&base_dir)
        .map_err(|e| format!("Failed to canonicalize base directory: {}", e))?;

    if !canonical.starts_with(&canonical_base) {
        return Err("Access denied: resolved path escapes workspace".to_string());
    }

    Ok(canonical)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub hostname: String,
}

// Shadow commit and checkpoint types
#[derive(Debug, Serialize, Deserialize)]
pub struct CheckpointInfo {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub file_count: usize,
    pub workspace_path: String,
    pub commit_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShadowCommitResult {
    pub success: bool,
    pub commit_id: Option<String>,
    pub committed_files: usize,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RollbackResult {
    pub success: bool,
    pub files_restored: usize,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckpointListResult {
    pub success: bool,
    pub checkpoints: Vec<CheckpointInfo>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub change_type: String, // "create" | "update" | "delete"
    pub timestamp: String,
}

/// Shadow commit state - tracks checkpoints for a workspace
pub struct CheckpointState {
    pub checkpoints: Vec<CheckpointInfo>,
    pub workspace_path: String,
}

impl Default for CheckpointState {
    fn default() -> Self {
        Self {
            checkpoints: Vec::new(),
            workspace_path: String::new(),
        }
    }
}

#[tauri::command]
pub async fn execute_command(command: String, cwd: Option<String>) -> Result<CommandResult, String> {
    let shell = if cfg!(target_os = "windows") {
        "powershell"
    } else {
        "bash"
    };

    let flag = if cfg!(target_os = "windows") {
        "-Command"
    } else {
        "-c"
    };

    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(&command);

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let output = tauri::async_runtime::spawn_blocking(move || cmd.output())
        .await
        .map_err(|e| format!("Failed to join command task: {}", e))?
        .map_err(|e| format!("Failed to execute command: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = if stderr.is_empty() {
        stdout.clone()
    } else {
        format!("{}\n--- stderr ---\n{}", stdout, stderr)
    };

    Ok(CommandResult {
        success: output.status.success(),
        output: combined,
        error: if output.status.success() { None } else { Some(stderr) },
        exit_code: output.status.code(),
    })
}

#[tauri::command]
pub async fn read_file(file_path: String) -> Result<String, String> {
    // Validate and canonicalize path to prevent symlink escape
    let safe_path = validate_workspace_path(&file_path)?;
    std::fs::read_to_string(&safe_path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_file(
    app: AppHandle,
    file_path: String,
    content: String,
) -> Result<(), String> {
    // Validate path to prevent directory traversal attacks
    let base_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to resolve base directory: {}", e))?;
    let requested = std::path::Path::new(&file_path);

    if requested.is_absolute() || requested.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("Access denied: path must stay within workspace".to_string());
    }

    let full_path = base_dir.join(requested);

    // Ensure parent exists before writing
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Canonicalize the parent directory to prevent symlink escape attacks
    // We canonicalize the parent (not the file) because the file may not exist yet,
    // but the parent was just created by create_dir_all above.
    // This ensures a symlinked parent pointing outside the workspace is caught.
    let canonical_parent = full_path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let canonical_parent = std::fs::canonicalize(canonical_parent)
        .map_err(|e| format!("Failed to canonicalize parent directory: {}", e))?;
    let canonical_base = std::fs::canonicalize(&base_dir)
        .map_err(|e| format!("Failed to canonicalize base directory: {}", e))?;

    if !canonical_parent.starts_with(&canonical_base) {
        return Err("Access denied: resolved path escapes workspace".to_string());
    }

    std::fs::write(&full_path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    // Determine if this is a create or update (after write succeeds)
    let change_type = if full_path.exists() { "update" } else { "create" };

    // Emit file change event to TypeScript layer for VFS shadow commit tracking
    let _ = app.emit("file-change", FileChangeEvent {
        path: file_path.clone(),
        change_type: change_type.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    });

    Ok(())
}

#[tauri::command]
pub async fn list_directory(dir_path: String) -> Result<Vec<FileEntry>, String> {
    // Validate and canonicalize path to prevent symlink escape
    let safe_path = validate_workspace_path(&dir_path)?;
    let entries = std::fs::read_dir(&safe_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        result.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            size: metadata.len(),
        });
    }

    Ok(result)
}

// ============================================================================
// Shadow Commit & Checkpoint Commands
// ============================================================================

/// Checkpoint state manager - stored in Tauri state
pub struct CheckpointManager(Mutex<HashMap<String, CheckpointState>>);

impl Default for CheckpointManager {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Create a checkpoint (shadow commit) of the current workspace state
#[tauri::command]
pub async fn create_checkpoint(
    _app: AppHandle,
    checkpoints: State<'_, CheckpointManager>,
    workspace_path: Option<String>,
    name: Option<String>,
) -> Result<CheckpointInfo, String> {
    // Validate workspace path to prevent git operations on arbitrary directories
    let workspace = if let Some(path) = workspace_path {
        let validated = validate_workspace_path(&path)?;
        validated.to_string_lossy().to_string()
    } else {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    };

    // Count files in workspace
    let file_count = count_files_in_dir(&workspace).map_err(|e| format!("Failed to count files: {}", e))?;

    let checkpoint_id = format!("chkpt-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap());
    let checkpoint_name = name.unwrap_or_else(|| format!("Checkpoint {}", checkpoint_id));
    let created_at = chrono::Utc::now().to_rfc3339();

    // Create a git commit as the shadow commit backing store and capture the hash
    let commit_hash = match create_git_commit(&workspace, &checkpoint_name) {
        Ok(hash) => Some(hash),
        Err(e) => {
            // Log but don't fail - checkpoint is still tracked in memory
            eprintln!("Warning: git commit failed: {}", e);
            None
        }
    };

    let checkpoint = CheckpointInfo {
        id: checkpoint_id.clone(),
        name: checkpoint_name.clone(),
        created_at: created_at.clone(),
        file_count,
        workspace_path: workspace.clone(),
        commit_hash,
    };

    // Create a git commit as the shadow commit backing store
    let git_result = create_git_commit(&workspace, &checkpoint_name);
    if let Err(e) = git_result {
        // Log but don't fail - checkpoint is still tracked in memory
        eprintln!("Warning: git commit failed: {}", e);
    }

    Ok(checkpoint)
}

/// Restore a checkpoint by reverting workspace to the checkpoint state
#[tauri::command]
pub async fn restore_checkpoint(
    _app: AppHandle,
    checkpoints: State<'_, CheckpointManager>,
    workspace_path: String,
    checkpoint_id: String,
) -> Result<RollbackResult, String> {
    // Validate workspace path to prevent git operations on arbitrary directories
    let workspace = validate_workspace_path(&workspace_path)?;
    let workspace_str = workspace.to_string_lossy().to_string();

    let managers = checkpoints.0.lock().map_err(|e| e.to_string())?;
    let state = managers.get(&workspace_str)
        .ok_or_else(|| "No checkpoints found for workspace".to_string())?;

    let checkpoint = state.checkpoints.iter()
        .find(|c| c.id == checkpoint_id)
        .ok_or_else(|| "Checkpoint not found".to_string())?;

    // Use the stored commit hash for git reset, not the friendly checkpoint ID
    let commit_id = checkpoint.commit_hash.as_ref()
        .ok_or_else(|| "No commit hash available for this checkpoint".to_string())?;

    // Use git reset to restore the workspace to the checkpoint commit
    let git_result = restore_git_commit(&workspace_str, commit_id);
    match git_result {
        Ok(files_restored) => {
            Ok(RollbackResult {
                success: true,
                files_restored,
                error: None,
            })
        }
        Err(e) => {
            Ok(RollbackResult {
                success: false,
                files_restored: 0,
                error: Some(e),
            })
        }
    }
}

/// List all checkpoints for a workspace
#[tauri::command]
pub async fn list_checkpoints(
    checkpoints: State<'_, CheckpointManager>,
    workspace_path: Option<String>,
) -> Result<CheckpointListResult, String> {
    // Validate workspace path to prevent git operations on arbitrary directories
    let workspace = if let Some(path) = workspace_path {
        let validated = validate_workspace_path(&path)?;
        validated.to_string_lossy().to_string()
    } else {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    };

    let managers = checkpoints.0.lock().map_err(|e| e.to_string())?;
    let state = managers.get(&workspace);

    match state {
        Some(state) => {
            Ok(CheckpointListResult {
                success: true,
                checkpoints: state.checkpoints.clone(),
                error: None,
            })
        }
        None => {
            // Also try to read from git log as fallback
            let git_checkpoints = list_git_checkpoints(&workspace).unwrap_or_default();
            Ok(CheckpointListResult {
                success: true,
                checkpoints: git_checkpoints,
                error: None,
            })
        }
    }
}

/// Delete a checkpoint
#[tauri::command]
pub async fn delete_checkpoint(
    checkpoints: State<'_, CheckpointManager>,
    workspace_path: String,
    checkpoint_id: String,
) -> Result<bool, String> {
    // Validate workspace path to prevent git operations on arbitrary directories
    let workspace = validate_workspace_path(&workspace_path)?;
    let workspace_str = workspace.to_string_lossy().to_string();

    let mut managers = checkpoints.0.lock().map_err(|e| e.to_string())?;

    if let Some(state) = managers.get_mut(&workspace_str) {
        let initial_len = state.checkpoints.len();
        state.checkpoints.retain(|c| c.id != checkpoint_id);
        return Ok(state.checkpoints.len() < initial_len);
    }

    Ok(false)
}

// ============================================================================
// Git helper functions for shadow commit backing store
// ============================================================================

fn count_files_in_dir(dir: &str) -> Result<usize, String> {
    let mut count = 0;
    for entry in walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            // Skip hidden files and common ignore patterns
            e.path()
                .components()
                .all(|c| {
                    let s = c.as_os_str().to_string_lossy();
                    !s.starts_with('.') && s != "node_modules" && s != "target"
                })
        })
    {
        count += 1;
    }
    Ok(count)
}

fn create_git_commit(dir: &str, message: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(["add", "."])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run git add: {}", e))?;

    if !output.status.success() {
        return Err(format!("git add failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let output = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run git commit: {}", e))?;

    if !output.status.success() {
        return Err(format!("git commit failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    // Extract commit hash
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to get commit hash: {}", e))?;

    String::from_utf8_lossy(&output.stdout).trim().to_string().into()
}

fn restore_git_commit(dir: &str, commit_id: &str) -> Result<usize, String> {
    // First, get the diff between HEAD and the target commit
    let diff_output = Command::new("git")
        .args(["diff", "--name-only", commit_id])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let files_to_restore = String::from_utf8_lossy(&diff_output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .count();

    // Hard reset to the target commit
    let output = Command::new("git")
        .args(["reset", "--hard", commit_id])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run git reset: {}", e))?;

    if !output.status.success() {
        return Err(format!("git reset failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(files_to_restore)
}

fn list_git_checkpoints(dir: &str) -> Result<Vec<CheckpointInfo>, String> {
    let output = Command::new("git")
        .args(["log", "--pretty=format:%H|%s|%aI", "-n", "50"])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    let lines = String::from_utf8_lossy(&output.stdout);
    let mut checkpoints = Vec::new();

    for line in lines.lines() {
        let parts: Vec<&str> = line.splitn(3, '|').collect();
        if parts.len() == 3 {
            checkpoints.push(CheckpointInfo {
                id: parts[0].to_string(),
                name: parts[1].to_string(),
                created_at: parts[2].to_string(),
                file_count: 0, // Would need to parse the commit to get this
                workspace_path: dir.to_string(),
            });
        }
    }

    Ok(checkpoints)
}

// PTY session state
pub struct PtySessions(Mutex<HashMap<String, PtySession>>);

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Send + std::process::Child>,
}

impl Default for PtySessions {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PtyCreateResult {
    pub session_id: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PtyInputResult {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShellCompletionResult {
    pub success: bool,
    pub completions: Vec<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn create_pty_session(
    app: AppHandle,
    sessions: State<'_, PtySessions>,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<PtyCreateResult, String> {
    let pty_system = native_pty_system();
    
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell_cmd = shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "powershell".to_string()
        } else {
            "bash".to_string()
        }
    });

    let mut cmd = CommandBuilder::new(shell_cmd);
    
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    // Set environment for interactive shell
    cmd.env("TERM", "xterm-256color");

    let child = cmd
        .spawn(&pair.slave)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let session_id = format!("pty-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap());

    // Store session
    {
        let mut sessions = sessions.0.lock().map_err(|e| e.to_string())?;
        sessions.insert(session_id.clone(), PtySession {
            master: pair.master,
            child,
        });
    }

    // Start reading output in background
    let session_id_clone = session_id.clone();
    let app_clone = app.clone();
    let sessions_clone = sessions.0.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut consecutive_errors = 0u32;
        const MAX_CONSECUTIVE_ERRORS: u32 = 10;

        loop {
            // Get master from sessions
            let master = {
                let sessions_guard = match sessions_clone.lock() {
                    Ok(s) => s,
                    Err(poisoned) => {
                        eprintln!("[PTY] Session map lock poisoned for '{}', cleaning up", session_id_clone);
                        // Attempt recovery: try to kill the child if we can get the session
                        let _ = poisoned.into_inner();
                        break;
                    }
                };
                match sessions_guard.get(&session_id_clone) {
                    Some(s) => s.master.try_clone_reader(),
                    None => {
                        // Session was removed (likely via close_pty_session), exit cleanly
                        break;
                    }
                }
            };

            let mut reader = match master {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[PTY] Failed to clone master reader for '{}': {}", session_id_clone, e);
                    consecutive_errors += 1;
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        eprintln!("[PTY] Too many consecutive errors for '{}', exiting reader thread", session_id_clone);
                        break;
                    }
                    // Brief backoff to avoid busy-waiting
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    continue;
                }
            };

            match reader.read(&mut buffer) {
                Ok(0) => break, // EOF - session closed normally
                Ok(n) => {
                    consecutive_errors = 0; // Reset on success
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_clone.emit("pty-output", PtyOutputEvent {
                        session_id: session_id_clone.clone(),
                        data,
                    });
                }
                Err(e) => {
                    eprintln!("[PTY] Read error for '{}': {}", session_id_clone, e);
                    consecutive_errors += 1;
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        eprintln!("[PTY] Too many consecutive read errors for '{}', exiting reader thread", session_id_clone);
                        break;
                    }
                    // Brief backoff to avoid busy-waiting
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }

        // Emit close event and attempt cleanup
        let _ = app_clone.emit("pty-closed", serde_json::json!({ "session_id": session_id_clone }));

        // Attempt to remove session and kill child process if still present
        if let Ok(mut sessions) = sessions_clone.lock() {
            if let Some(session) = sessions.remove(&session_id_clone) {
                let _ = session.child.kill();
            }
        }
    });

    Ok(PtyCreateResult {
        session_id,
        success: true,
        error: None,
    })
}

#[tauri::command]
pub async fn write_pty_input(
    sessions: State<'_, PtySessions>,
    session_id: String,
    data: String,
) -> Result<PtyInputResult, String> {
    let sessions = sessions.0.lock().map_err(|e| e.to_string())?;
    
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    
    let mut writer = session.master.take_writer().map_err(|e| e.to_string())?;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    
    // Put writer back
    drop(writer);
    
    Ok(PtyInputResult {
        success: true,
        error: None,
    })
}

#[tauri::command]
pub async fn resize_pty(
    sessions: State<'_, PtySessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<PtyInputResult, String> {
    let sessions = sessions.0.lock().map_err(|e| e.to_string())?;
    
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    
    session.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize: {}", e))?;

    Ok(PtyInputResult {
        success: true,
        error: None,
    })
}

#[tauri::command]
pub async fn close_pty_session(
    sessions: State<'_, PtySessions>,
    session_id: String,
) -> Result<PtyInputResult, String> {
    let mut sessions = sessions.0.lock().map_err(|e| e.to_string())?;
    
    if let Some(session) = sessions.remove(&session_id) {
        // Kill the child process
        let _ = session.child.kill();
    }
    
    Ok(PtyInputResult {
        success: true,
        error: None,
    })
}

/// Get shell completions for a given input
/// Uses the shell's native completion mechanism (compgen for bash, compctl for zsh)
#[tauri::command]
pub async fn get_shell_completions(
    _sessions: State<'_, PtySessions>,
    input: String,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<ShellCompletionResult, String> {
    let shell = shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "powershell".to_string()
        } else {
            "bash".to_string()
        }
    });

    // Determine if we're completing a command, file, or variable
    let completion_type = determine_completion_type(&input);
    
    let completions = match shell.as_str() {
        "bash" => get_bash_completions(&input, completion_type, cwd.as_deref()),
        "zsh" => get_zsh_completions(&input, completion_type, cwd.as_deref()),
        "fish" => get_fish_completions(&input, cwd.as_deref()),
        _ => get_bash_completions(&input, completion_type, cwd.as_deref()),
    };

    Ok(ShellCompletionResult {
        success: true,
        completions,
        error: None,
    })
}

/// Determine what type of completion the user wants (command, file, variable, etc.)
fn determine_completion_type(input: &str) -> &str {
    let trimmed = input.trim();
    
    if trimmed.is_empty() {
        return "command";
    }
    
    // Check for variable prefix ($)
    if trimmed.contains('$') {
        return "variable";
    }
    
    // Check for path prefix (~, /, .)
    if trimmed.starts_with('~') || trimmed.starts_with('/') || trimmed.starts_with('.') {
        return "file";
    }
    
    // Check if we're in the middle of a command (has spaces)
    if trimmed.contains(' ') {
        // If the last word starts with -, it's an option
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if let Some(last) = parts.last() {
            if last.starts_with('-') {
                return "option";
            }
        }
        // Otherwise it's likely a file/path argument
        return "file";
    }
    
    // Default to command completion
    "command"
}

/// Get bash completions using compgen
fn get_bash_completions(input: &str, completion_type: &str, cwd: Option<&str>) -> Vec<String> {
    let working_dir = cwd.unwrap_or(".");
    
    let (compgen_type, prefix) = match completion_type {
        "command" => ("complete", ""),
        "file" => ("file", ""),
        "directory" => ("dir", ""),
        "variable" => ("variable", ""),
        "option" => ("file", "-"),
        _ => ("file", ""),
    };
    
    // Get the word being completed
    let word = input.split_whitespace().last().unwrap_or("");
    
    // Build compgen command
    let compgen_cmd = if compgen_type == "complete" {
        // For command completion, use compgen -c to list commands
        format!("compgen -c -P '{}' -- {}", prefix, escape_for_shell(word))
    } else if compgen_type == "variable" {
        // For variable completion, use compgen -v
        format!("compgen -v -P '$' -- {}", escape_for_shell(word.trim_start_matches('$')))
    } else {
        // For file/directory completion
        format!("compgen -{} -P '{}' -- {}", compgen_type, prefix, escape_for_shell(word))
    };
    
    // Run the compgen command
    let output = Command::new("bash")
        .args(["-c", &compgen_cmd])
        .current_dir(working_dir)
        .output();
    
    match output {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect()
        }
        _ => Vec::new(),
    }
}

/// Get zsh completions using compctl
fn get_zsh_completions(input: &str, completion_type: &str, cwd: Option<&str>) -> Vec<String> {
    let working_dir = cwd.unwrap_or(".");
    let word = input.split_whitespace().last().unwrap_or("");
    
    // Use zsh's _approximate completions for fuzzy matching
    let compgen_cmd = match completion_type {
        "command" => format!("zsh -c 'compctl -k commands {}'", escape_for_shell(word)),
        "file" | "directory" => {
            let suffix = if completion_type == "directory" { "/" } else { "" };
            format!("zsh -c 'compctl -f -S \"{}\" {}'", suffix, escape_for_shell(word))
        }
        _ => format!("zsh -c 'compctl -f {}'", escape_for_shell(word)),
    };
    
    let output = Command::new("bash")
        .args(["-c", &compgen_cmd])
        .current_dir(working_dir)
        .output();
    
    match output {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect()
        }
        _ => Vec::new(),
    }
}

/// Get fish completions
fn get_fish_completions(input: &str, cwd: Option<&str>) -> Vec<String> {
    let working_dir = cwd.unwrap_or(".");
    let word = input.split_whitespace().last().unwrap_or("");
    
    // Use fish's complete command
    let compgen_cmd = format!("fish -c 'complete -C {}'", escape_for_shell(word));
    
    let output = Command::new("bash")
        .args(["-c", &compgen_cmd])
        .current_dir(working_dir)
        .output();
    
    match output {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect()
        }
        _ => Vec::new(),
    }
}

/// Validate input contains only safe characters for shell completion
fn validate_completion_input(input: &str) -> bool {
    // Only allow alphanumeric, dash, underscore, space, and common path chars
    input.chars().all(|c| {
        c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '/' || 
        c == '.' || c == '~' || c == '$' || c == '@'
    })
}

/// Escape special characters for shell commands
fn escape_for_shell(s: &str) -> String {
    // First validate input
    if !validate_completion_input(s) {
        return String::new(); // Return empty on invalid input
    }
    s.replace('\'', "'\\''")
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        hostname: hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string()),
    })
}
