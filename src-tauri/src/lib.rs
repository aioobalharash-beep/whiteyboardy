use tauri_plugin_fs::FsExt;

/// Allow the current session to write one exported file to the path the user
/// just chose in the native "save" dialog.
///
/// The file-system plugin is deny-by-default for anything outside the app data
/// directory. Since the path always comes from a real user interaction, we
/// extend the runtime scope for exactly that file instead of shipping a blanket
/// wildcard write permission.
#[tauri::command]
fn allow_export_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let scope = app.fs_scope();

    scope
        .allow_file(&path)
        .map_err(|error| format!("could not extend the fs scope for {path}: {error}"))?;

    // The scope check runs against the fully symlink-resolved path, so also
    // allow the canonical location when the parent directory resolves
    // elsewhere (for example `/tmp` -> `/private/tmp` on macOS).
    let candidate = std::path::Path::new(&path);
    if let (Some(parent), Some(file_name)) = (candidate.parent(), candidate.file_name()) {
        if let Ok(canonical_parent) = std::fs::canonicalize(parent) {
            let _ = scope.allow_file(canonical_parent.join(file_name));
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![allow_export_path])
        .run(tauri::generate_context!())
        .expect("error while running WhiteyBoardy");
}
