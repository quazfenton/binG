//! System Tray Integration
//!
//! Provides system tray icon with quick actions for desktop mode:
//! - New session
//! - Stop agent
//! - Open workspace
//! - Settings
//! - Quit

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Initialize system tray for desktop app
pub fn init_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let quit = MenuItem::with_id(app, "quit", "Quit binG", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let new_session = MenuItem::with_id(app, "new_session", "New Session", true, None::<&str>)?;
    let stop_agent = MenuItem::with_id(app, "stop_agent", "Stop Agent", true, None::<&str>)?;
    let open_workspace = MenuItem::with_id(app, "open_workspace", "Open Workspace", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &separator,
            &new_session,
            &stop_agent,
            &separator,
            &open_workspace,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .menu_on_left_click(false)
        .tooltip("binG - Desktop Coding Agent")
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "quit" => {
                    // Graceful shutdown - let app handle cleanup
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.close();
                    }
                    // App will exit naturally after window closes
                }
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(e) = window.show() {
                            eprintln!("Failed to show window: {e}");
                        }
                        if let Err(e) = window.set_focus() {
                            eprintln!("Failed to focus window: {e}");
                        }
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(e) = window.hide() {
                            eprintln!("Failed to hide window: {e}");
                        }
                    }
                }
                "new_session" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(e) = window.emit("tray-new-session", ()) {
                            eprintln!("Failed to emit new session event: {e}");
                        }
                    }
                }
                "stop_agent" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(e) = window.emit("tray-stop-agent", ()) {
                            eprintln!("Failed to emit stop agent event: {e}");
                        }
                    }
                }
                "open_workspace" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(e) = window.emit("tray-open-workspace", ()) {
                            eprintln!("Failed to emit open workspace event: {e}");
                        }
                    }
                }
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(e) = window.emit("tray-open-settings", ()) {
                            eprintln!("Failed to emit open settings event: {e}");
                        }
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.show() {
                        eprintln!("Failed to show window: {e}");
                    }
                    if let Err(e) = window.set_focus() {
                        eprintln!("Failed to focus window: {e}");
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Update tray tooltip with current status
pub fn update_tray_tooltip<R: Runtime>(app: &AppHandle<R>, status: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = format!("binG - {}", status);
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}