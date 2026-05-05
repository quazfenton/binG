mod commands;
mod desktop_automation;
mod log;
mod settings;
use commands::{PtySessions, CheckpointManager, WatcherRegistry};
use serde::Serialize;
use std::process::{Child, Command};
use std::path::PathBuf;
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Manager;

#[tauri::command]
fn get_sidecar_config(state: tauri::State<'_, SidecarConfigState>) -> Result<SidecarConfig, String> {
    let config = state.0.lock().unwrap();
    config.clone().ok_or_else(|| "Sidecar config not initialized".to_string())
}

struct SidecarConfigState(Arc<Mutex<Option<SidecarConfig>>>);

/// Register all Tauri command handlers.
/// Separated from main builder for better maintainability as the command list grows.
fn register_invoke_handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // Generic API route dispatcher (maps API paths to Tauri commands)
        commands::handle_api_route,
        get_sidecar_config,
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
        // File system watcher
        commands::start_file_watcher,
        commands::stop_file_watcher,
        // Undo operations (handled by LocalVFSManager git history in CLI/Desktop)
        // MCP sidecar connection
        commands::get_mcp_sidecar_config,
        commands::start_mcp_sidecar_bridge,
        // Settings persistence
        commands::save_settings,
        commands::load_settings,
        // Workspace management
        commands::set_workspace_root,
        commands::open_directory_dialog,
        // Desktop automation (agent-desktop integration)
        desktop_automation::desktop_automation_status,
        desktop_automation::desktop_automation_request_permissions,
        desktop_automation::desktop_automation_list_windows,
        desktop_automation::desktop_automation_list_apps,
        desktop_automation::desktop_automation_snapshot,
        desktop_automation::desktop_automation_screenshot,
        desktop_automation::desktop_automation_click,
        desktop_automation::desktop_automation_type,
        desktop_automation::desktop_automation_press_key,
        desktop_automation::desktop_automation_launch_app,
        desktop_automation::desktop_automation_close_app,
        desktop_automation::desktop_automation_get_clipboard,
        desktop_automation::desktop_automation_set_clipboard,
        desktop_automation::desktop_automation_focus_window,
        desktop_automation::desktop_automation_resize_window,
        desktop_automation::desktop_automation_move_window,
        desktop_automation::desktop_automation_find,
        desktop_automation::desktop_automation_wait,
        desktop_automation::desktop_automation_hover,
        desktop_automation::desktop_automation_drag,
        desktop_automation::desktop_automation_scroll,
    ]
}

/// Generate a random auth token for the sidecar
fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW - prevents console window flicker
    }
}

/// Generate a random auth token for the sidecar
fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    format!("ocdk_{:x}_{:x}", ts, std::process::id())
}

