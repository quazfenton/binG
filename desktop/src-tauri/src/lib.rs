mod commands;
use commands::{PtySessions, CheckpointManager};
use serde::Serialize;
use std::process::{Child, Command};
use std::path::PathBuf;
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Register all Tauri command handlers.
/// Separated from main builder for better maintainability as the command list grows.
fn register_invoke_handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // Generic API route dispatcher (maps API paths to Tauri commands)
        commands::handle_api_route,
        // File operations
        commands::read_file,
        commands::write_file,
        commands::list_directory,
        commands::execute_command,
        commands::get_system_info,
        // PTY terminal operations
        commands::create_pty_session,
        commands::write_pty_input,
        commands::resize_pty,
        commands::close_pty_session,
        // Checkpoint operations
        commands::create_checkpoint,
        commands::restore_checkpoint,
        commands::list_checkpoints,
        commands::delete_checkpoint,
    ]
}

/// Generate a random auth token for the sidecar
fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    format!("ocdk_{:x}_{:x}", ts, std::process::id())
}

/// Find the Next.js web directory containing a .next build output.
/// Searches common locations in order:
/// 1. Bundled resources directory
/// 2. User's project directory (relative to home)
/// 3. Development fallback (relative to CARGO_MANIFEST_DIR)
fn find_web_dir(resource_dir: Option<&PathBuf>) -> Option<PathBuf> {
    // 1. Check bundled resources
    if let Some(ref res_dir) = resource_dir {
        let bundled = res_dir.join("web");
        if bundled.join(".next").exists() && bundled.join("package.json").exists() {
            eprintln!("[NextServer] Found bundled web dir: {:?}", bundled);
            return Some(bundled);
        }
    }

    // 2. Search user's project directories
    if let Some(home) = dirs::home_dir() {
        let candidates = [
            home.join("Downloads").join("binG").join("web"),
            home.join("Documents").join("binG").join("web"),
            home.join("Projects").join("binG").join("web"),
            home.join("src").join("binG").join("web"),
            home.join("code").join("binG").join("web"),
            home.join("dev").join("binG").join("web"),
            home.join("workspace").join("binG").join("web"),
        ];
        for candidate in &candidates {
            if candidate.join(".next").exists() && candidate.join("package.json").exists() {
                eprintln!("[NextServer] Found project web dir: {:?}", candidate);
                return Some(candidate.clone());
            }
        }
    }

    // 3. Development fallback
    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("web");
    if dev_dir.join(".next").exists() {
        eprintln!("[NextServer] Found dev web dir: {:?}", dev_dir);
        return Some(dev_dir);
    }

    None
}

/// Find an available port starting from a base port.
fn find_available_port(start: u16) -> u16 {
    for port in start..start + 100 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    panic!("No available port found");
}

