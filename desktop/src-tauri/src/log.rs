/// Shared logging utility for the Tauri sidecar.
///
/// Writes to %TEMP%\binG.log (Windows) or /tmp/binG.log (Unix).
/// Also prints to stderr for console debugging during development.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// Initialize the log file path. Call once at startup.
pub fn init_logging() -> Option<PathBuf> {
    let log_path = if cfg!(windows) {
        std::env::var_os("TEMP").or_else(|| std::env::var_os("TMP")).map(PathBuf::from)
    } else {
        Some(PathBuf::from("/tmp"))
    }?;

    let log_path = log_path.join("binG.log");

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
    {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let _ = writeln!(file, "=== binG Desktop starting (ts={}) ===", ts);
        Some(log_path)
    } else {
        None
    }
}

/// Write a timestamped message to the log file.
pub fn log_msg(msg: &str) {
    let file_path = if cfg!(windows) {
        std::env::var_os("TEMP").or_else(|| std::env::var_os("TMP")).map(PathBuf::from)
    } else {
        Some(PathBuf::from("/tmp"))
    };

    if let Some(mut log_path) = file_path {
        log_path.push("binG.log");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
            let _ = writeln!(file, "[{}] {}", chrono::Local::now().format("%H:%M:%S%.3f"), msg);
        }
    }

    // Also write to stderr for console debugging
    eprintln!("{}", msg);
}