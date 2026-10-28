// Book-to-Game offline Windows player (M1b-2). A thin Tauri v2 shell:
//   preflight (Win10+, WebView2) → locate payload (own tail / sidecar) → one window serving the payload
//   via a custom scheme, `__BTG_HOST__` injected, four save commands. No server, no Node, no SQLite,
//   no network, no installer, no game rules (the page brings play-runtime with it).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod host_script;
mod native_text;
mod payload;
mod saves;
mod sha256;
#[cfg(windows)]
mod win;

use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::Arc;

use tauri::http::{header, Response, StatusCode};
use tauri::{WebviewUrl, WebviewWindowBuilder};

struct SaveRoot(PathBuf);

#[tauri::command]
fn save_list(root: tauri::State<'_, SaveRoot>, package_id: String) -> Result<Vec<String>, String> {
    saves::list(&root.0, &package_id)
}
#[tauri::command]
fn save_read(root: tauri::State<'_, SaveRoot>, package_id: String, save_id: String) -> Result<Option<String>, String> {
    saves::read(&root.0, &package_id, &save_id)
}
#[tauri::command]
fn save_write(root: tauri::State<'_, SaveRoot>, package_id: String, save_id: String, json: String) -> Result<(), String> {
    saves::write(&root.0, &package_id, &save_id, &json)
}
#[tauri::command]
fn save_delete(root: tauri::State<'_, SaveRoot>, package_id: String, save_id: String) -> Result<(), String> {
    saves::delete(&root.0, &package_id, &save_id)
}

/// Response header CSP (the payload bytes stay untouched): no network at all; only Tauri IPC.
const CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; \
font-src data:; media-src data: blob:; connect-src ipc: http://ipc.localhost; base-uri 'none'; form-action 'none'";

fn main() {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("btg-player.exe"));
    let exe_name = exe.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "btg-player.exe".into());
    let exe_stem = exe.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "btg-player".into());

    // 1) OS + WebView2 preflight — before reading anything else, before any window, never writes files.
    let located = payload::locate(&exe);
    let title = located.as_ref().and_then(|p| payload::manifest_title(&p.html)).unwrap_or(exe_stem);
    #[cfg(windows)]
    {
        let lang = win::ui_lang();
        if !win::is_windows_10_or_later() {
            win::show(&native_text::n1b(lang, &title), win::Icon::Error);
            std::process::exit(3);
        }
        if tauri::webview_version().is_err() {
            if win::show(&native_text::n1(lang, &title), win::Icon::Warning) {
                win::open_url(native_text::WEBVIEW2_DOWNLOAD_URL);
            }
            std::process::exit(4);
        }
        if located.is_none() {
            win::show(&native_text::n2(lang, &exe_name), win::Icon::Error);
            std::process::exit(5);
        }
    }
    let Some(payload) = located else {
        eprintln!("{exe_name}: game content not found (no trailer, no {})", payload::SIDECAR_FILE);
        std::process::exit(5);
    };

    let save_root = match saves::default_root() {
        Ok(p) => p,
        // No %APPDATA%: commands fail → the page degrades to host-fallback (localStorage) by itself.
        Err(_) => PathBuf::from("\\\\?\\btg-no-appdata"),
    };
    if !payload.host_compatible() {
        // Not fatal: the page sees payloadHostApiVersion ≠ hostApiVersion and degrades to host-fallback.
        eprintln!(
            "{exe_name}: payload packaged for host API v{}, this player implements v{} — saves use the temporary location",
            payload.host_api_version,
            payload::HOST_API_VERSION
        );
    }
    let init = host_script::build(&payload);
    let served: Arc<Vec<u8>> = Arc::new(payload.html);
    tauri::Builder::default()
        .manage(SaveRoot(save_root))
        .invoke_handler(tauri::generate_handler![save_list, save_read, save_write, save_delete])
        .register_uri_scheme_protocol("btg", move |_ctx, request| {
            let path = request.uri().path();
            if path == "/" || path == "/index.html" {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .header(header::CONTENT_SECURITY_POLICY, CSP)
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(Cow::Owned(served.as_ref().clone()))
                    .unwrap()
            } else {
                Response::builder().status(StatusCode::NOT_FOUND).body(Cow::Borrowed(&[][..])).unwrap()
            }
        })
        .setup(move |app| {
            // Windows (WebView2) maps custom schemes to http://<scheme>.localhost/.
            let url = if cfg!(windows) { "http://btg.localhost/" } else { "btg://localhost/" };
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url.parse().unwrap()))
                .title(&title)
                .inner_size(1280.0, 800.0)
                .min_inner_size(980.0, 640.0)
                .center()
                .initialization_script(&init)
                // Zero network (§7.6-9): the page may never navigate away from the payload.
                .on_navigation(|u| u.host_str() == Some("btg.localhost") || u.scheme() == "btg")
                .build()?;
            let _ = window.set_focus();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running btg-player");
}
