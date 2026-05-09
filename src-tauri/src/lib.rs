use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};
use tauri::{
    image::Image, menu::MenuBuilder, tray::TrayIconBuilder, Emitter, Manager, WebviewUrl,
    WebviewWindowBuilder,
};

const MAIN_WINDOW_LABEL: &str = "main";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const TRAY_ID: &str = "codex-pet-desk-tray";
const MENU_OPEN_SETTINGS: &str = "open_settings";
const MENU_TOGGLE_PET: &str = "toggle_pet";
const MENU_QUIT: &str = "quit";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetManifest {
    id: Option<String>,
    display_name: Option<String>,
    description: Option<String>,
    spritesheet_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePet {
    id: String,
    display_name: String,
    description: String,
    spritesheet_path: String,
    source_dir: String,
    sprite_data_url: String,
}

#[tauri::command]
fn list_codex_pets() -> Result<Vec<NativePet>, String> {
    let pets_dir = codex_pets_dir()?;
    if !pets_dir.exists() {
        return Ok(Vec::new());
    }

    let mut pets = Vec::new();
    for entry in fs::read_dir(&pets_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let pet_dir = entry.path();
        if !pet_dir.is_dir() {
            continue;
        }

        let manifest_path = pet_dir.join("pet.json");
        if !manifest_path.exists() {
            continue;
        }

        if let Ok(pet) = read_pet_package(&pet_dir, &manifest_path) {
            pets.push(pet);
        }
    }

    pets.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(pets)
}

fn read_pet_package(pet_dir: &PathBuf, manifest_path: &PathBuf) -> Result<NativePet, String> {
    let manifest_text = fs::read_to_string(manifest_path).map_err(|error| error.to_string())?;
    let manifest: PetManifest =
        serde_json::from_str(&manifest_text).map_err(|error| error.to_string())?;

    let folder_id = pet_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("codex-pet")
        .to_string();
    let id = manifest.id.unwrap_or_else(|| folder_id.clone());
    let display_name = manifest.display_name.unwrap_or_else(|| title_case_id(&id));
    let description = manifest
        .description
        .unwrap_or_else(|| "Codex-compatible desktop companion.".to_string());
    let spritesheet_path = manifest
        .spritesheet_path
        .unwrap_or_else(|| "spritesheet.webp".to_string());
    let sprite_path = pet_dir.join(&spritesheet_path);
    let sprite_bytes = fs::read(&sprite_path).map_err(|error| error.to_string())?;
    let mime = match sprite_path
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("png") => "image/png",
        _ => "image/webp",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(sprite_bytes);

    Ok(NativePet {
        id,
        display_name,
        description,
        spritesheet_path,
        source_dir: pet_dir.to_string_lossy().to_string(),
        sprite_data_url: format!("data:{mime};base64,{encoded}"),
    })
}

fn codex_pets_dir() -> Result<PathBuf, String> {
    if let Ok(codex_home) = env::var("CODEX_HOME") {
        return Ok(PathBuf::from(codex_home).join("pets"));
    }

    home_dir()
        .map(|home| home.join(".codex").join("pets"))
        .ok_or_else(|| "Could not find the user home directory.".to_string())
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn title_case_id(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            create_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_codex_pets])
        .run(tauri::generate_context!())
        .expect("failed to run Codex Pet Desk");
}

fn create_tray(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app_handle, true);
    let icon = tray_icon_image();

    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Codex Pet Desk")
        .icon(icon)
        .icon_as_template(false)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN_SETTINGS => {
                let _ = open_or_focus_settings_window(app);
            }
            MENU_TOGGLE_PET => {
                let _ = toggle_pet_window(app);
            }
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .build(app_handle)?;

    Ok(())
}

fn tray_icon_image() -> Image<'static> {
    const SIZE: u32 = 32;
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - 15.5;
            let dy = y as f32 - 15.5;
            let inside = dx * dx + dy * dy <= 210.0;
            if inside {
                rgba.extend_from_slice(&[85, 223, 178, 255]);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
}

fn tray_menu(app_handle: &tauri::AppHandle, pet_visible: bool) -> tauri::menu::Menu<tauri::Wry> {
    let visibility_label = if pet_visible { "Hide Pet" } else { "Show Pet" };

    MenuBuilder::new(app_handle)
        .text(MENU_OPEN_SETTINGS, "Settings")
        .text(MENU_TOGGLE_PET, visibility_label)
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()
        .expect("failed to build tray menu")
}

fn open_or_focus_settings_window(app_handle: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(SETTINGS_WINDOW_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app_handle,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html?settings=1".into()),
    )
    .title("Codex Pet Desk Settings")
    .inner_size(360.0, 390.0)
    .min_inner_size(320.0, 340.0)
    .resizable(false)
    .decorations(true)
    .skip_taskbar(true)
    .focused(true)
    .build()
    .map_err(|error| error.to_string())?;

    Ok(())
}

fn toggle_pet_window(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
        let visible = window.is_visible()?;
        if visible {
            window.hide()?;
        } else {
            window.show()?;
            let _ = window.set_focus();
        }
        update_tray_menu(app_handle, !visible)?;
        app_handle.emit("pet-visibility-changed", !visible)?;
    }
    Ok(())
}

fn update_tray_menu(app_handle: &tauri::AppHandle, pet_visible: bool) -> tauri::Result<()> {
    if let Some(tray) = app_handle.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(tray_menu(app_handle, pet_visible)))?;
    }
    Ok(())
}
