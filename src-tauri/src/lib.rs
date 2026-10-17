use tauri_plugin_fs::FsExt;

/// Adds one concrete file to the file-system plugin's runtime scope.
///
/// The fs plugin is deny-by-default for anything outside the app data
/// directory. Every path we extend the scope for comes from a real user
/// interaction (a native open/save dialog), so we allow exactly that file
/// instead of shipping a blanket wildcard write permission.
fn extend_scope_for_file(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let scope = app.fs_scope();

    scope
        .allow_file(path)
        .map_err(|error| format!("could not extend the fs scope for {path}: {error}"))?;

    // The scope check runs against the fully symlink-resolved path, so also
    // allow the canonical location when the parent directory resolves
    // elsewhere (for example `/tmp` -> `/private/tmp` on macOS).
    let candidate = std::path::Path::new(path);
    if let (Some(parent), Some(file_name)) = (candidate.parent(), candidate.file_name()) {
        if let Ok(canonical_parent) = std::fs::canonicalize(parent) {
            let _ = scope.allow_file(canonical_parent.join(file_name));
        }
    }

    Ok(())
}

/// Allow the current session to write one exported file to the path the user
/// just chose in the native "Save" dialog.
#[tauri::command]
fn allow_export_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    extend_scope_for_file(&app, &path)
}

/// Allow the current session to read one image the user just chose in the
/// native "Open" dialog, so it can be added to the board.
#[tauri::command]
fn allow_import_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    extend_scope_for_file(&app, &path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Tauri does not create the app data directory for us, and the
            // webview's `fs` plugin cannot create it either: `mkdir(".")` resolves
            // to a path with a trailing `.` component, which `create_dir_all`
            // mishandles (`Path::parent()` skips the `.`, so the parent it tries to
            // create is the wrong one) and the call fails with ENOENT. Without this
            // directory every board write fails, so create it here, from Rust,
            // before the webview loads.
            match app.path().app_data_dir() {
                Ok(dir) => {
                    if let Err(error) = std::fs::create_dir_all(&dir) {
                        eprintln!(
                            "[whiteyboardy] could not create the app data directory {}: {error}",
                            dir.display()
                        );
                    }
                }
                Err(error) => {
                    eprintln!("[whiteyboardy] could not resolve the app data directory: {error}")
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![allow_export_path, allow_import_path])
        .run(tauri::generate_context!())
        .expect("error while running WhiteyBoardy");
}
