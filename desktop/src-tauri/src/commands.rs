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
    // Canonicalize base_dir once and reuse throughout
    let canonical_base = std::fs::canonicalize(&base_dir)
        .map_err(|e| format!("Failed to canonicalize base directory: {}", e))?;
    let requested = Path::new(file_path);

    if requested.is_absolute() || requested.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("Access denied: path must stay within workspace".to_string());
    }

    let full_path = base_dir.join(requested);

    let canonical = if full_path.exists() {
        // Path exists — canonicalize it directly
        std::fs::canonicalize(&full_path)
            .map_err(|e| format!("Failed to canonicalize path: {}", e))?
    } else {
        // Path doesn't exist yet (e.g., write target).
        // Verify the parent directory is within workspace to prevent symlink escape.
        if let Some(parent) = full_path.parent() {
            if parent.exists() {
                let canonical_parent = std::fs::canonicalize(parent)
                    .map_err(|e| format!("Failed to canonicalize parent directory: {}", e))?;
                if !canonical_parent.starts_with(&canonical_base) {
                    return Err("Access denied: resolved path escapes workspace".to_string());
                }
            }
        }
        // Return canonical_base + relative path. This produces a normalized path
        // guaranteed to stay within the workspace boundary.
        canonical_base.join(requested)
    };

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
#[derive(Debug, Serialize, Deserialize, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Clone)]
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

    // Determine if this is a create or update BEFORE the write
    let is_new = !full_path.exists();

    std::fs::write(&full_path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    let change_type = if is_new { "create" } else { "update" };

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

    // Store the checkpoint in the CheckpointManager so restore/delete can find it
    {
        let mut managers = checkpoints.0.lock().map_err(|e| e.to_string())?;
        let state = managers.entry(workspace.clone()).or_insert_with(|| CheckpointState {
            workspace_path: workspace.clone(),
            checkpoints: Vec::new(),
        });
        state.checkpoints.push(checkpoint.clone());
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

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
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
                commit_hash: Some(parts[0].to_string()),
            });
        }
    }

    Ok(checkpoints)
}

// PTY session state
pub struct PtySessions(std::sync::Arc<Mutex<HashMap<String, PtySession>>>);

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

