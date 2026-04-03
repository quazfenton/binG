use serde::{Deserialize, Serialize};
use std::process::Command;

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