/// Spawn the Next.js server as a sidecar process.
/// Uses bundled resources in production, source tree in development.
fn spawn_next_server(port: u16, token: &str, resource_dir: Option<PathBuf>) -> Result<Child, String> {
    let web_dir = find_web_dir(resource_dir.as_ref())
        .ok_or("Could not find Next.js web directory with .next build. Run `pnpm build` in the web/ folder.")?;

    eprintln!("[NextServer] Starting Next.js server on port {}", port);
    eprintln!("[NextServer] Working directory: {:?}", web_dir.display());

    // Use `npx next start` to serve the .next build output
    let mut cmd = Command::new(if cfg!(windows) { "cmd" } else { "sh" });
    if cfg!(windows) {
        cmd.args(["/C", "npx", "next", "start", "-p", &port.to_string()]);
    } else {
        cmd.args(["-c", &format!("npx next start -p {}", port)]);
    }
    cmd.env("NODE_ENV", "production")
        .env("DESKTOP_MODE", "true")
        .env("DESKTOP_LOCAL_EXECUTION", "true")
        .env("OPENCODE_SIDECAR_TOKEN", token)
        .current_dir(&web_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    eprintln!("[NextServer] Running: npx next start -p {}", port);
    cmd.spawn().map_err(|e| format!("Failed to start Next.js server: {}", e))
}

/// Wait for the Next.js server to be ready.
fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if reqwest::blocking::get(&format!("http://127.0.0.1:{}/", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

/// Sidecar configuration passed to the webview via window.__OPENCODE_SIDECAR__
#[derive(Clone, Serialize)]
pub struct SidecarConfig {
    pub port: u16,
    pub token: String,
}

/// Kill any lingering Next.js processes on the sidecar port.
/// This handles the case where the app was force-closed and the sidecar survived.
fn kill_stale_processes(port: u16) {
    // Check if something is already listening on our port
    if TcpListener::bind(("127.0.0.1", port)).is_err() {
        eprintln!("[NextServer] Port {} is occupied — killing stale processes", port);
        // On Windows, use netstat + taskkill to find and kill the process
        if cfg!(windows) {
            let output = Command::new("cmd")
                .args(["/C", &format!("for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a 2>nul", port)])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
            if let Ok(mut proc) = output {
                let _ = proc.wait();
            }
            thread::sleep(Duration::from_millis(500)); // Give OS time to free the port
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Generate a unique auth token for this session
    let auth_token = generate_token();

    // Find an available port for the Next.js server
    let port = find_available_port(3000);

    // Kill any lingering sidecar processes on this port
    kill_stale_processes(port);

    // Wrap the sidecar child process so it gets killed on drop
    let sidecar_child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let sidecar_child_clone = sidecar_child.clone();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_mcp_bridge::init())
        .manage(PtySessions::default())
        .manage(CheckpointManager::default())
        .invoke_handler(register_invoke_handler())
        .setup(move |app| {
            // Try to spawn the Next.js sidecar for SIDECAR_ROUTES (chat, agent, LLM, etc.)
            // TAURI_ROUTES (filesystem, health, providers) work without the sidecar
            let resource_dir = app.path().resource_dir().ok();
            let sidecar_ok = spawn_sidecar_with_fallback(port, &auth_token, resource_dir, sidecar_child_clone);

            // Inject sidecar config into the webview so the JS adapter knows
            // how to reach the secured sidecar
            let sidecar_json = serde_json::to_string(&SidecarConfig {
                port,
                token: auth_token.clone(),
            }).unwrap();
            let init_script = format!(
                "window.__OPENCODE_SIDECAR__ = {};",
                sidecar_json
            );

            // Create the main window
            let url = if sidecar_ok {
                // Sidecar is running — point to it for full API support
                format!("http://127.0.0.1:{}", port)
            } else {
                // Sidecar failed — serve static assets from Tauri
                // TAURI_ROUTES will work, SIDECAR_ROUTES will fail gracefully
                eprintln!("[NextServer] Sidecar unavailable — serving static assets only");
                "index.html".to_string()
            };

            let builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                if url.starts_with("http") {
                    tauri::WebviewUrl::External(url.parse().unwrap())
                } else {
                    tauri::WebviewUrl::App(url.parse().unwrap())
                },
            )
            .title("OpenCode Desktop")
            .inner_size(1400.0, 900.0)
            .resizable(true)
            .initialization_script(&init_script);

            builder.build()?;

            Ok(())
        })
        .run(tauri::generate_context!());

    // Ensure sidecar is killed if run() returns (safety net)
    if let Some(mut child) = sidecar_child.lock().unwrap().take() {
        eprintln!("[NextServer] App exiting — killing sidecar");
        let _ = child.kill();
        let _ = child.wait();
    }

    if let Err(e) = result {
        eprintln!("Failed to run tauri application: {}", e);
        std::process::exit(1);
    }
}

/// Spawn the sidecar with fallback behavior.
/// Returns true if sidecar started, false if it failed (app continues with static assets only).
/// Stores the child process in `sidecar_child` so it can be killed on exit.
fn spawn_sidecar_with_fallback(
    port: u16,
    token: &str,
    resource_dir: Option<PathBuf>,
    sidecar_child: Arc<Mutex<Option<Child>>>,
) -> bool {
    // Try to spawn Next.js server
    let child = match spawn_next_server(port, token, resource_dir) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[NextServer] {}", e);
            return false;
        }
    };

    // Store the child process for later cleanup
    *sidecar_child.lock().unwrap() = Some(child);

    // Wait for the server to be ready (up to 30 seconds)
    eprintln!("[NextServer] Waiting for Next.js server to be ready on port {}...", port);
    let ready = wait_for_server(port, Duration::from_secs(30));

    if !ready {
        eprintln!("[NextServer] Next.js server failed to start within 30 seconds");
        if let Some(mut child) = sidecar_child.lock().unwrap().take() {
            if let Ok(Some(status)) = child.try_wait() {
                eprintln!("[NextServer] Process exited with status: {}", status);
            }
            let _ = child.kill();
        }
        return false;
    }

    eprintln!("[NextServer] Next.js server is ready at http://127.0.0.1:{}", port);
    true
}
