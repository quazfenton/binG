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
use tauri::Manager;

// ============================================================================
// Settings Schema (mirrors TypeScript UnifiedSettings)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedSettings {
    pub version: String,
    pub workspace: WorkspaceConfig,
    pub auth: AuthState,
    pub llm: LLMConfig,
    pub sandbox: SandboxConfig,
    pub display: DisplayConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LLMConfig {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxConfig {
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_sandbox_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>, // "light", "dark", "auto"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_output: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verbose_logging: Option<bool>,
}

impl Default for UnifiedSettings {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            workspace: WorkspaceConfig {
                root: std::env::current_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| ".".to_string()),
                last_opened: Some(chrono::Utc::now().to_rfc3339()),
            },
            auth: AuthState {
                token: None,
                user_id: None,
                email: None,
                expires_at: None,
            },
            llm: LLMConfig {
                provider: std::env::var("DEFAULT_LLM_PROVIDER")
                    .unwrap_or_else(|_| "anthropic".to_string()),
                model: std::env::var("DEFAULT_MODEL")
                    .unwrap_or_else(|_| "claude-3-5-sonnet-latest".to_string()),
                temperature: std::env::var("DEFAULT_TEMPERATURE")
                    .ok()
                    .and_then(|v| v.parse().ok()),
                max_tokens: std::env::var("DEFAULT_MAX_TOKENS")
                    .ok()
                    .and_then(|v| v.parse().ok()),
            },
            sandbox: SandboxConfig {
                provider: std::env::var("SANDBOX_PROVIDER")
                    .unwrap_or_else(|_| "daytona".to_string()),
                current_sandbox_id: None,
            },
            display: DisplayConfig {
                theme: Some("auto".to_string()),
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
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(dir.join("settings.json"))
}

/// Load settings from disk, or return defaults
pub fn load_settings(app: &tauri::AppHandle) -> Result<UnifiedSettings, String> {
    let path = get_settings_path(app)?;
    
    if !path.exists() {
        return Ok(UnifiedSettings::default());
    }
    
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;
    
    let mut settings: UnifiedSettings = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse settings: {}", e))?;
    
    // Migration: fix bundled workspace paths
    {
        let root = &settings.workspace.root;
        let looks_bundled = root.contains("desktop\\src-tauri\\target\\release")
            || root.contains("desktop/src-tauri/target/release")
            || root.contains("\\web-assets\\")
            || root.contains("/web-assets/")
            || root.contains("\\node_modules\\")
            || root.contains("/node_modules/");
        
        if looks_bundled {
            if let Ok(fallback) = std::env::var("DESKTOP_WORKSPACE_ROOT") {
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
    settings.version = "1.0.0".to_string();
    
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    
    fs::write(&path, json)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    
    // Set file permissions to 0o600 (owner read/write only) for security
    // This ensures sensitive data (auth tokens, API keys) is not world-readable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(&path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;
        let mut perms = metadata.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)
            .map_err(|e| format!("Failed to set file permissions: {}", e))?;
    }
    
    #[cfg(windows)]
    {
        // Apply Windows file security: restrict settings.json to current user only
        // Uses SetNamedSecurityInfo to set a DACL that:
        //   1. Denies read/write access to Everyone
        //   2. Grants full access to the current user
        // Also marks the file as hidden+system for additional protection
        restrict_windows_file(&path);
    }
    
    Ok(())
}

/// Update workspace root in settings
pub fn update_workspace_root(app: &tauri::AppHandle, workspace_path: &str) -> Result<UnifiedSettings, String> {
    let mut settings = load_settings(app)?;
    
    // Validate the path exists and is a directory
    let path = PathBuf::from(workspace_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", workspace_path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", workspace_path));
    }
    
    // Canonicalize the path
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Failed to canonicalize path: {}", e))?;
    
    settings.workspace.root = canonical.to_string_lossy().to_string();
    settings.workspace.last_opened = Some(chrono::Utc::now().to_rfc3339());
    
    save_settings(app, &settings)?;
    
    // Also update environment variable so child processes can access it
    std::env::set_var("DESKTOP_WORKSPACE_ROOT", &settings.workspace.root);
    
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
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))
}

// ============================================================================
// Windows Security (ACL-based file protection)
// ============================================================================

