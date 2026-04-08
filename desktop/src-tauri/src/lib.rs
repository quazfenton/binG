mod commands;
use commands::{PtySessions, CheckpointManager};

/// Register all Tauri command handlers.
/// Separated from main builder for better maintainability as the command list grows.
fn register_invoke_handler() -> impl Fn(tauri::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(PtySessions::default())
        .manage(CheckpointManager::default())
        .invoke_handler(register_invoke_handler())
        .run(tauri::generate_context!());

    if let Err(e) = result {
        eprintln!("Failed to run tauri application: {}", e);
        std::process::exit(1);
    }
}