impl Default for PtySessions {
    fn default() -> Self {
        Self(std::sync::Arc::new(Mutex::new(HashMap::new())))
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

#[derive(Debug, Serialize, Deserialize, Clone)]
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

    let child = pair.slave.spawn_command(cmd)
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
                let sessions_guard: std::sync::MutexGuard<'_, HashMap<String, PtySession>> = match sessions_clone.lock() {
                    Ok(s) => s,
                    Err(poisoned) => {
                        eprintln!("[PTY] Session map lock poisoned for '{}', cleaning up", session_id_clone);
                        let _: &HashMap<String, PtySession> = poisoned.get_ref();
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

            let mut reader: Box<dyn std::io::Read + Send> = match master {
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
            if let Some(mut session) = sessions.remove(&session_id_clone) {
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
    
    if let Some(mut session) = sessions.remove(&session_id) {
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


/// Registry of stop channels for file watchers.
/// Each watcher gets a Sender<()> that, when sent to, signals the watcher thread to stop.
/// Inner is wrapped in Arc so watcher threads can clone it for self-cleanup on exit.
pub struct WatcherRegistry(pub std::sync::Arc<std::sync::Mutex<HashMap<String, std::sync::mpsc::Sender<()>>>>);

impl Default for WatcherRegistry {
    fn default() -> Self {
        Self(std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())))
    }
}

/// RAII guard that removes a watcher's stop-sender from the registry when dropped.
/// This guarantees cleanup on ALL thread exit paths — early returns, breaks, and panics.
struct WatcherCleanup {
    registry: std::sync::Arc<std::sync::Mutex<HashMap<String, std::sync::mpsc::Sender<()>>>>,
    id: String,
}

impl Drop for WatcherCleanup {
    fn drop(&mut self) {
        if let Ok(mut reg) = self.registry.lock() {
            reg.remove(&self.id);
        }
        crate::log::log_msg(&format!("[file-watcher] Cleaned up registry entry for {}", self.id));
    }
}

/// Start a file system watcher for the workspace directory.
/// Returns a watcher ID that can be used to stop watching.
#[tauri::command]
pub async fn start_file_watcher(
    app: AppHandle,
    watch_id: String,
    watch_path: String,
    registry: tauri::State<'_, WatcherRegistry>,
) -> Result<bool, String> {
    use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
    use std::sync::mpsc::channel;
    use std::time::Duration;

    // Validate the watch path
    let watch_path = if watch_path.is_empty() || watch_path == "." {
        std::env::current_dir()
            .map_err(|e| format!("Failed to get current dir: {}", e))?
    } else {
        let base_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to resolve current dir: {}", e))?;
        let requested = std::path::Path::new(&watch_path);
        
        // Reject absolute paths and traversal attempts
        if requested.is_absolute() || requested.components().any(|c| c == std::path::Component::ParentDir) {
            return Err("Access denied: watch path must stay within workspace".to_string());
        }
        
        let full_path = base_dir.join(requested);
        let canonical_base = std::fs::canonicalize(&base_dir)
            .map_err(|e| format!("Failed to canonicalize base dir: {}", e))?;
        
        if !full_path.exists() {
            return Err(format!("Watch path does not exist: {}", watch_path));
        }
        
        let canonical = std::fs::canonicalize(&full_path)
            .map_err(|e| format!("Failed to canonicalize watch path: {}", e))?;
        
        if !canonical.starts_with(&canonical_base) {
            return Err("Access denied: watch path escapes workspace".to_string());
        }
        
        canonical
    };

    let app_clone = app.clone();
    let watch_id_clone = watch_id.clone();

    // Create stop channel for graceful shutdown
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();

    // Clone the Arc<Mutex> so the watcher thread can clean up its own entry on exit
    let registry_arc = registry.0.clone();
    // Store stop sender in registry
    {
        let mut reg = registry_arc.lock().map_err(|e| e.to_string())?;
        reg.insert(watch_id.clone(), stop_tx);
        crate::log::log_msg(&format!("[file-watcher] Registered stop channel for {}", watch_id));
    }

    std::thread::spawn(move || {
        // RAII guard: when this goes out of scope (any exit path), the registry
        // entry is removed automatically — covers early returns, breaks, and panics.
        let _cleanup = WatcherCleanup {
            registry: registry_arc,
            id: watch_id_clone.clone(),
        };

        let (tx, rx) = channel::<notify::Result<notify::Event>>();

        let mut watcher: RecommendedWatcher = match notify::Watcher::new(
            tx,
            Config::default().with_poll_interval(Duration::from_secs(2)),
        ) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[file-watcher] Failed to create watcher: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&watch_path, RecursiveMode::Recursive) {
            eprintln!("[file-watcher] Failed to watch {:?}: {}", watch_path, e);
            return;
        }

        crate::log::log_msg(&format!("[file-watcher] Started watching {:?} with id {}", watch_path, watch_id_clone));

        loop {
            // Check if we should stop
            match stop_rx.recv_timeout(Duration::from_secs(0)) {
                Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    crate::log::log_msg(&format!("[file-watcher] Stopping watcher {} (user request)", watch_id_clone));
                    break;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            }

            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(event)) => {
                    for path in event.paths {
                        let change_type = match event.kind {
                            notify::EventKind::Create(_) => "create",
                            notify::EventKind::Modify(_) => "update",
                            notify::EventKind::Remove(_) => "delete",
                            _ => continue,
                        };

                        let _ = app_clone.emit("fs-watch-event", serde_json::json!({
                            "watchId": watch_id_clone,
                            "path": path.to_string_lossy(),
                            "changeType": change_type,
                            "timestamp": chrono::Utc::now().to_rfc3339(),
                        }));
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("[file-watcher] Watch error: {}", e);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Normal timeout - continue watching
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    crate::log::log_msg(&format!("[file-watcher] Watcher disconnected for id {}", watch_id_clone));
                    break;
                }
            }
        }

        crate::log::log_msg(&format!("[file-watcher] Stopped watching {:?} with id {}", watch_path, watch_id_clone));
        // _cleanup guard is dropped here, removing the registry entry
    });

    Ok(true)
}

/// Stop a file system watcher by ID
#[tauri::command]
pub async fn stop_file_watcher(
    watch_id: String,
    registry: tauri::State<'_, WatcherRegistry>,
) -> Result<bool, String> {
    // Remove the sender from the registry and send stop signal
    // This prevents stale entries from accumulating (memory leak fix)
    let sender = registry.0.lock()
        .map_err(|e| e.to_string())?
        .remove(&watch_id);

    if let Some(tx) = sender {
        let _ = tx.send(());
        crate::log::log_msg(&format!("[file-watcher] Stop signal sent and registry entry removed for {}", watch_id));
        Ok(true)
    } else {
        crate::log::log_msg(&format!("[file-watcher] No active watcher found for id {}", watch_id));
        Ok(false)
    }
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

// ---------------------------------------------------------------------------
// Generic API route dispatcher — maps API paths to existing Tauri commands
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ApiRouteRequest {
    pub route: String,
    pub method: String,
    pub body: Option<serde_json::Value>,
    pub query: Option<HashMap<String, String>>,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
pub struct ApiRouteResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub status: u16,
}

#[tauri::command]
pub async fn handle_api_route(req: ApiRouteRequest) -> Result<ApiRouteResponse, String> {
    let query = req.query.as_ref();

    match req.route.as_str() {
        "/api/filesystem/read" => {
            let path = query.and_then(|q| q.get("path")).cloned().unwrap_or_default();
            match read_file(path).await {
                Ok(content) => Ok(ApiRouteResponse {
                    success: true,
                    data: Some(serde_json::json!({ "content": content })),
                    error: None,
                    status: 200,
                }),
                Err(e) => Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(e),
                    status: 404,
                }),
            }
        }
        "/api/filesystem/list" => {
            let path = query.and_then(|q| q.get("path")).cloned().unwrap_or_default();
            match list_directory(path).await {
                Ok(entries) => Ok(ApiRouteResponse {
                    success: true,
                    data: Some(serde_json::json!({ "entries": entries })),
                    error: None,
                    status: 200,
                }),
                Err(e) => Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(e),
                    status: 404,
                }),
            }
        }
        "/api/filesystem/write" => {
            // Requires AppHandle for file-change events — use invoke('write_file') directly
            Ok(ApiRouteResponse {
                success: false,
                data: None,
                error: Some("Use invoke('write_file', ...) directly".to_string()),
                status: 501,
            })
        }
        "/api/providers" => {
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({
                    "providers": [
                        { "id": "openai", "name": "OpenAI", "isAvailable": true },
                        { "id": "anthropic", "name": "Anthropic", "isAvailable": true },
                        { "id": "google", "name": "Google", "isAvailable": true },
                        { "id": "mistral", "name": "Mistral", "isAvailable": true },
                    ]
                })),
                error: None,
                status: 200,
            })
        }
        "/api/health" => {
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({ "status": "ok", "mode": "desktop", "version": env!("CARGO_PKG_VERSION") })),
                error: None,
                status: 200,
            })
        }

        // ── Filesystem operations ──────────────────────────────────────────

        "/api/filesystem/mkdir" => {
            let path = req.body.as_ref()
                .and_then(|b| b["path"].as_str()).or_else(|| query.and_then(|q| q.get("path")).map(|s| s.as_str()))
                .unwrap_or("");
            match validate_workspace_path(path) {
                Ok(canonical) => {
                    match std::fs::create_dir_all(&canonical) {
                        Ok(()) => Ok(ApiRouteResponse {
                            success: true,
                            data: Some(serde_json::json!({ "path": path })),
                            error: None,
                            status: 200,
                        }),
                        Err(e) => Ok(ApiRouteResponse {
                            success: false,
                            data: None,
                            error: Some(e.to_string()),
                            status: 500,
                        }),
                    }
                }
                Err(e) => Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(e),
                    status: 403,
                }),
            }
        }

        "/api/filesystem/delete" => {
            let path = req.body.as_ref()
                .and_then(|b| b["path"].as_str()).or_else(|| query.and_then(|q| q.get("path")).map(|s| s.as_str()))
                .unwrap_or("");

            if path.trim().is_empty() || path == "." {
                return Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some("Refusing to delete empty or current directory path".to_string()),
                    status: 400,
                });
            }

            match validate_workspace_path(path) {
                Ok(canonical) => {
                    let result = if canonical.is_dir() {
                        std::fs::remove_dir_all(&canonical)
                    } else {
                        std::fs::remove_file(&canonical)
                    };
                    match result {
                        Ok(()) => Ok(ApiRouteResponse {
                            success: true,
                            data: Some(serde_json::json!({ "path": path })),
                            error: None,
                            status: 200,
                        }),
                        Err(e) => Ok(ApiRouteResponse {
                            success: false,
                            data: None,
                            error: Some(e.to_string()),
                            status: 500,
                        }),
                    }
                }
                Err(e) => Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(e),
                    status: 403,
                }),
            }
        }

        "/api/filesystem/rename" => {
            let body = req.body.as_ref().ok_or("Missing body")?;
            let old_path = body["oldPath"].as_str().or(body["old_path"].as_str()).ok_or("Missing oldPath")?;
            let new_path = body["newPath"].as_str().or(body["new_path"].as_str()).ok_or("Missing newPath")?;
            let old_canonical = validate_workspace_path(old_path)?;
            let new_canonical = validate_workspace_path(new_path)?;
            // Ensure parent of new path exists
            if let Some(parent) = new_canonical.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::rename(&old_canonical, &new_canonical) {
                Ok(()) => Ok(ApiRouteResponse {
                    success: true,
                    data: Some(serde_json::json!({ "oldPath": old_path, "newPath": new_path })),
                    error: None,
                    status: 200,
                }),
                Err(e) => Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                    status: 500,
                }),
            }
        }

        "/api/filesystem/move" => {
            // Move is implemented as rename
            let body = req.body.as_ref().ok_or("Missing body")?;
            let old_path = body["source"].as_str().or(body["from"].as_str()).ok_or("Missing source")?;
            let new_path = body["destination"].as_str().or(body["to"].as_str()).ok_or("Missing destination")?;
            let old_canonical = validate_workspace_path(old_path)?;
            let new_canonical = validate_workspace_path(new_path)?;
            if let Some(parent) = new_canonical.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::rename(&old_canonical, &new_canonical) {
                Ok(()) => Ok(ApiRouteResponse {
                    success: true,
                    data: Some(serde_json::json!({ "source": old_path, "destination": new_path })),
                    error: None,
                    status: 200,
                }),
                Err(e) => Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                    status: 500,
                }),
            }
        }

        "/api/filesystem/create-file" => {
            // Same as write — just create/overwrite a file
            let body = req.body.as_ref().ok_or("Missing body")?;
            let path = body["path"].as_str().ok_or("Missing path")?;
            let content = body["content"].as_str().unwrap_or("");
            match write_file_content(path, content) {
                Ok(()) => Ok(ApiRouteResponse {
                    success: true,
                    data: Some(serde_json::json!({ "path": path })),
                    error: None,
                    status: 200,
                }),
                Err(e) => Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(e),
                    status: 500,
                }),
            }
        }

        "/api/filesystem/search" => {
            let search_query = query.and_then(|q| q.get("q")).cloned()
                .or_else(|| req.body.as_ref().and_then(|b| b["q"].as_str().map(String::from)))
                .unwrap_or_default();
            let search_dir = query.and_then(|q| q.get("dir")).cloned()
                .or_else(|| req.body.as_ref().and_then(|b| b["dir"].as_str().map(String::from)))
                .unwrap_or_else(|| ".".to_string());
            let base = validate_workspace_path(&search_dir).ok();
            let results: Vec<serde_json::Value> = if let Some(base_path) = base {
                walkdir::WalkDir::new(&base_path)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        let name = e.file_name().to_string_lossy().to_lowercase();
                        name.contains(&search_query.to_lowercase())
                    })
                    .take(100)
                    .map(|e| {
                        let path = e.path().strip_prefix(&base_path)
                            .unwrap_or(e.path())
                            .to_string_lossy().to_string();
                        serde_json::json!({
                            "path": path,
                            "isDirectory": e.file_type().is_dir(),
                            "size": e.metadata().map(|m| m.len()).unwrap_or(0),
                        })
                    })
                    .collect()
            } else {
                Vec::new()
            };
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({ "results": results })),
                error: None,
                status: 200,
            })
        }

        "/api/filesystem/diffs" => {
            let workspace = query.and_then(|q| q.get("dir")).cloned()
                .unwrap_or_else(|| ".".to_string());
            let ws_path = validate_workspace_path(&workspace)?;
            let output = Command::new("git")
                .args(["diff", "--name-status"])
                .current_dir(&ws_path)
                .output()
                .map_err(|e| format!("Failed to run git diff: {}", e))?;
            let diff_text = String::from_utf8_lossy(&output.stdout).to_string();
            let lines: Vec<&str> = diff_text.lines().collect();
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({ "diffs": lines })),
                error: None,
                status: 200,
            })
        }

        "/api/filesystem/diffs/apply" => {
            let body = req.body.as_ref().ok_or("Missing body")?;
            let diff = body["diff"].as_str().ok_or("Missing diff content")?;
            let workspace = body["dir"].as_str().unwrap_or(".");
            let ws_path = validate_workspace_path(workspace)?;
            // Write diff to temp file
            let temp_path = ws_path.join(".temp_patch.diff");
            std::fs::write(&temp_path, diff)
                .map_err(|e| format!("Failed to write temp diff: {}", e))?;
            let output = Command::new("git")
                .args(["apply", "--whitespace=fix", ".temp_patch.diff"])
                .current_dir(&ws_path)
                .output()
                .map_err(|e| format!("Failed to run git apply: {}", e))?;
            let _ = std::fs::remove_file(&temp_path);
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                return Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(stderr),
                    status: 400,
                });
            }
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({ "message": "Diff applied successfully" })),
                error: None,
                status: 200,
            })
        }

        "/api/filesystem/commits" => {
            // Use git log to get commit history
            let workspace = query.and_then(|q| q.get("dir")).cloned()
                .unwrap_or_else(|| ".".to_string());
            let ws_path = validate_workspace_path(&workspace)?;
            let output = Command::new("git")
                .args(["log", "--pretty=format:%H|%s|%aI", "-n", "50"])
                .current_dir(&ws_path)
                .output()
                .map_err(|e| format!("Failed to run git log: {}", e))?;
            let commits: Vec<serde_json::Value> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.splitn(3, '|').collect();
                    if parts.len() == 3 {
                        Some(serde_json::json!({
                            "id": parts[0],
                            "name": parts[1],
                            "created_at": parts[2],
                            "file_count": 0,
                            "workspace_path": workspace,
                            "commit_hash": parts[0],
                        }))
                    } else {
                        None
                    }
                })
                .collect();
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({ "commits": commits })),
                error: None,
                status: 200,
            })
        }

        "/api/filesystem/rollback" => {
            // Use git reset to restore a commit
            let body = req.body.as_ref().ok_or("Missing body")?;
            let workspace = body["workspace"].as_str().unwrap_or(".");
            let commit_id = body["commitId"].as_str().or(body["commit_id"].as_str()).ok_or("Missing commitId")?;
            let ws_path = validate_workspace_path(workspace)?;
            let output = Command::new("git")
                .args(["reset", "--hard", commit_id])
                .current_dir(&ws_path)
                .output()
                .map_err(|e| format!("Failed to run git reset: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                return Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(stderr),
                    status: 400,
                });
            }
            let files_restored = String::from_utf8_lossy(&output.stdout).lines().count();
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({ "filesRestored": files_restored })),
                error: None,
                status: 200,
            })
        }

        "/api/filesystem/snapshot" => {
            // Use git add + commit to create a snapshot
            let body = req.body.as_ref();
            let workspace = body.and_then(|b| b["workspace"].as_str()).unwrap_or(".");
            let name = body.and_then(|b| b["name"].as_str()).unwrap_or("snapshot");
            let ws_path = validate_workspace_path(workspace)?;
            let _ = Command::new("git")
                .args(["add", "."])
                .current_dir(&ws_path)
                .output();
            let output = Command::new("git")
                .args(["commit", "-m", name])
                .current_dir(&ws_path)
                .output();
            match output {
                Ok(out) if out.status.success() => {
                    let hash_output = Command::new("git")
                        .args(["rev-parse", "HEAD"])
                        .current_dir(&ws_path)
                        .output();
                    let hash = hash_output.ok()
                        .and_then(|o| String::from_utf8(o.stdout).ok())
                        .map(|s| s.trim().to_string())
                        .unwrap_or_default();
                    Ok(ApiRouteResponse {
                        success: true,
                        data: Some(serde_json::json!({
                            "snapshot": {
                                "id": hash,
                                "name": name,
                                "commit_hash": hash,
                                "workspace_path": workspace,
                            }
                        })),
                        error: None,
                        status: 200,
                    })
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    Ok(ApiRouteResponse {
                        success: false,
                        data: None,
                        error: Some(stderr),
                        status: 400,
                    })
                }
                Err(e) => Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(format!("Failed to run git commit: {}", e)),
                    status: 500,
                }),
            }
        }

        "/api/filesystem/snapshot/restore" => {
            // Same as rollback — use git reset
            let body = req.body.as_ref().ok_or("Missing body")?;
            let workspace = body["workspace"].as_str().unwrap_or(".");
            let snapshot_id = body["snapshotId"].as_str().or(body["snapshot_id"].as_str()).ok_or("Missing snapshotId")?;
            let ws_path = validate_workspace_path(workspace)?;
            let output = Command::new("git")
                .args(["reset", "--hard", snapshot_id])
                .current_dir(&ws_path)
                .output()
                .map_err(|e| format!("Failed to run git reset: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                return Ok(ApiRouteResponse {
                    success: false,
                    data: None,
                    error: Some(stderr),
                    status: 400,
                });
            }
            let files_restored = String::from_utf8_lossy(&output.stdout).lines().count();
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({ "filesRestored": files_restored })),
                error: None,
                status: 200,
            })
        }

        // ── Edit transaction management ────────────────────────────────────
        // In desktop mode, files are written directly to disk — no VFS transaction layer.
        // These endpoints return graceful success/fallback responses.

        "/api/filesystem/edits/accept" => {
            let body = req.body.as_ref().ok_or("Missing body")?;
            let transaction_id = body["transactionId"].as_str()
                .or(body["transaction_id"].as_str())
                .ok_or("Missing transactionId")?;
            // Desktop mode: no VFS transaction layer — edits are already applied to disk
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({
                    "transaction": {
                        "id": transaction_id,
                        "status": "accepted",
                        "note": "Desktop mode: edits are applied directly to disk"
                    }
                })),
                error: None,
                status: 200,
            })
        }

        "/api/filesystem/edits/deny" => {
            let body = req.body.as_ref().ok_or("Missing body")?;
            let _transaction_id = body["transactionId"].as_str()
                .or(body["transaction_id"].as_str())
                .ok_or("Missing transactionId")?;
            let _reason = body["reason"].as_str().unwrap_or("");
            // Desktop mode: no VFS transaction layer — edits are already applied to disk
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({
                    "status": "denied",
                    "note": "Desktop mode: edits are applied directly to disk; denials are logged only"
                })),
                error: None,
                status: 200,
            })
        }

        // ── Filesystem event bus ───────────────────────────────────────────

        "/api/filesystem/events/push" => {
            // Accept filesystem event broadcasts from clients
            // In desktop mode, events are handled locally via Tauri events
            if req.method == "GET" {
                // SSE streaming requires the sidecar — return info
                return Ok(ApiRouteResponse {
                    success: true,
                    data: Some(serde_json::json!({
                        "note": "SSE streaming is handled by the desktop Tauri event system",
                        "useTauriEvents": true
                    })),
                    error: None,
                    status: 200,
                });
            }
            let body = req.body.as_ref().ok_or("Missing body")?;
            // Emit Tauri event for any listening components
            // The event payload is passed through as-is
            let event_type = body["type"].as_str().unwrap_or("unknown");
            let path = body["path"].as_str().unwrap_or("");
            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({
                    "event": event_type,
                    "path": path,
                    "note": "Event accepted — desktop mode uses Tauri event system"
                })),
                error: None,
                status: 200,
            })
        }

        // ── File import ───────────────────────────────────────────────────

        "/api/filesystem/import" => {
            if req.method == "GET" {
                // Return import configuration info
                return Ok(ApiRouteResponse {
                    success: true,
                    data: Some(serde_json::json!({
                        "limits": {
                            "maxFiles": 100,
                            "maxFileSize": "100MB",
                            "maxTotalSize": "500MB"
                        },
                        "supportedFormats": [
                            "JavaScript/TypeScript (.js, .jsx, .ts, .tsx)",
                            "Python (.py)",
                            "Java (.java)",
                            "C/C++ (.c, .cpp, .h, .hpp)",
                            "Web (.html, .css, .scss)",
                            "Config (.json, .yaml, .yml, .xml)",
                            "Markdown (.md)",
                            "Shell (.sh, .bash)",
                            "Rust (.rs)",
                            "Go (.go)",
                            "And many more..."
                        ]
                    })),
                    error: None,
                    status: 200,
                });
            }
            // POST: Import files — writes files directly to disk
            let body = req.body.as_ref().ok_or("Missing body")?;
            let files = body["files"].as_array().ok_or("Missing files array")?;
            let dest_dir = body["destinationPath"].as_str().unwrap_or(".");
            let dest_path = validate_workspace_path(dest_dir)?;

            let mut imported: Vec<serde_json::Value> = Vec::new();
            let mut errors: Vec<String> = Vec::new();

            for file_entry in files {
                let name = file_entry["name"].as_str().unwrap_or("unnamed");
                let content = file_entry["content"].as_str().unwrap_or("");
                let rel_path = file_entry["path"].as_str().unwrap_or(name);

                // Security: reject paths with traversal components
                if rel_path.contains("..") {
                    errors.push(format!("{}: path traversal not allowed", name));
                    continue;
                }

                // Build full path and ensure it stays within dest_path
                let full_path = dest_path.join(rel_path);
                // Normalize: check it starts with dest_path
                if !full_path.starts_with(&dest_path) {
                    errors.push(format!("{}: resolved path escapes destination", name));
                    continue;
                }
                if let Some(parent) = full_path.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        errors.push(format!("{}: failed to create dir: {}", name, e));
                        continue;
                    }
                }
                match std::fs::write(&full_path, content) {
                    Ok(()) => {
                        let size = content.len();
                        imported.push(serde_json::json!({
                            "path": rel_path,
                            "size": size,
                        }));
                    }
                    Err(e) => errors.push(format!("{}: {}", name, e)),
                }
            }

            Ok(ApiRouteResponse {
                success: !imported.is_empty(),
                data: Some(serde_json::json!({
                    "importedFiles": imported.len(),
                    "files": imported,
                    "errors": errors,
                    "destinationPath": dest_dir,
                })),
                error: if errors.is_empty() { None } else { Some(format!("{} files failed", errors.len())) },
                status: 200,
            })
        }

        // ── Context Pack ───────────────────────────────────────────────────

        "/api/filesystem/context-pack" => {
            // Generate a dense, LLM-friendly bundle of directory structure + file contents
            let (path, format, include_contents, exclude_patterns) = if req.method == "GET" {
                let q = query;
                let path = q.and_then(|m| m.get("path")).cloned().unwrap_or_else(|| "/".to_string());
                let fmt = q.and_then(|m| m.get("format")).cloned().unwrap_or_else(|| "markdown".to_string());
                let inc = q.and_then(|m| m.get("includeContents"))
                    .map(|v| v != "false").unwrap_or(true);
                let excl = q.and_then(|m| m.get("excludePatterns"))
                    .map(|v| v.split(',').map(|s| s.trim().to_string()).collect::<Vec<_>>());
                (path, fmt, inc, excl)
            } else {
                let body = req.body.as_ref().ok_or("Missing body")?;
                let path = body["path"].as_str().unwrap_or("/").to_string();
                let fmt = body["format"].as_str().unwrap_or("markdown").to_string();
                let inc = body["includeContents"].as_bool().unwrap_or(true);
                let excl = body["excludePatterns"].as_array().map(|arr| {
                    arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
                });
                (path, fmt, inc, excl)
            };

            // Strip leading slash for filesystem path
            let fs_path = path.strip_prefix('/').unwrap_or(&path);
            let base = validate_workspace_path(fs_path)
                .or_else(|_| validate_workspace_path("."));

            let (bundle, file_count, total_size) = if let Ok(base_path) = base {
                let mut files: Vec<(String, String, bool)> = Vec::new();
                let mut total_size = 0usize;
                let exclude: Vec<String> = exclude_patterns.unwrap_or_else(|| vec![
                    ".git".to_string(), "node_modules".to_string(), "target".to_string(),
                    ".next".to_string(), "dist".to_string(), ".env".to_string(),
                ]);

                for entry in walkdir::WalkDir::new(&base_path)
                    .into_iter()
                    .filter_entry(|e| {
                        let name = e.file_name().to_string_lossy();
                        !exclude.iter().any(|ex| name.contains(ex.as_str()))
                    })
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().is_file())
                {
                    let rel_path = entry.path()
                        .strip_prefix(&base_path)
                        .unwrap_or(entry.path())
                        .to_string_lossy()
                        .to_string();

                    if let Ok(content) = std::fs::read_to_string(entry.path()) {
                        let size = content.len();
                        let truncated = size > 50_000;
                        let display_content = if truncated {
                            content.chars().take(50_000).collect::<String>() + "\n... [truncated]"
                        } else {
                            content
                        };
                        files.push((rel_path, display_content, truncated));
                        total_size += size;
                    }
                }

                // Format the bundle
                let bundle = if format == "json" {
                    let entries: Vec<serde_json::Value> = files.iter().map(|(p, c, _t)| {
                        serde_json::json!({ "path": p, "content": c })
                    }).collect();
                    serde_json::json!({
                        "root": path,
                        "files": entries,
                        "fileCount": files.len(),
                        "totalSize": total_size,
                    }).to_string()
                } else {
                    let mut out = String::new();
                    out.push_str(&format!("# Context Pack: {}\n\n", path));
                    out.push_str(&format!("## Files ({})\n\n", files.len()));
                    for (p, _, _) in &files {
                        out.push_str(&format!("- `{}`\n", p));
                    }
                    if include_contents {
                        out.push_str("\n---\n\n");
                        for (p, c, truncated) in &files {
                            out.push_str(&format!("## File: {}\n\n", p));
                            out.push_str("```\n");
                            out.push_str(c);
                            if *truncated { out.push_str("\n... [truncated]"); }
                            out.push_str("\n```\n\n");
                        }
                    }
                    out
                };
                (bundle, files.len(), total_size)
            } else {
                ("# Context Pack\n\nDirectory not found.".to_string(), 0, 0)
            };

            let estimated_tokens = total_size / 4;

            Ok(ApiRouteResponse {
                success: true,
                data: Some(serde_json::json!({
                    "bundle": bundle,
                    "fileCount": file_count,
                    "totalSize": total_size,
                    "estimatedTokens": estimated_tokens,
                    "format": format,
                })),
                error: None,
                status: 200,
            })
        }

        _ => Ok(ApiRouteResponse {
            success: false,
            data: None,
            error: Some("Route not handled by Tauri — use sidecar".to_string()),
            status: 501,
        }),
    }
}

/// Simple file write helper (without AppHandle event emission)
fn write_file_content(path: &str, content: &str) -> Result<(), String> {
    let canonical = validate_workspace_path(path)?;
    if let Some(parent) = canonical.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&canonical, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

// ============================================================================
// Settings persistence — stored as JSON in the OS app-data directory
// ============================================================================

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse settings: {}", e))
}
