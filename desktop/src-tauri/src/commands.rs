use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

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
    // Validate path to prevent directory traversal attacks
    let base_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to resolve base directory: {}", e))?;
    let requested = std::path::Path::new(&file_path);
    
    if requested.is_absolute() || requested.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("Access denied: path must stay within workspace".to_string());
    }
    
    let full_path = base_dir.join(requested);
    std::fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_file(file_path: String, content: String) -> Result<(), String> {
    // Validate path to prevent directory traversal attacks
    let base_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to resolve base directory: {}", e))?;
    let requested = std::path::Path::new(&file_path);
    
    if requested.is_absolute() || requested.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("Access denied: path must stay within workspace".to_string());
    }
    
    let full_path = base_dir.join(requested);
    
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&full_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub async fn list_directory(dir_path: String) -> Result<Vec<FileEntry>, String> {
    // Validate path to prevent directory traversal attacks
    let base_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to resolve base directory: {}", e))?;
    let requested = std::path::Path::new(&dir_path);
    
    if requested.is_absolute() || requested.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("Access denied: path must stay within workspace".to_string());
    }
    
    let full_path = base_dir.join(requested);
    let entries = std::fs::read_dir(&full_path).map_err(|e| format!("Failed to read directory: {}", e))?;

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

#[derive(Debug, Serialize, Deserialize, Deserialize)]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub data: String,
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
        loop {
            // Get master from sessions
            let master = {
                let sessions = match sessions_clone.lock() {
                    Ok(s) => s,
                    Err(_) => break,
                };
                match sessions.get(&session_id_clone) {
                    Some(s) => s.master.try_clone_reader(),
                    None => break,
                }
            };
            
            let mut reader = match master {
                Ok(r) => r,
                Err(_) => break,
            };

            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_clone.emit("pty-output", PtyOutputEvent {
                        session_id: session_id_clone.clone(),
                        data,
                    });
                }
                Err(_) => break,
            }
        }
        // Emit close event
        let _ = app_clone.emit("pty-closed", serde_json::json!({ "session_id": session_id_clone }));
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
