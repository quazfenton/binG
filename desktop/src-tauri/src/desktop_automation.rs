use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct DesktopAutomationResult<T> {
    pub version: String,
    pub ok: bool,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DesktopAutomationError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DesktopAutomationError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowInfo {
    pub id: String,
    pub title: String,
    pub app_name: String,
    pub pid: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<Rect>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppInfo {
    pub name: String,
    pub bundle_id: Option<String>,
    pub pid: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccessibilityNode {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<String>,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub states: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<Rect>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub children: Vec<AccessibilityNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children_count: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SnapshotOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    pub interactive_only: bool,
    pub compact: bool,
    pub include_bounds: bool,
    pub max_depth: u8,
    pub skeleton: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    pub surface: String,
}

impl Default for SnapshotOptions {
    fn default() -> Self {
        Self {
            app: None,
            window_id: None,
            interactive_only: false,
            compact: false,
            include_bounds: false,
            max_depth: 10,
            skeleton: false,
            root: None,
            surface: "window".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClickOptions {
    pub ref_id: String,
    #[serde(default = "default_click_count")]
    pub clicks: u32,
}

fn default_click_count() -> u32 { 1 }

#[derive(Debug, Serialize, Deserialize)]
pub struct TypeOptions {
    pub ref_id: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyPressOptions {
    pub combo: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MouseOptions {
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub button: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DragOptions {
    pub from_x: f64,
    pub from_y: f64,
    pub to_x: f64,
    pub to_y: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScrollOptions {
    pub direction: String,
    pub amount: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FindOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WaitOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub menu: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    pub timeout_ms: u64,
}

impl Default for WaitOptions {
    fn default() -> Self {
        Self {
            element: None,
            window: None,
            text: None,
            menu: None,
            app: None,
            timeout_ms: 5000,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScreenshotOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    pub quality: u8,
}

impl Default for ScreenshotOptions {
    fn default() -> Self {
        Self {
            window_id: None,
            quality: 80,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DesktopAutomationStatus {
    pub platform: String,
    pub permission_granted: bool,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScreenshotResult {
    pub width: u32,
    pub height: u32,
    pub image_base64: String,
    pub format: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LaunchAppOptions {
    pub app_id: String,
    pub wait: bool,
}

impl Default for LaunchAppOptions {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            wait: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WindowOpOptions {
    pub window_id: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

fn wrap_result<T: Serialize>(command: &str, result: Result<T, String>) -> DesktopAutomationResult<T> {
    match result {
        Ok(data) => DesktopAutomationResult {
            version: "1.0".to_string(),
            ok: true,
            command: command.to_string(),
            data: Some(data),
            error: None,
        },
        Err(msg) => DesktopAutomationResult {
            version: "1.0".to_string(),
            ok: false,
            command: command.to_string(),
            data: None,
            error: Some(DesktopAutomationError {
                code: "ACTION_FAILED".to_string(),
                message: msg,
                suggestion: None,
            }),
        },
    }
}

// ============================================================================
// macOS Platform Implementation
// ============================================================================

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use core_graphics::display::{CGDisplay, CGWindowListCopyWindowInfo, kCGNullWindowID, kCGWindowListOptionOnScreenOnly};
    use core_graphics::image::ImageFormat;
    use std::process::Command;

    pub fn check_permissions() -> bool {
        unsafe {
            let trusted = accessibility_sys::AXIsProcessTrusted();
            trusted != 0
        }
    }

    pub fn request_permissions() -> Result<bool, String> {
        unsafe {
            let options = core_foundation::dictionary::CFDictionary::from_CFType_pairs(&[
                (CFString::wrap_under_get_rule(accessibility_sys::kAXTrustedCheckOptionPrompt.take()), core_foundation::boolean::CFBoolean::true_value().as_CFType())
            ]);
            let trusted = accessibility_sys::AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef());
            Ok(trusted != 0)
        }
    }

    pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
        let window_list = unsafe { CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID) };
        let mut skipped_count = 0;
        let windows: Vec<WindowInfo> = window_list
            .iter()
            .filter_map(|w| {
                let dict: CFDictionary<CFString, CFString> = CFDictionary::wrap_under_get_rule(w as *mut _);
                let name = dict.find(CFString::from("kCGWindowName")).map(|s| s.to_string());
                let owner = dict.find(CFString::from("kCGWindowOwnerName")).map(|s| s.to_string());
                let pid = dict.find(CFString::from("kCGWindowOwnerPID")).and_then(|n| n.parse::<i32>().ok());
                let window_id = dict.find(CFString::from("kCGWindowNumber")).map(|n| n.to_string());
                
                if window_id.is_none() || pid.is_none() {
                    skipped_count += 1;
                    return None;
                }
                
                Some(WindowInfo {
                    id: window_id?,
                    title: name.unwrap_or_default(),
                    app_name: owner.unwrap_or_default(),
                    pid: pid?,
                    bounds: None,
                })
            })
            .collect();
        
        if skipped_count > 0 {
            eprintln!("[list_windows] Skipped {} windows with missing required fields", skipped_count);
        }
        
        Ok(windows)
    }

    pub fn list_apps() -> Result<Vec<AppInfo>, String> {
        let output = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to get name of every process whose background only is false")
            .output()
            .map_err(|e| format!("Failed to list apps: {}", e))?;
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let apps: Vec<AppInfo> = stdout
            .split(", ")
            .filter(|s| !s.trim().is_empty())
            .map(|name| AppInfo {
                name: name.trim().to_string(),
                bundle_id: None,
                pid: 0,
            })
            .collect();
        Ok(apps)
    }

    pub fn snapshot(_opts: SnapshotOptions) -> Result<AccessibilityNode, String> {
        Err("Full snapshot requires AXUIElement tree traversal. Use agent-desktop CLI for complete functionality.".to_string())
    }

    pub fn screenshot(opts: ScreenshotOptions) -> Result<ScreenshotResult, String> {
        let display = CGDisplay::main();
        let image = display.screenshot()
            .map_err(|_| "Failed to capture screenshot")?;
        
        let width = image.width();
        let height = image.height();
        
        let mut data = Vec::new();
        image.write_to(&mut data, ImageFormat::Png)
            .map_err(|e| format!("Failed to encode PNG: {:?}", e))?;
        
        Ok(ScreenshotResult {
            width,
            height,
            image_base64: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data),
            format: "png".to_string(),
        })
    }

    pub fn click(_opts: ClickOptions) -> Result<String, String> {
        Err("Click requires AXUIElement ref resolution. Use agent-desktop CLI.".to_string())
    }

    pub fn type_text(_opts: TypeOptions) -> Result<String, String> {
        Err("Type requires AXUIElement ref resolution. Use agent-desktop CLI.".to_string())
    }

    pub fn press_key(combo: String) -> Result<String, String> {
        let parts: Vec<&str> = combo.split('+').collect();
        let key = parts.last().unwrap_or(&"");
        let modifiers: Vec<&str> = if parts.len() > 1 { parts[..parts.len()-1].to_vec() } else { vec![] };
        
        let mut script = String::from("tell application \"System Events\" to keystroke \"");
        script.push_str(key);
        script.push_str("\"");
        if !modifiers.is_empty() {
            script.push_str(" using {");
            for (i, m) in modifiers.iter().enumerate() {
                if i > 0 { script.push_str(", "); }
                let mod_key = match *m {
                    "cmd" | "command" => "command down",
                    "ctrl" | "control" => "control down",
                    "alt" | "option" => "option down",
                    "shift" => "shift down",
                    _ => *m,
                };
                script.push_str(mod_key);
            }
            script.push_str("}");
        }
        
        Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to press key: {}", e))?;
        
        Ok(format!("Pressed key combo: {}", combo))
    }

    pub fn launch_app(opts: LaunchAppOptions) -> Result<WindowInfo, String> {
        Command::new("open")
            .arg("-a")
            .arg(&opts.app_id)
            .output()
            .map_err(|e| format!("Failed to launch app: {}", e))?;
        
        Ok(WindowInfo {
            id: "unknown".to_string(),
            title: String::new(),
            app_name: opts.app_id,
            pid: 0,
            bounds: None,
        })
    }

    pub fn close_app(app_name: &str, force: bool) -> Result<(), String> {
        let cmd = if force { "killall" } else { "osascript" };
        let args = if force {
            vec![app_name.to_string()]
        } else {
            vec!["-e".to_string(), format!("tell application \"{}\" to quit", app_name)]
        };
        
        Command::new(cmd)
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to close app: {}", e))?;
        
        Ok(())
    }

    pub fn get_clipboard() -> Result<String, String> {
        let output = Command::new("pbpaste")
            .output()
            .map_err(|e| format!("Failed to get clipboard: {}", e))?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    pub fn set_clipboard(text: &str) -> Result<(), String> {
        let mut child = Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to set clipboard: {}", e))?;
        
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(text.as_bytes()).map_err(|e| format!("Failed to write to clipboard: {}", e))?;
        }
        
        child.wait().map_err(|e| format!("Failed to complete clipboard operation: {}", e))?;
        Ok(())
    }

    pub fn get_platform() -> &'static str { "macos" }
}

// ============================================================================
// Windows Platform Implementation (using uiautomation crate)
// ============================================================================

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::process::Command;

    pub fn check_permissions() -> bool {
        true
    }

    pub fn request_permissions() -> Result<bool, String> {
        Ok(true)
    }

    pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
        use uiautomation::UIAutomation;
        
        let automation = UIAutomation::new().map_err(|e| format!("Failed to initialize UIAutomation: {:?}", e))?;
        let root = automation.get_root_element().map_err(|e| format!("Failed to get root element: {:?}", e))?;
        
        let mut windows = Vec::new();
        
        if let Ok(children) = root.find_all(uiautomation::types::TreeScope::Children, &uiautomation::types::PropertyCondition::new(uiautomation::types::UIProperty::ControlType, uiautomation::types::ControlType::Window.into())) {
            for child in children {
                let name = child.get_name().unwrap_or_default();
                let class_name = child.get_class_name().unwrap_or_default();
                let process_id: i32 = child.get_process_id().unwrap_or(0);
                
                windows.push(WindowInfo {
                    id: format!("win-{}", windows.len()),
                    title: name,
                    app_name: class_name,
                    pid: process_id,
                    bounds: None,
                });
            }
        }
        
        Ok(windows)
    }

    pub fn list_apps() -> Result<Vec<AppInfo>, String> {
        let output = Command::new("powershell")
            .args(["-Command", "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object ProcessName, Id | ConvertTo-Json -Compress"])
            .output()
            .map_err(|e| format!("Failed to list apps: {}", e))?;
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let apps: Vec<AppInfo> = stdout
            .lines()
            .filter_map(|line| {
                if line.starts_with('{') {
                    let parsed: serde_json::Value = serde_json::from_str(line).ok()?;
                    Some(AppInfo {
                        name: parsed["ProcessName"].as_str()?.to_string(),
                        bundle_id: None,
                        pid: parsed["Id"].as_i64()? as i32,
                    })
                } else {
                    None
                }
            })
            .collect();
        Ok(apps)
    }

    pub fn snapshot(_opts: SnapshotOptions) -> Result<AccessibilityNode, String> {
        Err("Full snapshot requires UIAutomation tree traversal. Use agent-desktop CLI for complete functionality.".to_string())
    }

    pub fn screenshot(_opts: ScreenshotOptions) -> Result<ScreenshotResult, String> {
        let output = Command::new("powershell")
            .args(["-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds"])
            .output()
            .map_err(|e| format!("Failed to get screen info: {}", e))?;
        
        Err("Screenshot capture requires additional setup. Use agent-desktop CLI.".to_string())
    }

    pub fn click(_opts: ClickOptions) -> Result<String, String> {
        Err("Click requires element ref resolution. Use agent-desktop CLI.".to_string())
    }

    pub fn type_text(_opts: TypeOptions) -> Result<String, String> {
        Err("Type requires element ref resolution. Use agent-desktop CLI.".to_string())
    }

    pub fn press_key(combo: String) -> Result<String, String> {
        use uiautomation::UIAutomation;
        
        let parts: Vec<&str> = combo.split('+').collect();
        let key = parts.last().unwrap_or(&"");
        
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{}')",
            key.replace("{", "{{").replace("}", "}}")
        );
        
        Command::new("powershell")
            .args(["-Command", &script])
            .output()
            .map_err(|e| format!("Failed to press key: {}", e))?;
        
        Ok(format!("Pressed key combo: {}", combo))
    }

    pub fn launch_app(opts: LaunchAppOptions) -> Result<WindowInfo, String> {
        Command::new("powershell")
            .args(["-Command", &format!("Start-Process '{}'", opts.app_id)])
            .output()
            .map_err(|e| format!("Failed to launch app: {}", e))?;
        
        Ok(WindowInfo {
            id: "unknown".to_string(),
            title: String::new(),
            app_name: opts.app_id,
            pid: 0,
            bounds: None,
        })
    }

    pub fn close_app(app_name: &str, force: bool) -> Result<(), String> {
        let args = if force {
            vec!["-Command", &format!("Stop-Process -Name '{}' -Force", app_name)]
        } else {
            vec!["-Command", &format!("Stop-Process -Name '{}'", app_name)]
        };
        
        Command::new("powershell")
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to close app: {}", e))?;
        Ok(())
    }

    pub fn get_clipboard() -> Result<String, String> {
        let output = Command::new("powershell")
            .args(["-Command", "Get-Clipboard"])
            .output()
            .map_err(|e| format!("Failed to get clipboard: {}", e))?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    pub fn set_clipboard(text: &str) -> Result<(), String> {
        use std::io::Write;
        use std::process::Stdio;
        
        let mut child = Command::new("powershell")
            .args(["-Command", "[Console]::In.ReadToEnd() | Set-Clipboard"])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to set clipboard: {}", e))?;
        
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to clipboard: {}", e))?;
        }
        
        child.wait()
            .map_err(|e| format!("Failed to complete clipboard operation: {}", e))?;
        Ok(())
    }

    pub fn get_platform() -> &'static str { "windows" }
}

// ============================================================================
// Linux Platform Implementation (using atspi crate)
// ============================================================================

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::process::Command;

    pub fn check_permissions() -> bool {
        std::env::var("AT_SPI_DBUS_ADDRESS").is_ok() || 
        std::path::Path::new("/tmp/at-spi").exists()
    }

    pub fn request_permissions() -> Result<bool, String> {
        Ok(check_permissions())
    }

    pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
        let output = Command::new("wmctrl")
            .args(["-l", "-p"])
            .output()
            .map_err(|e| format!("Failed to list windows (wmctrl not installed?): {}", e))?;
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let windows: Vec<WindowInfo> = stdout
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    Some(WindowInfo {
                        id: parts.get(0)?.to_string(),
                        app_name: parts.get(2)?.to_string(),
                        pid: parts.get(1)?.parse().ok()?,
                        title: parts[3..].join(" "),
                        bounds: None,
                    })
                } else {
                    None
                }
            })
            .collect();
        Ok(windows)
    }

    pub fn list_apps() -> Result<Vec<AppInfo>, String> {
        let output = Command::new("ps")
            .args(["-e", "-o", "comm=,pid="])
            .output()
            .map_err(|e| format!("Failed to list apps: {}", e))?;
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let apps: Vec<AppInfo> = stdout
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.trim().split_whitespace().collect();
                Some(AppInfo {
                    name: parts.get(0)?.to_string(),
                    bundle_id: None,
                    pid: parts.get(1)?.parse().ok()?,
                })
            })
            .collect();
        Ok(apps)
    }

    pub fn snapshot(_opts: SnapshotOptions) -> Result<AccessibilityNode, String> {
        Err("Full snapshot requires AT-SPI tree traversal. Use agent-desktop CLI for complete functionality.".to_string())
    }

    pub fn screenshot(_opts: ScreenshotOptions) -> Result<ScreenshotResult, String> {
        let output = Command::new("import")
            .args(["-window", "root", "-format", "png", "png:-"])
            .output()
            .map_err(|e| format!("Failed to capture screenshot (imagemagick not installed?): {}", e))?;
        
        if output.status.success() {
            let data = output.stdout;
            Ok(ScreenshotResult {
                width: 0,
                height: 0,
                image_base64: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data),
                format: "png".to_string(),
            })
        } else {
            Err("Failed to capture screenshot".to_string())
        }
    }

    pub fn click(_opts: ClickOptions) -> Result<String, String> {
        Err("Click requires AT-SPI element ref resolution. Use agent-desktop CLI.".to_string())
    }

    pub fn type_text(_opts: TypeOptions) -> Result<String, String> {
        Err("Type requires AT-SPI element ref resolution. Use agent-desktop CLI.".to_string())
    }

    pub fn press_key(combo: String) -> Result<String, String> {
        let parts: Vec<&str> = combo.split('+').collect();
        let key = parts.last().unwrap_or(&"");
        
        let xdotool_key = match *key {
            "cmd" | "super" => "Super",
            "ctrl" => "Ctrl",
            "alt" => "Alt",
            "shift" => "Shift",
            "enter" => "Return",
            "escape" => "Escape",
            "tab" => "Tab",
            k => k,
        };
        
        let full_combo = if parts.len() > 1 {
            format!("{}+{}", parts[..parts.len()-1].join("+"), xdotool_key)
        } else {
            xdotool_key.to_string()
        };
        
        Command::new("xdotool")
            .args(["key", &full_combo])
            .output()
            .map_err(|e| format!("Failed to press key (xdotool not installed?): {}", e))?;
        
        Ok(format!("Pressed key combo: {}", combo))
    }

    pub fn launch_app(opts: LaunchAppOptions) -> Result<WindowInfo, String> {
        Command::new(&opts.app_id)
            .spawn()
            .map_err(|e| format!("Failed to launch app: {}", e))?;
        
        Ok(WindowInfo {
            id: "unknown".to_string(),
            title: String::new(),
            app_name: opts.app_id,
            pid: 0,
            bounds: None,
        })
    }

    pub fn close_app(app_name: &str, force: bool) -> Result<(), String> {
        let args = if force {
            vec!["-9", app_name]
        } else {
            vec![app_name]
        };
        
        Command::new("killall")
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to close app: {}", e))?;
        Ok(())
    }

    pub fn get_clipboard() -> Result<String, String> {
        let output = Command::new("xclip")
            .args(["-selection", "clipboard", "-o"])
            .output()
            .map_err(|e| format!("Failed to get clipboard (xclip not installed?): {}", e))?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    pub fn set_clipboard(text: &str) -> Result<(), String> {
        let mut child = Command::new("xclip")
            .args(["-selection", "clipboard"])
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to set clipboard: {}", e))?;
        
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(text.as_bytes()).map_err(|e| format!("Failed to write to clipboard: {}", e))?;
        }
        
        child.wait().map_err(|e| format!("Failed to complete clipboard operation: {}", e))?;
        Ok(())
    }

    pub fn get_platform() -> &'static str { "linux" }
}

// ============================================================================
// Tauri Command Handlers
// ============================================================================

#[tauri::command]
pub async fn desktop_automation_status() -> DesktopAutomationResult<DesktopAutomationStatus> {
    let status = DesktopAutomationStatus {
        platform: platform::get_platform().to_string(),
        permission_granted: platform::check_permissions(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    };
    wrap_result("status", Ok(status))
}

#[tauri::command]
pub async fn desktop_automation_request_permissions() -> DesktopAutomationResult<bool> {
    wrap_result("request_permissions", platform::request_permissions())
}

#[tauri::command]
pub async fn desktop_automation_list_windows() -> DesktopAutomationResult<Vec<WindowInfo>> {
    wrap_result("list_windows", platform::list_windows())
}

#[tauri::command]
pub async fn desktop_automation_list_apps() -> DesktopAutomationResult<Vec<AppInfo>> {
    wrap_result("list_apps", platform::list_apps())
}

#[tauri::command]
pub async fn desktop_automation_snapshot(opts: SnapshotOptions) -> DesktopAutomationResult<AccessibilityNode> {
    wrap_result("snapshot", platform::snapshot(opts))
}

#[tauri::command]
pub async fn desktop_automation_screenshot(opts: ScreenshotOptions) -> DesktopAutomationResult<ScreenshotResult> {
    wrap_result("screenshot", platform::screenshot(opts))
}

#[tauri::command]
pub async fn desktop_automation_click(opts: ClickOptions) -> DesktopAutomationResult<String> {
    wrap_result("click", platform::click(opts))
}

#[tauri::command]
pub async fn desktop_automation_type(opts: TypeOptions) -> DesktopAutomationResult<String> {
    wrap_result("type", platform::type_text(opts))
}

#[tauri::command]
pub async fn desktop_automation_press_key(combo: String) -> DesktopAutomationResult<String> {
    wrap_result("press_key", platform::press_key(combo))
}

#[tauri::command]
pub async fn desktop_automation_launch_app(opts: LaunchAppOptions) -> DesktopAutomationResult<WindowInfo> {
    wrap_result("launch_app", platform::launch_app(opts))
}

#[tauri::command]
pub async fn desktop_automation_close_app(app_name: String, force: bool) -> DesktopAutomationResult<()> {
    wrap_result("close_app", platform::close_app(&app_name, force).map(|_| ()))
}

#[tauri::command]
pub async fn desktop_automation_get_clipboard() -> DesktopAutomationResult<String> {
    wrap_result("get_clipboard", platform::get_clipboard())
}

#[tauri::command]
pub async fn desktop_automation_set_clipboard(text: String) -> DesktopAutomationResult<()> {
    wrap_result("set_clipboard", platform::set_clipboard(&text).map(|_| ()))
}

#[tauri::command]
pub async fn desktop_automation_focus_window(_window_id: String) -> DesktopAutomationResult<()> {
    wrap_result("focus_window", Err("Not yet implemented. Use agent-desktop CLI.".to_string()))
}

#[tauri::command]
pub async fn desktop_automation_resize_window(_opts: WindowOpOptions) -> DesktopAutomationResult<()> {
    wrap_result("resize_window", Err("Not yet implemented. Use agent-desktop CLI.".to_string()))
}

#[tauri::command]
pub async fn desktop_automation_move_window(_opts: WindowOpOptions) -> DesktopAutomationResult<()> {
    wrap_result("move_window", Err("Not yet implemented. Use agent-desktop CLI.".to_string()))
}

#[tauri::command]
pub async fn desktop_automation_find(_opts: FindOptions) -> DesktopAutomationResult<Vec<AccessibilityNode>> {
    wrap_result("find", Err("Not yet implemented. Use agent-desktop CLI.".to_string()))
}

#[tauri::command]
pub async fn desktop_automation_wait(_opts: WaitOptions) -> DesktopAutomationResult<()> {
    wrap_result("wait", Err("Not yet implemented. Use agent-desktop CLI.".to_string()))
}

#[tauri::command]
pub async fn desktop_automation_hover(_x: f64, _y: f64) -> DesktopAutomationResult<()> {
    wrap_result("hover", Err("Not yet implemented. Use agent-desktop CLI.".to_string()))
}

#[tauri::command]
pub async fn desktop_automation_drag(_opts: DragOptions) -> DesktopAutomationResult<()> {
    wrap_result("drag", Err("Not yet implemented. Use agent-desktop CLI.".to_string()))
}

#[tauri::command]
pub async fn desktop_automation_scroll(_opts: ScrollOptions) -> DesktopAutomationResult<()> {
    wrap_result("scroll", Err("Not yet implemented. Use agent-desktop CLI.".to_string()))
}