#[cfg(windows)]
fn restrict_windows_file(path: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Security::Authorization::{
        CreateWellKnownSid, WinWorldSid, CreateExplicitAccessFromNamedSD, SetEntriesInAclW,
        GetNamedSecurityInfoW, SetNamedSecurityInfoW,
        SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, DACL_PROTECTED,
        GRANT_ACCESS, NO_INHERITANCE,
    };
    use windows::Win32::Storage::FileSystem::{
        SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM, FILE_ATTRIBUTE_READONLY,
    };

    // Convert path to wide string (null-terminated)
    fn to_wide(path: &std::path::Path) -> Vec<u16> {
        std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let path_wide = to_wide(path);
    let path_ptr = PCWSTR(path_wide.as_ptr());

    unsafe {
        // Step 1: Get current user SID from process token
        let mut token: HANDLE = HANDLE::default();
        let process = windows::Win32::Foundation::GetCurrentProcess();
        let token_result = windows::Win32::Security::Authentication::OpenProcessToken(
            process,
            windows::Win32::Security::Authentication::TOKEN_QUERY.0,
            &mut token,
        );

        if token_result.is_err() {
            log::log_msg("[settings] Failed to open process token for ACL");
            // Fall back to just setting attributes
            set_file_attributes_fallback(path_ptr);
            return;
        }

        // Get token information size
        let mut info_size: u32 = 0;
        windows::Win32::Security::Authentication::GetTokenInformation(
            token,
            windows::Win32::Security::Authentication::TokenUser,
            None,
            0,
            &mut info_size,
        );

        if info_size == 0 {
            log::log_msg("[settings] Failed to get token info size");
            set_file_attributes_fallback(path_ptr);
            return;
        }

        // Get token user information
        let mut token_buf: Vec<u8> = vec![0u8; info_size as usize];
        let query_result = windows::Win32::Security::Authentication::GetTokenInformation(
            token,
            windows::Win32::Security::Authentication::TokenUser,
            Some(token_buf.as_mut_slice().as_mut_ptr() as *mut _),
            info_size,
            &mut info_size,
        );

        if query_result.is_err() {
            log::log_msg("[settings] Failed to query token user");
            set_file_attributes_fallback(path_ptr);
            return;
        }

        // Extract SID from token info
        let token_user = &*(token_buf.as_ptr() as *const windows::Win32::Security::Authentication::TOKEN_USER);
        let user_sid = token_user.User.Sid;

        // Step 2: Create SID for Everyone (World)
        // Use a fixed-size buffer to avoid pointer invalidation issues
        let mut sid_size: u32 = 0;
        CreateWellKnownSid(WinWorldSid, None, None, &mut sid_size);
        
        // Allocate with extra space for safety
        let mut everyone_buf: Vec<u8> = vec![0u8; (sid_size + 32) as usize];
        let mut everyone_sid = windows::Win32::Security::PSID(everyone_buf.as_ptr() as *mut _);
        
        let create_result = CreateWellKnownSid(
            WinWorldSid,
            None,
            Some(everyone_sid),
            &mut sid_size,
        );

        if create_result.is_err() {
            log::log_msg("[settings] Failed to create Everyone SID");
            set_file_attributes_fallback(path_ptr);
            return;
        }

        // Step 3: Create explicit access for current user (Allow Full Control)
        let mut user_access = windows::Win32::Security::EXPLICIT_ACCESS_W::default();
        let user_create_result = CreateExplicitAccessFromNamedSD(
            &mut user_access,
            Some(user_sid.0 as *const _),
            windows::Win32::Security::ACCESS_MODE(GRANT_ACCESS.0),
            windows::Win32::Security::INHERITANCE(NO_INHERITANCE.0),
            windows::Win32::Security::GENERIC_ALL, // Full control
        );

        if user_create_result.is_err() {
            log::log_msg("[settings] Failed to create user explicit access");
            set_file_attributes_fallback(path_ptr);
            return;
        }

        // Step 4: Create explicit access for Everyone (Deny Read/Write)
        let mut everyone_access = windows::Win32::Security::EXPLICIT_ACCESS_W::default();
        let everyone_create_result = CreateExplicitAccessFromNamedSD(
            &mut everyone_access,
            Some(everyone_sid.0 as *const _),
            windows::Win32::Security::ACCESS_MODE(windows::Win32::Security::DENY_ACCESS.0),
            windows::Win32::Security::INHERITANCE(NO_INHERITANCE.0),
            windows::Win32::Security::GENERIC_READ | windows::Win32::Security::GENERIC_WRITE,
        );

        if everyone_create_result.is_err() {
            log::log_msg("[settings] Failed to create Everyone explicit access");
            set_file_attributes_fallback(path_ptr);
            return;
        }

        // Step 5: Build new DACL from the explicit access entries
        let mut new_dacl: *mut windows::Win32::Security::ACL = std::ptr::null_mut();
        let dacl_result = SetEntriesInAclW(
            2,
            [user_access, everyone_access].as_mut_ptr(),
            None,
            &mut new_dacl,
        );

        if dacl_result.is_err() || new_dacl.is_null() {
            log::log_msg("[settings] Failed to build DACL");
            set_file_attributes_fallback(path_ptr);
            return;
        }

        // Step 6: Apply the security descriptor with the new DACL
        let set_result = SetNamedSecurityInfoW(
            path_ptr,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | DACL_PROTECTED,
            None, // Keep current owner
            None, // Keep current group
            Some(new_dacl),
            None, // Keep current SACL
        );

        // Clean up DACL
        windows::Win32::Foundation::LocalFree(windows::Win32::Foundation::HLOCAL(new_dacl as *mut _));

        if set_result.is_ok() {
            log::log_msg("[settings] Windows ACL security applied (current user: full, Everyone: denied)");
        } else {
            log::log_msg(&format!("[settings] SetNamedSecurityInfo failed: {:?}", set_result));
        }

        // Step 7: Also set file attributes as additional protection (hidden+system+readonly)
        set_file_attributes_fallback(path_ptr);
    }
}

#[cfg(windows)]
unsafe fn set_file_attributes_fallback(path_ptr: PCWSTR) {
    use windows::Win32::Storage::FileSystem::{
        SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
    };

    // Only set HIDDEN | SYSTEM - NOT READONLY to allow file updates
    // The ACL already restricts access to current user, so READONLY is redundant
    let attrs = FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM;
    if SetFileAttributesW(path_ptr, attrs).is_ok() {
        log::log_msg("[settings] Windows file attributes set (hidden+system)");
    }
}