/// Find the absolute path to node.exe on Windows to prevent terminal flicker
fn find_node_executable() -> String {
    #[cfg(windows)]
    {
        let output = Command::new("cmd")
            .args(["/C", "where node"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output();
        if let Ok(out) = output {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Some(first_path) = s.lines().next() {
                if first_path.to_lowercase().ends_with(".exe") {
                    return first_path.to_string();
                }
            }
        }
    }
    "node".to_string()
}

/// Find the Next.js web directory containing a .next build output.
/// Searches common locations in order:
/// 1. Bundled resources directory
/// 2. User's project directory (relative to home)
/// 3. Development fallback (relative to CARGO_MANIFEST_DIR)
fn find_web_dir(resource_dir: Option<&PathBuf>) -> Option<PathBuf> {
    log::log_msg("[find_web_dir] === SEARCH STARTING ===");
    
    // 1. Check bundled resources
    if let Some(ref res_dir) = resource_dir {
        // Standalone structure in web-assets: web/server.js, node_modules/
        let bundled_web = res_dir.join("web-assets").join("web");
        if bundled_web.join("server.js").exists() {
            log::log_msg(&format!("[find_web_dir] ✓ Found bundled web at {:?}", bundled_web));
            return Some(bundled_web);
        }

        for bundled in [res_dir.join("web"), res_dir.join("web-assets")] {
            let has_standalone = bundled.join("server.js").exists() || bundled.join("web").join("server.js").exists();
            log::log_msg(&format!("[find_web_dir] Checking bundled: {:?} (server.js exists={})", bundled, has_standalone));
            
            if bundled.join("web").join("server.js").exists() {
                return Some(bundled.join("web"));
            }
            if bundled.join("server.js").exists() {
                return Some(bundled);
            }
        }
    } else {
        log::log_msg("[find_web_dir] No resource_dir provided");
    }

    // 2. Search user's project directories
    let home = match dirs::home_dir() {
        Some(h) => {
            log::log_msg(&format!("[find_web_dir] Home dir: {:?}", h));
            h
        }
        None => {
            log::log_msg("[find_web_dir] ✗ Could not determine home directory");
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
        log::log_msg(&format!("[find_web_dir] Checking {:?} (.next={}, pkg.json={}, server.js={})", candidate, has_next, has_pkg, has_standalone));
        if has_standalone || (has_next && has_pkg) {
            log::log_msg(&format!("[find_web_dir] ✓ Found project web dir"));
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
    log::log_msg(&format!("[find_web_dir] Checking dev dir: {:?} (.next={}, pkg.json={}, server.js={})", dev_dir, has_next, has_pkg, has_standalone));
    if has_standalone || (has_next && has_pkg) {
        log::log_msg(&format!("[find_web_dir] ✓ Found dev web dir"));
        return Some(dev_dir);
    }

    log::log_msg("[find_web_dir] ✗ No web directory found anywhere");
    log::log_msg("[find_web_dir] === SEARCH ENDING (FAILED) ===");
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
fn spawn_next_server(
    port: u16, 
    token: &str, 
    resource_dir: Option<PathBuf>,
    app_data_dir: Option<PathBuf>,
) -> Result<Child, String> {
    log::log_msg("[spawn_next] === SPAWN NEXT SERVER ===");
    
    // Ensure app data directory exists
    if let Some(ref ad) = app_data_dir {
        let _ = std::fs::create_dir_all(ad);
    }
    
    let web_dir = find_web_dir(resource_dir.as_ref())
        .ok_or("Could not find Next.js web directory with .next build. Run `pnpm build` in the web/ folder.")?;

    log::log_msg(&format!("[spawn_next] Web dir: {:?}", web_dir.display()));

    let standalone_server_path = web_dir.join("server.js");
    if standalone_server_path.exists() {
        log::log_msg(&format!("[spawn_next] Found standalone server at {:?}", standalone_server_path));
        let mut standalone_cmd: Command = if cfg!(windows) {
            let bundled_node = web_dir.parent().map(|parent| parent.join("node.exe"));
            if let Some(node_path) = bundled_node.filter(|path| path.exists()) {
                log::log_msg(&format!("[spawn_next] Using bundled Node runtime at {:?}", node_path));
                let mut c = Command::new(node_path);
                apply_no_window(&mut c);
                c.arg("server.js");
                c
            } else {
                log::log_msg("[spawn_next] Bundled Node runtime not found, falling back to system node");
                let node_exe = find_node_executable();
                log::log_msg(&format!("[spawn_next] Using system node at: {}", node_exe));
                let mut c = Command::new(node_exe);
                apply_no_window(&mut c);
                c.arg("server.js");
                c
            }
        } else {
            let mut c = Command::new("node");
            apply_no_window(&mut c);
            c.arg("server.js");
            c
        };

        // Inherit system environment variables (important for PATH, etc.)
        for (key, value) in std::env::vars() {
            standalone_cmd.env(key, value);
        }

        standalone_cmd
            .env("NODE_ENV", "production")
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("DESKTOP_MODE", "true")
            .env("DESKTOP_LOCAL_EXECUTION", "true")
            .env("SIDECAR_TOKEN", token)
            .env("LOG_TO_FILE", "true")
            .current_dir(&web_dir);

        // Set database and log paths to writable app data directory
        if let Some(ref app_data) = app_data_dir {
            let db_path = app_data.join("binG.db");
            let log_path = app_data.join("run.log");
            log::log_msg(&format!("[spawn_next] Setting DATABASE_PATH={:?}", db_path));
            standalone_cmd.env("DATABASE_PATH", db_path.to_string_lossy().to_string());
            standalone_cmd.env("LOG_FILE_PATH", log_path.to_string_lossy().to_string());
        }

        apply_no_window(&mut standalone_cmd);

        // Inherit stdio so the terminal window actually shows output
        standalone_cmd
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit());

        log::log_msg(&format!("[spawn_next] Spawning standalone Next server on port {} in {:?}", port, web_dir));
        return standalone_cmd
            .spawn()
            .map(|child| {
                log::log_msg(&format!("[spawn_next] ✓ Standalone process spawned, PID: {}", child.id()));
                child
            })
            .map_err(|e| {
                let err_msg = format!("Failed to spawn standalone Next.js server: {}", e);
                log::log_msg(&format!("[spawn_next] ✗ {}", err_msg));
                err_msg
            });
    }

    // Verify .next exists
    if !web_dir.join(".next").exists() {
        return Err(format!("No .next build found in {:?}", web_dir));
    }
    log::log_msg("[spawn_next] ✓ .next directory confirmed");

    // Check if a valid production build exists (BUILD_ID file)
    let build_id_path = web_dir.join(".next").join("BUILD_ID");
    if !build_id_path.exists() {
        log::log_msg("[spawn_next] No BUILD_ID found — running pnpm build first...");
        // Auto-build the production output
        let build_result = if cfg!(windows) {
            let mut c = Command::new("cmd");
            apply_no_window(&mut c);
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
                log::log_msg("[spawn_next] ✓ pnpm build completed successfully");
            }
            Ok(status) => {
                return Err(format!("pnpm build failed with exit code: {}", status));
            }
            Err(e) => {
                return Err(format!("Failed to run pnpm build: {}", e));
            }
        }
    } else {
        log::log_msg(&format!("[spawn_next] ✓ BUILD_ID exists at {:?}", build_id_path));
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
                log::log_msg(&format!("[spawn_next] Found npx at: {}", npx_path));
                let mut c = Command::new("cmd");
                c.args(["/C", &npx_path, "next", "start", "-p", &port.to_string()]);
                c
            } else {
                log::log_msg("[spawn_next] where.exe returned empty, falling back to bare npx");
                let mut c = Command::new("cmd");
                c.args(["/C", "npx", "next", "start", "-p", &port.to_string()]);
                c
            }
        } else {
            log::log_msg("[spawn_next] where.exe failed, falling back to bare npx");
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
            log::log_msg(&format!("[spawn_next] Found npx at: {}", path));
            let mut c = Command::new(&path);
            c.args(["next", "start", "-p", &port.to_string()]);
            c
        } else {
            log::log_msg("[spawn_next] which npx failed, falling back to bare npx");
            let mut c = Command::new("npx");
            c.args(["next", "start", "-p", &port.to_string()]);
            c
        }
    };

    cmd.env("NODE_ENV", "production")
        .env("DESKTOP_MODE", "true")
        .env("DESKTOP_LOCAL_EXECUTION", "true")
        .env("SIDECAR_TOKEN", token)
        .current_dir(&web_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    log::log_msg(&format!("[spawn_next] Spawning next start on port {} in {:?}", port, web_dir));
    match cmd.spawn() {
        Ok(child) => {
            log::log_msg(&format!("[spawn_next] ✓ Process spawned, PID: {}", child.id()));
            Ok(child)
        }
        Err(e) => {
            let err_msg = format!("Failed to spawn Next.js server: {}", e);
            log::log_msg(&format!("[spawn_next] ✗ {}", err_msg));
            Err(err_msg)
        }
    }
}

/// Wait for the Next.js server to be ready.
fn wait_for_server(port: u16, timeout: Duration) -> bool {
    log::log_msg(&format!("[wait_for_server] Waiting on port {} for up to {}s", port, timeout.as_secs()));
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
                log::log_msg(&format!("[wait_for_server] ✓ Server ready after {}ms (HTTP {}, attempt {})", start.elapsed().as_millis(), resp.status(), attempts));
                return true;
            }
            Err(e) => {
                if attempts <= 3 || attempts % 10 == 0 {
                    log::log_msg(&format!("[wait_for_server] Attempt {}: {} (elapsed: {}ms)", attempts, e, start.elapsed().as_millis()));
                }
                thread::sleep(Duration::from_millis(500));
            }
        }
    }
    log::log_msg(&format!("[wait_for_server] ✗ Server not ready after {}ms ({} attempts)", start.elapsed().as_millis(), attempts));
    false
}

