//! SurgeSpace desktop shell. The app itself is the web build in ../dist; this file adds what a browser cannot do:
//!  - a stable device id derived from the machine id (licence activations survive reinstalling the app)
//!  - on the Microsoft Store build: the Store licence and the Store purchase dialog (Windows.Services.Store)

use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Platform {
    /// True when running as the packaged Microsoft Store app (licensing comes from the Store).
    store: bool,
    device_id: String,
    device_name: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoreLicence {
    active: bool,
    is_trial: bool,
    trial_days_left: i64,
    pro_active: bool,
    pro_is_trial: bool,
    /// Subscription end, Unix seconds.
    pro_expires: Option<i64>,
}

/// Machine id hashed with an app-specific salt, so the raw id never leaves the computer.
fn device_id() -> String {
    let raw = machine_uid::get().unwrap_or_else(|_| gethostname::gethostname().to_string_lossy().into_owned());
    let digest = Sha256::digest(format!("surgespace:{raw}").as_bytes());
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

#[tauri::command]
fn licence_platform() -> Platform {
    let os = if cfg!(target_os = "macos") { "Mac" } else if cfg!(windows) { "Windows" } else { "Linux" };
    Platform {
        store: store::is_packaged(),
        device_id: device_id(),
        device_name: format!("{} · {}", gethostname::gethostname().to_string_lossy(), os),
    }
}

#[tauri::command]
async fn store_licence(pro_addon: String) -> Result<StoreLicence, String> {
    tauri::async_runtime::spawn_blocking(move || store::licence(&pro_addon)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn store_purchase(window: tauri::WebviewWindow, store_id: String) -> Result<String, String> {
    store::purchase(&window, &store_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![licence_platform, store_licence, store_purchase])
        .run(tauri::generate_context!())
        .expect("error while running SurgeSpace");
}

#[cfg(windows)]
mod store {
    use super::StoreLicence;
    use windows::core::{Interface, HSTRING};
    use windows::Services::Store::{StoreContext, StorePurchaseStatus};
    use windows::Win32::Foundation::{APPMODEL_ERROR_NO_PACKAGE, HWND};
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    use windows::Win32::UI::Shell::IInitializeWithWindow;

    /// Windows FILETIME ticks (100 ns since 1601) to Unix seconds.
    fn unix(ticks: i64) -> i64 {
        ticks / 10_000_000 - 11_644_473_600
    }

    /// Packaged (MSIX) apps have a package identity; the plain installer build does not.
    pub fn is_packaged() -> bool {
        let mut len = 0u32;
        let rc = unsafe { GetCurrentPackageFullName(&mut len, None) };
        rc != APPMODEL_ERROR_NO_PACKAGE
    }

    pub fn licence(pro_addon: &str) -> Result<StoreLicence, String> {
        let run = || -> windows::core::Result<StoreLicence> {
            let ctx = StoreContext::GetDefault()?;
            let app = ctx.GetAppLicenseAsync()?.get()?;
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
            let mut out = StoreLicence {
                active: app.IsActive()?,
                is_trial: app.IsTrial()?,
                trial_days_left: if app.IsTrial()? { ((unix(app.ExpirationDate()?.UniversalTime) - now) / 86_400).max(0) } else { 0 },
                ..Default::default()
            };
            // Pro is a subscription add-on; its licence appears here while it is paid (or in its free trial).
            for pair in app.AddOnLicenses()? {
                let lic = pair.Value()?;
                let sku = lic.SkuStoreId()?.to_string();
                if !pro_addon.is_empty() && sku.starts_with(pro_addon) && lic.IsActive()? {
                    out.pro_active = true;
                    out.pro_expires = Some(unix(lic.ExpirationDate()?.UniversalTime));
                }
            }
            Ok(out)
        };
        run().map_err(|e| e.message().to_string())
    }

    pub fn purchase(window: &tauri::WebviewWindow, store_id: &str) -> Result<String, String> {
        let run = || -> windows::core::Result<String> {
            let ctx = StoreContext::GetDefault()?;
            // Desktop apps must tell the Store which window owns its dialog.
            let hwnd = window.hwnd().map_err(|_| windows::core::Error::from_win32())?;
            let init: IInitializeWithWindow = ctx.cast()?;
            unsafe { init.Initialize(HWND(hwnd.0 as _))? };
            let res = ctx.RequestPurchaseAsync(&HSTRING::from(store_id))?.get()?;
            Ok(match res.Status()? {
                StorePurchaseStatus::Succeeded => "Thank you. SurgeSpace Pro is now active.",
                StorePurchaseStatus::AlreadyPurchased => "You already have SurgeSpace Pro.",
                StorePurchaseStatus::NotPurchased => "Purchase cancelled.",
                StorePurchaseStatus::NetworkError => "The Store could not be reached. Try again.",
                _ => "The Store reported a problem with the purchase.",
            }
            .to_string())
        };
        run().map_err(|e| e.message().to_string())
    }
}

#[cfg(not(windows))]
mod store {
    use super::StoreLicence;
    pub fn is_packaged() -> bool {
        false
    }
    pub fn licence(_: &str) -> Result<StoreLicence, String> {
        Err("The Microsoft Store is only available on Windows.".into())
    }
    pub fn purchase(_: &tauri::WebviewWindow, _: &str) -> Result<String, String> {
        Err("The Microsoft Store is only available on Windows.".into())
    }
}
