// rust-skill/src/lib.rs
//
// Rust WASM skill handler compiled to wasm32-wasi.
//
// Host ABI (imported from the "host" module):
//   host_read(path_ptr, path_len, out_ptr, out_cap) -> i32
//     Returns bytes written (≥ 0) or a negative error code.
//
//   host_write(path_ptr, path_len, data_ptr, data_len) -> i32
//     Returns 0 on success, negative on error.
//
//   host_fetch(url_ptr, url_len) -> i32
//     Returns a positive request-id immediately (async kick-off on host side).
//
//   host_poll(req_id, out_ptr, out_cap) -> i32
//     0  = PENDING  (call again)
//     1+ = READY    (return value is byte count written to out_ptr)
//     2  = ERROR    (error string at out_ptr)
//    -1  = unknown id
//
//   host_log(level_ptr, level_len, msg_ptr, msg_len)
//   host_getrandom(out_ptr, out_len) -> i32
//
// Guest required exports:
//   alloc(size: i32) -> i32
//   dealloc(ptr: i32, size: i32)
//   handle(in_ptr: i32, in_len: i32) -> i32   (returns out_ptr; length via result_len)
//   result_len() -> i32
//   memory (linear memory)

#![no_std]
extern crate alloc as alloc_crate;

use alloc_crate::{format, string::String, vec, vec::Vec};
use core::alloc::Layout;

// ── allocator ──────────────────────────────────────────────────────────────
// wasm32-wasi needs a global allocator. Use the system (libc) one via wasm-alloc.
// For no_std we use the `wee_alloc` or `dlmalloc` crate; here we use the
// standard wasm32-wasi allocator exposed through wasm-bindgen's dlmalloc.
// In a real Cargo.toml you'd add: wee_alloc = "0.4"
// For simplicity in this file we keep alloc/dealloc as raw extern wrappers:

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

// ── Host imports ───────────────────────────────────────────────────────────

#[link(wasm_import_module = "host")]
extern "C" {
    fn host_read(path_ptr: i32, path_len: i32, out_ptr: i32, out_cap: i32) -> i32;
    fn host_write(path_ptr: i32, path_len: i32, data_ptr: i32, data_len: i32) -> i32;
    fn host_fetch(url_ptr: i32, url_len: i32) -> i32;
    fn host_poll(req_id: i32, out_ptr: i32, out_cap: i32) -> i32;
    fn host_log(level_ptr: i32, level_len: i32, msg_ptr: i32, msg_len: i32);
    fn host_getrandom(out_ptr: i32, out_len: i32) -> i32;
}

// ── Static result buffer ───────────────────────────────────────────────────

static mut RESULT_PTR: i32 = 0;
static mut RESULT_LEN: i32 = 0;

#[no_mangle]
pub extern "C" fn result_len() -> i32 {
    unsafe { RESULT_LEN }
}

// ── Allocator exports ──────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn alloc(size: i32) -> i32 {
    let layout = Layout::from_size_align(size as usize, 1).expect("layout");
    unsafe { alloc_crate::alloc::alloc(layout) as i32 }
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: i32, size: i32) {
    let layout = Layout::from_size_align(size as usize, 1).expect("layout");
    unsafe { alloc_crate::alloc::dealloc(ptr as *mut u8, layout) }
}

// ── Safe host wrappers ─────────────────────────────────────────────────────

const POLL_BUF_CAP: usize = 512 * 1024; // 512 KB fetch response buffer
const STATUS_PENDING: i32 = 0;
const STATUS_ERROR:   i32 = 2;

fn vfs_read(path: &str) -> Result<Vec<u8>, String> {
    let path_bytes = path.as_bytes();
    let out_cap: usize = 256 * 1024;
    let mut buf = vec![0u8; out_cap];
    let ret = unsafe {
        host_read(
            path_bytes.as_ptr() as i32, path_bytes.len() as i32,
            buf.as_mut_ptr() as i32, out_cap as i32,
        )
    };
    if ret < 0 { return Err(format!("vfs_read_error:{}", ret)); }
    buf.truncate(ret as usize);
    Ok(buf)
}

