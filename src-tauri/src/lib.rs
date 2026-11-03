//! SurgeSpace desktop shell. The app itself is the web build in ../dist; this adds what a browser cannot do:
//!  - a stable device id from the machine id (shown in the app as the Machine ID used for licences)
//!  - a small licence file in the app's data folder, so the licence survives clearing the web view's storage
//!  - opening the email app and web links (tauri-plugin-opener)

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::Manager;

/// Machine id hashed with an app-specific salt (the raw id never leaves the computer). 32 hex characters.
#[tauri::command]
fn device_id() -> String {
    let raw = machine_uid::get().unwrap_or_else(|_| gethostname::gethostname().to_string_lossy().into_owned());
    let digest = Sha256::digest(format!("surgespace:{raw}").as_bytes());
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

/// Computer name, shown on the seller's admin page next to the licence.
#[tauri::command]
fn host_name() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("licence.json"))
}
fn read_store(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    store_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Only the licence keys are accepted, so the web view cannot use this as general file storage.
fn allowed(key: &str) -> bool {
    matches!(key, "surgespace.code" | "surgespace.key" | "surgespace.trial" | "surgespace.seen" | "surgespace.checked")
}

#[tauri::command]
fn kv_get(app: tauri::AppHandle, key: String) -> Option<String> {
    if !allowed(&key) {
        return None;
    }
    read_store(&app).get(&key).cloned()
}

#[tauri::command]
fn kv_set(app: tauri::AppHandle, key: String, value: Option<String>) -> Result<(), String> {
    if !allowed(&key) {
        return Err("key not allowed".into());
    }
    let mut m = read_store(&app);
    match value {
        Some(v) => m.insert(key, v),
        None => m.remove(&key),
    };
    let text = serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?;
    std::fs::write(store_path(&app)?, text).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![device_id, host_name, kv_get, kv_set])
        .run(tauri::generate_context!())
        .expect("error while running SurgeSpace");
}
