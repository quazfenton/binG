mod commands;
use commands::{PtySessions, CheckpointManager};
use serde::Serialize;
use std::process::{Child, Command};
use std::path::PathBuf;
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use std::fs::OpenOptions;
use std::io::Write;
use tauri::Manager;

/// Initialize file-based logging for debugging.
/// Writes to %TEMP%\quaz-desktop.log (Windows) or /tmp/quaz-desktop.log (Unix).
fn init_logging() -> Option<PathBuf> {
    let log_path = if cfg!(windows) {
        if let Some(temp) = std::env::var_os("TEMP").or_else(|| std::env::var_os("TMP")) {
            PathBuf::from(temp).join("quaz-desktop.log")
        } else {
            return None;
        }
    } else {
        PathBuf::from("/tmp/quaz-desktop.log")
    };

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let _ = writeln!(file, "\n=== Quaz Desktop starting (timestamp: {}) ===", ts);
        Some(log_path)
    } else {
        None
    }
}

/// Write a message to the log file.
fn log_msg(msg: &str) {
    if let Some(temp) = std::env::var_os("TEMP").or_else(|| std::env::var_os("TMP")) {
        let log_path = PathBuf::from(temp).join("quaz-desktop.log");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
            let _ = writeln!(file, "[{}] {}", chrono::Local::now().format("%H:%M:%S%.3f"), msg);
        }
    }
    // Also write to stderr for console debugging
    eprintln!("{}", msg);
}

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
    log_msg("[find_web_dir] === SEARCH STARTING ===");
    
    // 1. Check bundled resources
    if let Some(ref res_dir) = resource_dir {
        for bundled in [res_dir.join("web"), res_dir.join("web-assets")] {
            let has_next = bundled.join(".next").exists();
            let has_pkg = bundled.join("package.json").exists();
            let has_standalone = bundled.join("server.js").exists();
            log_msg(&format!("[find_web_dir] Checking bundled: {:?} (.next={}, pkg.json={}, server.js={})", bundled, has_next, has_pkg, has_standalone));
            if has_standalone || (has_next && has_pkg) {
                log_msg("[find_web_dir] ✓ Found bundled web dir");
                return Some(bundled);
            }
            if !has_next {
                log_msg(&format!("[find_web_dir] ✗ No .next in {:?}", bundled));
            }
            if !has_pkg && !has_standalone {
                log_msg(&format!("[find_web_dir] ✗ No package.json in {:?}", bundled));
            }
        }
    } else {
        log_msg("[find_web_dir] No resource_dir provided");
    }

    // 2. Search user's project directories
    let home = match dirs::home_dir() {
        Some(h) => {
            log_msg(&format!("[find_web_dir] Home dir: {:?}", h));
            h
        }
        None => {
            log_msg("[find_web_dir] ✗ Could not determine home directory");
            return None;
        }
    };

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
        let has_next = candidate.join(".next").exists();
        let has_pkg = candidate.join("package.json").exists();
        let has_standalone = candidate.join("server.js").exists();
        log_msg(&format!("[find_web_dir] Checking {:?} (.next={}, pkg.json={}, server.js={})", candidate, has_next, has_pkg, has_standalone));
        if has_standalone || (has_next && has_pkg) {
            log_msg(&format!("[find_web_dir] ✓ Found project web dir"));
            return Some(candidate.clone());
        }
    }

    // 3. Development fallback
    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("web");
    let has_next = dev_dir.join(".next").exists();
    let has_pkg = dev_dir.join("package.json").exists();
    let has_standalone = dev_dir.join("server.js").exists();
    log_msg(&format!("[find_web_dir] Checking dev dir: {:?} (.next={}, pkg.json={}, server.js={})", dev_dir, has_next, has_pkg, has_standalone));
    if has_standalone || (has_next && has_pkg) {
        log_msg(&format!("[find_web_dir] ✓ Found dev web dir"));
        return Some(dev_dir);
    }

    log_msg("[find_web_dir] ✗ No web directory found anywhere");
    log_msg("[find_web_dir] === SEARCH ENDING (FAILED) ===");
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
    log_msg("[spawn_next] === SPAWN NEXT SERVER ===");
    
    let web_dir = find_web_dir(resource_dir.as_ref())
        .ok_or("Could not find Next.js web directory with .next build. Run `pnpm build` in the web/ folder.")?;

    log_msg(&format!("[spawn_next] Web dir: {:?}", web_dir.display()));

    let standalone_server_path = web_dir.join("server.js");
    if standalone_server_path.exists() {
        log_msg(&format!("[spawn_next] Found standalone server at {:?}", standalone_server_path));
        let mut standalone_cmd: Command = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", "node", "server.js"]);
            c
        } else {
            let mut c = Command::new("node");
            c.arg("server.js");
            c
        };

        standalone_cmd
            .env("NODE_ENV", "production")
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("DESKTOP_MODE", "true")
            .env("DESKTOP_LOCAL_EXECUTION", "true")
            .env("OPENCODE_SIDECAR_TOKEN", token)
            .current_dir(&web_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        log_msg(&format!("[spawn_next] Spawning standalone Next server on port {} in {:?}", port, web_dir));
        return standalone_cmd
            .spawn()
            .map(|child| {
                log_msg(&format!("[spawn_next] ✓ Standalone process spawned, PID: {}", child.id()));
                child
            })
            .map_err(|e| {
                let err_msg = format!("Failed to spawn standalone Next.js server: {}", e);
                log_msg(&format!("[spawn_next] ✗ {}", err_msg));
                err_msg
            });
    }

    // Verify .next exists
    if !web_dir.join(".next").exists() {
        return Err(format!("No .next build found in {:?}", web_dir));
    }
    log_msg("[spawn_next] ✓ .next directory confirmed");

    // Check if a valid production build exists (BUILD_ID file)
    let build_id_path = web_dir.join(".next").join("BUILD_ID");
    if !build_id_path.exists() {
        log_msg("[spawn_next] No BUILD_ID found — running pnpm build first...");
        // Auto-build the production output
        let build_result = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", "pnpm", "build"]);
            c.env("NODE_ENV", "production")
                .current_dir(&web_dir)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .and_then(|mut child| child.wait())
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", "pnpm build"]);
            c.env("NODE_ENV", "production")
                .current_dir(&web_dir)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .and_then(|mut child| child.wait())
        };

        match build_result {
            Ok(status) if status.success() => {
                log_msg("[spawn_next] ✓ pnpm build completed successfully");
            }
            Ok(status) => {
                return Err(format!("pnpm build failed with exit code: {}", status));
            }
            Err(e) => {
                return Err(format!("Failed to run pnpm build: {}", e));
            }
        }
    } else {
        log_msg(&format!("[spawn_next] ✓ BUILD_ID exists at {:?}", build_id_path));
    }

    // On Windows, npx is npx.cmd (batch file) which cannot be spawned directly.
    // We MUST use cmd /C to run it. On Unix, we prefer the full path via `which`.
    let mut cmd: Command = if cfg!(windows) {
        // Find npx.cmd via where.exe for the full path
        let npx_cmd = Command::new("where")
            .arg("npx")
            .stdout(std::process::Stdio::piped())
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok());

        if let Some(output) = npx_cmd {
            let npx_path = output.lines().next().unwrap_or("").trim().to_string();
            if !npx_path.is_empty() {
                log_msg(&format!("[spawn_next] Found npx at: {}", npx_path));
                let mut c = Command::new("cmd");
                c.args(["/C", &npx_path, "next", "start", "-p", &port.to_string()]);
                c
            } else {
                log_msg("[spawn_next] where.exe returned empty, falling back to bare npx");
                let mut c = Command::new("cmd");
                c.args(["/C", "npx", "next", "start", "-p", &port.to_string()]);
                c
            }
        } else {
            log_msg("[spawn_next] where.exe failed, falling back to bare npx");
            let mut c = Command::new("cmd");
            c.args(["/C", "npx", "next", "start", "-p", &port.to_string()]);
            c
        }
    } else {
        // Unix: find full path to npx via `which`, then spawn it directly
        let npx_path = Command::new("which")
            .arg("npx")
            .stdout(std::process::Stdio::piped())
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string());

        if let Some(path) = npx_path.filter(|p| !p.is_empty()) {
            log_msg(&format!("[spawn_next] Found npx at: {}", path));
            let mut c = Command::new(&path);
            c.args(["next", "start", "-p", &port.to_string()]);
            c
        } else {
            log_msg("[spawn_next] which npx failed, falling back to bare npx");
            let mut c = Command::new("npx");
            c.args(["next", "start", "-p", &port.to_string()]);
            c
        }
    };

    cmd.env("NODE_ENV", "production")
        .env("DESKTOP_MODE", "true")
        .env("DESKTOP_LOCAL_EXECUTION", "true")
        .env("OPENCODE_SIDECAR_TOKEN", token)
        .current_dir(&web_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    log_msg(&format!("[spawn_next] Spawning next start on port {} in {:?}", port, web_dir));
    match cmd.spawn() {
        Ok(child) => {
            log_msg(&format!("[spawn_next] ✓ Process spawned, PID: {}", child.id()));
            Ok(child)
        }
        Err(e) => {
            let err_msg = format!("Failed to spawn Next.js server: {}", e);
            log_msg(&format!("[spawn_next] ✗ {}", err_msg));
            Err(err_msg)
        }
    }
}