fn vfs_write(path: &str, data: &[u8]) -> Result<(), String> {
    let path_bytes = path.as_bytes();
    let ret = unsafe {
        host_write(
            path_bytes.as_ptr() as i32, path_bytes.len() as i32,
            data.as_ptr() as i32, data.len() as i32,
        )
    };
    if ret != 0 { return Err(format!("vfs_write_error:{}", ret)); }
    Ok(())
}

fn log(level: &str, msg: &str) {
    let lb = level.as_bytes();
    let mb = msg.as_bytes();
    unsafe {
        host_log(
            lb.as_ptr() as i32, lb.len() as i32,
            mb.as_ptr() as i32, mb.len() as i32,
        );
    }
}

/// Async fetch via host_fetch + host_poll loop.
/// The guest busy-polls until the host settles the promise.
/// In practice the Node event loop drains microtasks at each host→wasm boundary,
/// so the first or second poll call usually returns READY.
fn http_fetch_sync(url: &str) -> Result<Vec<u8>, String> {
    let url_bytes = url.as_bytes();
    let req_id = unsafe { host_fetch(url_bytes.as_ptr() as i32, url_bytes.len() as i32) };
    if req_id <= 0 {
        return Err(format!("host_fetch failed: req_id={}", req_id));
    }

    log("debug", &format!("host_fetch req_id={} url={}", req_id, url));

    let mut poll_buf = vec![0u8; POLL_BUF_CAP];
    let mut iters = 0u32;

    loop {
        let ret = unsafe {
            host_poll(req_id, poll_buf.as_mut_ptr() as i32, POLL_BUF_CAP as i32)
        };

        if ret == STATUS_PENDING {
            iters += 1;
            if iters > 5_000 {
                return Err("http_fetch_timeout: too many poll iterations".into());
            }
            // Yield hint: a no-op that returns control to the host's event loop.
            // In a real wasm-threads build you'd use Atomics.wait here.
            // For single-threaded Node the microtask queue drains at this boundary.
            continue;
        }

        if ret == STATUS_ERROR {
            let err_str = core::str::from_utf8(&poll_buf[..])
                .unwrap_or("utf8_error")
                .trim_end_matches('\0')
                .to_string();
            return Err(format!("host_fetch error: {}", err_str));
        }

        // STATUS_READY: `ret` is the byte count written
        let byte_count = ret as usize;
        poll_buf.truncate(byte_count);
        log("debug", &format!("host_fetch ready: {} bytes after {} polls", byte_count, iters));
        return Ok(poll_buf);
    }
}

// ── Main handle() export ───────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn handle(in_ptr: i32, in_len: i32) -> i32 {
    let input_slice = unsafe { core::slice::from_raw_parts(in_ptr as *const u8, in_len as usize) };
    let input_str = match core::str::from_utf8(input_slice) {
        Ok(s) => s,
        Err(_) => return write_result(r#"{"ok":false,"error":"invalid_utf8"}"#),
    };

    // Parse the action + params from the JSON input
    // We use a minimal hand-rolled parser to keep dependencies minimal.
    // In a real skill you'd use serde_json (add to Cargo.toml).
    let action = extract_string_field(input_str, "action").unwrap_or_default();
    let params_raw = extract_object_field(input_str, "params").unwrap_or("{}");

    log("info", &format!("handle action={}", action));

    let result = match action.as_str() {
        "generate_component" => action_generate_component(params_raw),
        "fetch_template"     => action_fetch_template(params_raw),
        "read_vfs"           => action_read_vfs(params_raw),
        "write_vfs"          => action_write_vfs(params_raw),
        _                    => err_result(&format!("unknown_action:{}", action)),
    };

    write_result(&result)
}

// ── Actions ────────────────────────────────────────────────────────────────

