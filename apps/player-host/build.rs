fn main() {
    // Only our four save commands are reachable from the page (no plugins, no shell, no http, no fs).
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["save_list", "save_read", "save_write", "save_delete"]),
        ),
    )
    .expect("failed to run tauri-build");
}
