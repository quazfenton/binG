mod commands;
use commands::{PtySessions, CheckpointManager};
use serde::Serialize;
use std::process::{Child, Command};
use std::path::PathBuf;
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

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
fn spawn_next_server(port: u16, token: &str) -> Child {
    // Use the .next build output directory
    let next_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("web");

    eprintln!("[NextServer] Starting Next.js server on port {}", port);
    eprintln!("[NextServer] Working directory: {:?}", next_dir.display());

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
        .current_dir(&next_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    eprintln!("[NextServer] Running: npx next start -p {}", port);
    cmd.spawn().expect("Failed to start Next.js server")
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

/// State to hold the Next.js server process so we can clean it up on exit.
pub struct NextServerHandle {
    pub child: std::sync::Mutex<Option<Child>>,
}

impl Drop for NextServerHandle {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            eprintln!("[NextServer] Shutting down Next.js server...");
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Sidecar configuration passed to the webview via window.__OPENCODE_SIDECAR__
#[derive(Clone, Serialize)]
pub struct SidecarConfig {
    pub port: u16,
    pub token: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Generate a unique auth token for this session
    let auth_token = generate_token();

    // Find an available port for the Next.js server
    let port = find_available_port(3000);

    // Spawn the Next.js server as a sidecar process
    let mut child = spawn_next_server(port, &auth_token);

    // Wait for the server to be ready (up to 30 seconds)
    eprintln!("[NextServer] Waiting for Next.js server to be ready on port {}...", port);
    let ready = wait_for_server(port, Duration::from_secs(30));

    if !ready {
        eprintln!("[NextServer] ERROR: Next.js server failed to start within 30 seconds");
        if let Ok(Some(status)) = child.try_wait() {
            eprintln!("[NextServer] Process exited with status: {}", status);
        }
        std::process::exit(1);
    }

    eprintln!("[NextServer] Next.js server is ready at http://127.0.0.1:{}", port);

    let server_handle = NextServerHandle {
        child: std::sync::Mutex::new(Some(child)),
    };

    let sidecar_config = SidecarConfig {
        port,
        token: auth_token.clone(),
    };

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(PtySessions::default())
        .manage(CheckpointManager::default())
        .manage(server_handle)
        .invoke_handler(register_invoke_handler())
        .setup(move |app| {
            // Inject sidecar config into the webview so the JS adapter knows
            // how to reach the secured sidecar
            let sidecar_json = serde_json::to_string(&sidecar_config).unwrap();
            let init_script = format!(
                "window.__OPENCODE_SIDECAR__ = {};",
                sidecar_json
            );

            // Create the main window pointing to the Next.js server
            let url = format!("http://127.0.0.1:{}", port);
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().unwrap()),
            )
            .title("OpenCode Desktop")
            .inner_size(1400.0, 900.0)
            .resizable(true)
            .initialization_script(&init_script)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        eprintln!("Failed to run tauri application: {}", e);
        std::process::exit(1);
    }
}
