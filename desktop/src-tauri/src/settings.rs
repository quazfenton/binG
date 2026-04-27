//! Unified Settings Module for Desktop
//!
//! This module provides settings management that aligns with the shared
//! TypeScript settings schema in packages/shared/lib/settings-schema.ts
//!
//! Storage: OS app-data directory / settings.json
//! Schema version: 1.0.0

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ============================================================================
// Settings Schema (mirrors TypeScript UnifiedSettings)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = “camelCase”)]
pub struct UnifiedSettings {
    pub version: String,
    pub workspace: WorkspaceConfig,
    pub auth: AuthState,
    pub llm: LLMConfig,
    pub sandbox: SandboxConfig,
    pub display: DisplayConfig,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub created_at: Option<u64>,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub updated_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = “camelCase”)]
pub struct WorkspaceConfig {
    pub root: String,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub last_opened: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = “camelCase”)]
pub struct AuthState {
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub token: Option<String>,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub email: Option<String>,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = “camelCase”)]
pub struct LLMConfig {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = “camelCase”)]
pub struct SandboxConfig {
    pub provider: String,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub current_sandbox_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = “camelCase”)]
pub struct DisplayConfig {
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub theme: Option<String>, // “light”, “dark”, “auto”
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub stream_output: Option<bool>,
    #[serde(skip_serializing_if = “Option::is_none”)]
    pub verbose_logging: Option<bool>,
}

impl Default for UnifiedSettings {
    fn default() -> Self {
        Self {
            version: “1.0.0”.to_string(),
            workspace: WorkspaceConfig {
                root: std::env::current_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| “.”.to_string()),
                last_opened: Some(chrono::Utc::now().to_rfc3339()),
            },
            auth: AuthState {
                token: None,
                user_id: None,
                email: None,
                expires_at: None,
            },
            llm: LLMConfig {
                provider: std::env::var(“DEFAULT_LLM_PROVIDER”)
                    .unwrap_or_else(|_| “anthropic”.to_string()),
                model: std::env::var(“DEFAULT_MODEL”)
                    .unwrap_or_else(|_| “claude-3-5-sonnet-latest”.to_string()),
                temperature: std::env::var(“DEFAULT_TEMPERATURE”)
                    .ok()
                    .and_then(|v| v.parse().ok()),
                max_tokens: std::env::var(“DEFAULT_MAX_TOKENS”)
                    .ok()
                    .and_then(|v| v.parse().ok()),
            },
            sandbox: SandboxConfig {
                provider: std::env::var(“SANDBOX_PROVIDER”)
                    .unwrap_or_else(|_| “daytona”.to_string()),
                current_sandbox_id: None,
            },
            display: DisplayConfig {
                theme: Some(“auto”.to_string()),
                stream_output: Some(true),
                verbose_logging: Some(false),
            },
            created_at: Some(current_timestamp()),
            updated_at: Some(current_timestamp()),
        }
    }
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ============================================================================
// Settings Manager
// ============================================================================

/// Get the settings file path within the app data directory
pub fn get_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!(“Failed to resolve app data dir: {}”, e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!(“Failed to create app data dir: {}”, e))?;
    Ok(dir.join(“settings.json”))
}

/// Load settings from disk, or return defaults
pub fn load_settings(app: &tauri::AppHandle) -> Result<UnifiedSettings, String> {
    let path = get_settings_path(app)?;
    
    if !path.exists() {
        return Ok(UnifiedSettings::default());
    }
    
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!(“Failed to read settings: {}”, e))?;
    
    let mut settings: UnifiedSettings = serde_json::from_str(&raw)
        .map_err(|e| format!(“Failed to parse settings: {}”, e))?;
    
    // Migration: fix bundled workspace paths
    if let Some(root) = settings.workspace.root.as_ref() {
        let looks_bundled = root.contains(“desktop\\src-tauri\\target\\release”)
            || root.contains(“desktop/src-tauri/target/release”)
            || root.contains(“\\web-assets\\”)
            || root.contains(“/web-assets/”)
            || root.contains(“\\node_modules\\”)
            || root.contains(“/node_modules/”);
        
        if looks_bundled {
            if let Ok(fallback) = std::env::var(“DESKTOP_WORKSPACE_ROOT”) {
                settings.workspace.root = fallback;
            }
        }
    }
    
    Ok(settings)
}

/// Save settings to disk with secure file permissions
pub fn save_settings(app: &tauri::AppHandle, settings: &UnifiedSettings) -> Result<(), String> {
    let path = get_settings_path(app)?;
    
    let mut settings = settings.clone();
    settings.updated_at = Some(current_timestamp());
    settings.version = “1.0.0”.to_string();
    
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!(“Failed to serialize settings: {}”, e))?;
    
    fs::write(&path, json)
        .map_err(|e| format!(“Failed to write settings: {}”, e))?;
    
    // Set file permissions to 0o600 (owner read/write only) for security
    // This ensures sensitive data (auth tokens, API keys) is not world-readable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(&path)
            .map_err(|e| format!(“Failed to get file metadata: {}”, e))?;
        let mut perms = metadata.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)
            .map_err(|e| format!(“Failed to set file permissions: {}”, e))?;
    }
    
    Ok(())
}

/// Update workspace root in settings
pub fn update_workspace_root(app: &tauri::AppHandle, workspace_path: &str) -> Result<UnifiedSettings, String> {
    let mut settings = load_settings(app)?;
    
    // Validate the path exists and is a directory
    let path = PathBuf::from(workspace_path);
    if !path.exists() {
        return Err(format!(“Path does not exist: {}”, workspace_path));
    }
    if !path.is_dir() {
        return Err(format!(“Path is not a directory: {}”, workspace_path));
    }
    
    // Canonicalize the path
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!(“Failed to canonicalize path: {}”, e))?;
    
    settings.workspace.root = canonical.to_string_lossy().to_string();
    settings.workspace.last_opened = Some(chrono::Utc::now().to_rfc3339());
    
    save_settings(app, &settings)?;
    
    // Also update environment variable so child processes can access it
    std::env::set_var(“DESKTOP_WORKSPACE_ROOT”, &settings.workspace.root);
    
    Ok(settings)
}

/// Get workspace root from settings
pub fn get_workspace_root(app: &tauri::AppHandle) -> Result<String, String> {
    let settings = load_settings(app)?;
    Ok(settings.workspace.root)
}

/// Check if settings file exists
pub fn settings_exist(app: &tauri::AppHandle) -> bool {
    get_settings_path(app).map(|p| p.exists()).unwrap_or(false)
}

/// Get the settings directory path (exposed for CLI compatibility)
pub fn get_settings_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!(“Failed to resolve app data dir: {}”, e))
}