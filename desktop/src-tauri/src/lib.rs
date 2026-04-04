mod commands;
use commands::PtySessions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(PtySessions::default())
        .invoke_handler(tauri::generate_handler![
            commands::execute_command,
            commands::read_file,
            commands::write_file,
            commands::list_directory,
            commands::get_system_info,
            commands::create_pty_session,
            commands::write_pty_input,
            commands::resize_pty,
            commands::close_pty_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
