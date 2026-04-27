// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Delegate to the full-featured library entry point which:
    // - Spawns the Next.js sidecar server
    // - Creates the main webview window
    // - Registers all Tauri command handlers
    opencode_desktop_lib::run();
}