/// Wait for the Next.js server to be ready.
fn wait_for_server(port: u16, timeout: Duration) -> bool {
    log_msg(&format!("[wait_for_server] Waiting on port {} for up to {}s", port, timeout.as_secs()));
    let start = Instant::now();
    let mut attempts = 0;
    while start.elapsed() < timeout {
        attempts += 1;
        let url = format!("http://127.0.0.1:{}/", port);
        match reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .and_then(|c| c.get(&url).send())
        {
            Ok(resp) => {
                log_msg(&format!("[wait_for_server] ✓ Server ready after {}ms (HTTP {}, attempt {})", start.elapsed().as_millis(), resp.status(), attempts));
                return true;
            }
            Err(e) => {
                if attempts <= 3 || attempts % 10 == 0 {
                    log_msg(&format!("[wait_for_server] Attempt {}: {} (elapsed: {}ms)", attempts, e, start.elapsed().as_millis()));
                }
                thread::sleep(Duration::from_millis(500));
            }
        }
    }
    log_msg(&format!("[wait_for_server] ✗ Server not ready after {}ms ({} attempts)", start.elapsed().as_millis(), attempts));
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
    log_msg(&format!("[kill_stale] Checking port {}", port));
    // Check if something is already listening on our port
    if TcpListener::bind(("127.0.0.1", port)).is_err() {
        log_msg(&format!("[kill_stale] Port {} is occupied — killing stale processes", port));
        // On Windows, use netstat + taskkill to find and kill the process
        if cfg!(windows) {
            let output = Command::new("cmd")
                .args(["/C", &format!("for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a 2>nul", port)])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
            if let Ok(mut proc) = output {
                let _ = proc.wait();
                log_msg("[kill_stale] taskkill completed");
            }
            thread::sleep(Duration::from_millis(500)); // Give OS time to free the port
        }
    } else {
        log_msg(&format!("[kill_stale] Port {} is free", port));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize file logging
    let log_path = init_logging();
    if let Some(ref lp) = log_path {
        log_msg(&format!("Log file: {:?}", lp));
    }
    log_msg("Application starting");

    // Generate a unique auth token for this session
    let auth_token = generate_token();
    log_msg(&format!("Auth token generated"));

    // Find an available port for the Next.js server
    let port = find_available_port(3000);
    log_msg(&format!("Using port {}", port));

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
            log_msg("Setup phase starting");

            // Try to spawn the Next.js sidecar for SIDECAR_ROUTES (chat, agent, LLM, etc.)
            // TAURI_ROUTES (filesystem, health, providers) work without the sidecar
            let resource_dir = app.path().resource_dir().ok();
            if let Some(ref rd) = resource_dir {
                log_msg(&format!("Resource dir: {:?}", rd));
            } else {
                log_msg("No resource dir found");
            }

            let sidecar_ok = spawn_sidecar_with_fallback(port, &auth_token, resource_dir, sidecar_child_clone);
            log_msg(&format!("Sidecar spawn result: {}", sidecar_ok));

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
                log_msg(&format!("Pointing webview to sidecar at http://127.0.0.1:{}", port));
                format!("http://127.0.0.1:{}", port)
            } else {
                // Sidecar failed — serve static assets from Tauri
                // TAURI_ROUTES will work, SIDECAR_ROUTES will fail gracefully
                log_msg("Sidecar unavailable — serving static setup page");
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
        log_msg("App exiting — killing sidecar");
        let _ = child.kill();
        let _ = child.wait();
    }

    if let Err(e) = result {
        log_msg(&format!("Failed to run tauri application: {}", e));
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
    log_msg("[spawn_sidecar] === SPAWN ATTEMPT STARTING ===");
    log_msg(&format!("[spawn_sidecar] Port: {}, resource_dir: {:?}", port, resource_dir));
    
    // Try to spawn Next.js server
    let child = match spawn_next_server(port, token, resource_dir) {
        Ok(c) => {
            log_msg("[spawn_sidecar] ✓ spawn_next_server returned Ok");
            c
        }
        Err(e) => {
            log_msg(&format!("[spawn_sidecar] ✗ spawn_next_server returned Err: {}", e));
            return false;
        }
    };

    // Store the child process for later cleanup
    *sidecar_child.lock().unwrap() = Some(child);
    log_msg("[spawn_sidecar] Child process stored in sidecar_child");

    // Read stderr in a separate thread so the pipe buffer doesn't fill up and block the process
    let child_ref = sidecar_child.clone();
    let _stderr_thread = thread::spawn(move || {
        if let Some(child) = child_ref.lock().unwrap().as_mut() {
            if let Some(stderr) = child.stderr.take() {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(l) => log_msg(&format!("[NextServer::stderr] {}", l)),
                        Err(e) => {
                            log_msg(&format!("[NextServer::stderr] Read error: {}", e));
                            break;
                        }
                    }
                }
                log_msg("[NextServer::stderr] Stream ended");
            }
        }
    });

    // Wait for the server to be ready (up to 90 seconds — Next.js cold start is slow)
    log_msg(&format!("[spawn_sidecar] Waiting for server on port {} (timeout: 90s)...", port));
    let ready = wait_for_server(port, Duration::from_secs(90));

    if !ready {
        log_msg("[spawn_sidecar] Server not ready after 90s — checking if process is still alive");
        // Don't kill the process yet — it might still be compiling.
        // The setup page will poll and find it when it's ready.
        let mut child_guard = sidecar_child.lock().unwrap();
        if let Some(ref mut c) = *child_guard {
            match c.try_wait() {
                Ok(Some(status)) => {
                    log_msg(&format!("[spawn_sidecar] Process already exited with status: {}", status));
                    return false;
                }
                Ok(None) => {
                    // Process is still running! Keep it alive.
                    log_msg("[spawn_sidecar] Process is still running — keeping it alive for setup page to poll");
                    return false; // Return false so setup page shows, but process stays alive
                }
                Err(e) => {
                    log_msg(&format!("[spawn_sidecar] Error checking process status: {}", e));
                    return false;
                }
            }
        }
        return false;
    }

    log_msg(&format!("[spawn_sidecar] ✓ Server ready at http://127.0.0.1:{}", port));
    
    // Pre-warm: hit the main page so the first user visit are fast
    log_msg("[spawn_sidecar] Pre-warming Next.js routes...");
    let warmup_urls = [
        format!("http://127.0.0.1:{}/", port),
        format!("http://127.0.0.1:{}/settings", port),
        format!("http://127.0.0.1:{}/api/health", port),
    ];
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok();
    if let Some(ref c) = client {
        for url in &warmup_urls {
            match c.get(url).send() {
                Ok(resp) => log_msg(&format!("[spawn_sidecar] Warmed {}: HTTP {}", url, resp.status())),
                Err(e) => log_msg(&format!("[spawn_sidecar] Warm-up failed for {}: {}", url, e)),
            }
        }
    }
    log_msg("[spawn_sidecar] Pre-warming complete");
    
    true
}