/// Sidecar configuration passed to the webview via window.__SIDECAR_CONFIG__
#[derive(Clone, Serialize)]
pub struct SidecarConfig {
    pub port: u16,
    pub token: String,
    pub workspace_root: String,
}

/// Kill any lingering Next.js processes on the sidecar port.
/// This handles the case where the app was force-closed and the sidecar survived.
fn kill_stale_processes(port: u16) {
    log::log_msg(&format!("[kill_stale] Cleaning up ports in range {}-{}", port, port + 5));
    
    for p in port..=port+5 {
        // Check if something is listening
        if TcpListener::bind(("127.0.0.1", p)).is_err() {
            log::log_msg(&format!("[kill_stale] Port {} is occupied — killing process", p));
            if cfg!(windows) {
                let mut c = Command::new("cmd");
                apply_no_window(&mut c);
                // More robust netstat command for Windows
                let cmd_str = format!("for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a 2>nul", p);
                let _ = c.args(["/C", &cmd_str]).output();
            } else {
                let _ = Command::new("sh")
                    .arg("-c")
                    .arg(format!("lsof -ti :{} | xargs kill -9 2>/dev/null", p))
                    .output();
            }
        }
    }
    thread::sleep(Duration::from_millis(500));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize file logging
    let log_path = log::init_logging();
    if let Some(ref lp) = log_path {
        log::log_msg(&format!("Log file: {:?}", lp));
    }
    log::log_msg("Application starting");

    // Generate a unique auth token for this session
    let auth_token = generate_token();
    log::log_msg(&format!("Auth token generated"));

    // Find an available port for the Next.js server
    let port = find_available_port(3000);
    log::log_msg(&format!("Using port {}", port));

    // Kill any lingering sidecar processes on this port
    kill_stale_processes(port);

    // Capture the user's launch directory BEFORE spawning the sidecar.
    // The sidecar's own CWD will be the web bundle dir, so we need to
    // capture this here and pass it through the workspace env vars used by
    // the web app and shared platform helpers.
    let launch_cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    log::log_msg(&format!("[run] Captured launch directory: {}", launch_cwd));
    
    // Set both names for compatibility with older and newer workspace helpers.
    std::env::set_var("LAUNCH_CWD", &launch_cwd);
    std::env::set_var("INITIAL_CWD", &launch_cwd);
    std::env::set_var("DESKTOP_WORKSPACE_ROOT", &launch_cwd);

    // Wrap the sidecar child process so it gets killed on drop
    let sidecar_child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let sidecar_child_clone = sidecar_child.clone();

    let sidecar_config_state = Arc::new(Mutex::new(None));
    let sidecar_config_state_clone = sidecar_config_state.clone();

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
        .manage(WatcherRegistry::default())
        .manage(SidecarConfigState(sidecar_config_state_clone))
        .invoke_handler(register_invoke_handler())
        .setup(move |app| {
            log::log_msg("Setup phase starting");

            // Try to spawn the Next.js sidecar for SIDECAR_ROUTES (chat, agent, LLM, etc.)
            // TAURI_ROUTES (filesystem, health, providers) work without the sidecar
            let resource_dir = app.path().resource_dir().ok();
            let app_data_dir = app.path().app_data_dir().ok();
            
            if let Some(ref rd) = resource_dir {
                log::log_msg(&format!("Resource dir: {:?}", rd));
            } else {
                log::log_msg("No resource dir found");
            }

            let sidecar_ok = spawn_sidecar_with_fallback(port, &auth_token, resource_dir, app_data_dir, sidecar_child_clone);
            log::log_msg(&format!("Sidecar spawn result: {}", sidecar_ok));

            // Store config in state for JS to retrieve via invoke
            let config = SidecarConfig {
                port,
                token: auth_token.clone(),
            };
            *sidecar_config_state.lock().unwrap() = Some(config.clone());

            // Inject sidecar config into the webview so the JS adapter knows
            // how to reach the secured sidecar
            let sidecar_json = serde_json::to_string(&SidecarConfig {
                port,
                token: auth_token.clone(),
                workspace_root: launch_cwd.clone(),
            }).unwrap();
            let init_script = format!(
                "window.__SIDECAR_CONFIG__ = {};",
                sidecar_json
            );

            // Create the main window using the bundled startup shell. The
            // shell shows the loading UI and redirects to the sidecar once it
            // is reachable, which preserves the draggable title region.
            let url = "index.html".to_string();

            let builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                if url.starts_with("http") {
                    tauri::WebviewUrl::External(url.parse().unwrap())
                } else {
                    tauri::WebviewUrl::App(url.parse().unwrap())
                },
            )
            .title("Quaz Desktop")
            .inner_size(1400.0, 900.0)
            .resizable(true)
            .transparent(true)
            .decorations(false)
            .initialization_script(&init_script);

            builder.build()?;

            Ok(())
        })
        .run(tauri::generate_context!());

    // Ensure sidecar is killed if run() returns (safety net)
    if let Some(mut child) = sidecar_child.lock().unwrap().take() {
        log::log_msg("App exiting — killing sidecar");
        let _ = child.kill();
        let _ = child.wait();
    }

    if let Err(e) = result {
        log::log_msg(&format!("Failed to run tauri application: {}", e));
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
    app_data_dir: Option<PathBuf>,
    sidecar_child: Arc<Mutex<Option<Child>>>,
) -> bool {
    log::log_msg("[spawn_sidecar] === SPAWN ATTEMPT STARTING ===");
    log::log_msg(&format!("[spawn_sidecar] Port: {}, resource_dir: {:?}", port, resource_dir));
    
    // Try to spawn Next.js server
    let child = match spawn_next_server(port, token, resource_dir, app_data_dir) {
        Ok(c) => {
            log::log_msg("[spawn_sidecar] ✓ spawn_next_server returned Ok");
            c
        }
        Err(e) => {
            log::log_msg(&format!("[spawn_sidecar] ✗ spawn_next_server returned Err: {}", e));
            return false;
        }
    };

    // Store the child process for later cleanup
    *sidecar_child.lock().unwrap() = Some(child);
    log::log_msg("[spawn_sidecar] Child process stored in sidecar_child");

    // Read stdout and stderr in separate threads so the pipe buffer doesn't fill up and block the process
    let child_ref = sidecar_child.clone();
    let _stdout_thread = thread::spawn(move || {
        let stdout = {
            let mut lock = child_ref.lock().unwrap();
            if let Some(child) = lock.as_mut() {
                child.stdout.take()
            } else {
                None
            }
        };

        if let Some(stdout) = stdout {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => log::log_msg(&format!("[NextServer::stdout] {}", l)),
                    Err(e) => {
                        log::log_msg(&format!("[NextServer::stdout] Read error: {}", e));
                        break;
                    }
                }
            }
            log::log_msg("[NextServer::stdout] Stream ended");
        }
    });

    let child_ref_err = sidecar_child.clone();
    let _stderr_thread = thread::spawn(move || {
        let stderr = {
            let mut lock = child_ref_err.lock().unwrap();
            if let Some(child) = lock.as_mut() {
                child.stderr.take()
            } else {
                None
            }
        };

        if let Some(stderr) = stderr {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => log::log_msg(&format!("[NextServer::stderr] {}", l)),
                    Err(e) => {
                        log::log_msg(&format!("[NextServer::stderr] Read error: {}", e));
                        break;
                    }
                }
            }
            log::log_msg("[NextServer::stderr] Stream ended");
        }
    });

    let _ready_thread = thread::spawn(move || {
        log::log_msg(&format!("[spawn_sidecar] Background wait started for port {}", port));
        if !wait_for_server(port, Duration::from_secs(90)) {
            log::log_msg("[spawn_sidecar] Server not ready before timeout; leaving loader page in fallback mode");
            return;
        }

        log::log_msg(&format!("[spawn_sidecar] ✓ Server ready at http://127.0.0.1:{}", port));

        // Pre-warm: hit the main page so the first user visit are fast
        log::log_msg("[spawn_sidecar] Pre-warming Next.js routes...");
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
                    Ok(resp) => log::log_msg(&format!("[spawn_sidecar] Warmed {}: HTTP {}", url, resp.status())),
                    Err(e) => log::log_msg(&format!("[spawn_sidecar] Warm-up failed for {}: {}", url, e)),
                }
            }
        }
        log::log_msg("[spawn_sidecar] Pre-warming complete");
    });

    true
}