fn action_generate_component(params: &str) -> String {
    let name = extract_string_field(params, "name").unwrap_or_else(|| "Component".into());
    let props_raw = extract_string_field(params, "props").unwrap_or_default();

    let tsx = format!(
        r#"import React from 'react'

export interface {name}Props {{
  {props_raw}
}}

/**
 * {name} — generated by react-component-gen skill
 */
export function {name}(props: {name}Props) {{
  return <div className="{name_lower}">{{{name_lower}}}</div>
}}

export default {name}
"#,
        name = name,
        props_raw = props_raw,
        name_lower = name.to_ascii_lowercase(),
    );

    // Encode artifact as base64
    let encoded = base64_encode(tsx.as_bytes());
    let artifact_path = format!("{}.tsx", name.to_ascii_lowercase());

    format!(
        r#"{{"ok":true,"output":"Generated component {name}","artifacts":[{{"path":"{ap}","content":"{enc}","type":"text/tsx"}}]}}"#,
        name = name,
        ap   = artifact_path,
        enc  = encoded,
    )
}

fn action_fetch_template(params: &str) -> String {
    let url = match extract_string_field(params, "url") {
        Some(u) => u,
        None    => return err_result("missing_param:url"),
    };

    match http_fetch_sync(&url) {
        Ok(bytes) => {
            let text = core::str::from_utf8(&bytes).unwrap_or("[binary]");
            // Return first 4096 chars to avoid huge responses
            let truncated = &text[..text.len().min(4096)];
            format!(r#"{{"ok":true,"output":{}}}"#, json_string(truncated))
        }
        Err(e) => err_result(&e),
    }
}

fn action_read_vfs(params: &str) -> String {
    let path = match extract_string_field(params, "path") {
        Some(p) => p,
        None    => return err_result("missing_param:path"),
    };

    match vfs_read(&path) {
        Ok(bytes) => {
            let content = core::str::from_utf8(&bytes).unwrap_or("[binary]");
            format!(r#"{{"ok":true,"output":{}}}"#, json_string(content))
        }
        Err(e) => err_result(&e),
    }
}

fn action_write_vfs(params: &str) -> String {
    let path    = match extract_string_field(params, "path")    { Some(p) => p, None => return err_result("missing_param:path") };
    let content = match extract_string_field(params, "content") { Some(c) => c, None => return err_result("missing_param:content") };

    match vfs_write(&path, content.as_bytes()) {
        Ok(())   => r#"{"ok":true,"output":"written"}"#.into(),
        Err(e)   => err_result(&e),
    }
}

// ── Minimal JSON helpers ───────────────────────────────────────────────────

fn extract_string_field(json: &str, key: &str) -> Option<String> {
    let pattern = format!(r#""{}":#, key);
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start();
    if rest.starts_with('"') {
        let inner = &rest[1..];
        let end = inner.find('"')?;
        Some(inner[..end].to_string())
    } else {
        None
    }
}

fn extract_object_field<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let pattern = format!(r#""{}":#, key);
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start();
    if rest.starts_with('{') {
        let mut depth = 0usize;
        let mut end = 0;
        for (i, c) in rest.char_indices() {
            match c { '{' => depth += 1, '}' => { depth -= 1; if depth == 0 { end = i + 1; break; } } _ => {} }
        }
        Some(&rest[..end])
    } else {
        None
    }
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"'  => out.push_str(r#"\""#),
            '\\' => out.push_str(r#"\\"#),
            '\n' => out.push_str(r#"\n"#),
            '\r' => out.push_str(r#"\r"#),
            '\t' => out.push_str(r#"\t"#),
            _    => out.push(c),
        }
    }
    out.push('"');
    out
}

fn err_result(msg: &str) -> String {
    format!(r#"{{"ok":false,"error":{}}}"#, json_string(msg))
}

fn write_result(json: &str) -> i32 {
    let bytes = json.as_bytes();
    let len = bytes.len() as i32;
    let ptr = alloc(len);
    unsafe {
        let dst = core::slice::from_raw_parts_mut(ptr as *mut u8, len as usize);
        dst.copy_from_slice(bytes);
        RESULT_PTR = ptr;
        RESULT_LEN = len;
    }
    ptr
}

// ── Minimal base64 encoder ─────────────────────────────────────────────────

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n  = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 0x3f) as usize]);
        out.push(TABLE[((n >> 12) & 0x3f) as usize]);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 0x3f) as usize] } else { b'=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 0x3f) as usize] } else { b'=' });
    }
    String::from_utf8(out).unwrap()
}
