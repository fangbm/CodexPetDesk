use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};
use tauri::{
    image::Image, menu::MenuBuilder, tray::TrayIconBuilder, Emitter, Manager, WebviewUrl,
    WebviewWindowBuilder,
};

const MAIN_WINDOW_LABEL: &str = "main";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const PETS_WINDOW_LABEL: &str = "pets";
const TRAY_ID: &str = "codex-pet-desk-tray";
const MENU_OPEN_SETTINGS: &str = "open_settings";
const MENU_OPEN_PETS: &str = "open_pets";
const MENU_TOGGLE_PET: &str = "toggle_pet";
const MENU_QUIT: &str = "quit";
const HOOK_SOURCE_MARKER: &str = "codex-pet-desk";
const HOOK_SCRIPT: &str = include_str!("../hooks/codex-pet-hook.cjs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetManifest {
    id: Option<String>,
    display_name: Option<String>,
    description: Option<String>,
    spritesheet_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetdexInstallRequest {
    slug: String,
    display_name: String,
    kind: Option<String>,
    submitted_by: Option<String>,
    spritesheet_url: Option<String>,
    pet_json_url: Option<String>,
    zip_url: Option<String>,
    install_dir: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PetdexPet {
    slug: String,
    display_name: String,
    kind: Option<String>,
    submitted_by: Option<String>,
    spritesheet_url: Option<String>,
    pet_json_url: Option<String>,
    zip_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetdexManifest {
    pets: Vec<PetdexPet>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookTargetStatus {
    name: String,
    path: String,
    installed: bool,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookStatus {
    installed: bool,
    hook_script: String,
    event_file: String,
    targets: Vec<HookTargetStatus>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HookEvent {
    #[serde(default)]
    event_type: String,
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    agent: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    timestamp: u64,
}

#[tauri::command]
fn list_codex_pets(pets_dir: Option<String>) -> Result<Vec<NativePet>, String> {
    let pets_dir = resolve_pets_dir(pets_dir)?;
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

#[tauri::command]
fn default_pet_storage_dir() -> Result<String, String> {
    codex_pets_dir().map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn hook_status() -> Result<HookStatus, String> {
    build_hook_status()
}

#[tauri::command]
fn install_code_hooks() -> Result<HookStatus, String> {
    let script = write_hook_script()?;
    install_codex_hook(&script)?;
    install_claude_hook(&script)?;
    build_hook_status()
}

#[tauri::command]
fn test_hook_bubble(app: tauri::AppHandle) -> Result<(), String> {
    app.emit(
        "code-task-complete",
        HookEvent {
            event_type: String::new(),
            r#type: "complete".to_string(),
            agent: "codex".to_string(),
            message: "测试提醒：任务已经完成。".to_string(),
            cwd: String::new(),
            timestamp: 0,
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn take_hook_events() -> Result<Vec<HookEvent>, String> {
    let file = hook_event_file()?;
    if !file.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&file).map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&file);
    let events = content
        .lines()
        .filter_map(|line| serde_json::from_str::<HookEvent>(line).ok())
        .collect();
    Ok(events)
}

#[tauri::command]
fn fetch_petdex_pets() -> Result<Vec<PetdexPet>, String> {
    let response = reqwest::blocking::Client::builder()
        .user_agent("CodexPetDesk/1.0")
        .build()
        .map_err(|error| error.to_string())?
        .get("https://petdex.crafter.run/api/manifest")
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    let manifest: PetdexManifest = response.json().map_err(|error| error.to_string())?;
    Ok(manifest.pets)
}

#[tauri::command]
fn install_petdex_pet(request: PetdexInstallRequest) -> Result<NativePet, String> {
    let pets_root = resolve_pets_dir(request.install_dir.clone())?;
    fs::create_dir_all(&pets_root).map_err(|error| error.to_string())?;

    let pet_dir = pets_root.join(safe_slug(&request.slug));
    fs::create_dir_all(&pet_dir).map_err(|error| error.to_string())?;

    if let Some(zip_url) = request.zip_url.as_deref().filter(|url| !url.is_empty()) {
        match install_from_zip(zip_url, &pet_dir) {
            Ok(()) => return read_pet_package(&pet_dir, &pet_dir.join("pet.json")),
            Err(error) => {
                if request.pet_json_url.is_none() || request.spritesheet_url.is_none() {
                    return Err(error);
                }
            }
        }
    }

    install_from_assets(&request, &pet_dir)?;
    read_pet_package(&pet_dir, &pet_dir.join("pet.json"))
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

fn resolve_pets_dir(pets_dir: Option<String>) -> Result<PathBuf, String> {
    match pets_dir.map(|value| value.trim().to_string()) {
        Some(value) if !value.is_empty() => Ok(PathBuf::from(value)),
        _ => codex_pets_dir(),
    }
}

fn codex_pets_dir() -> Result<PathBuf, String> {
    if let Ok(codex_home) = env::var("CODEX_HOME") {
        return Ok(PathBuf::from(codex_home).join("pets"));
    }

    home_dir()
        .map(|home| home.join(".codex").join("pets"))
        .ok_or_else(|| "Could not find the user home directory.".to_string())
}

fn codex_pet_runtime_dir() -> Result<PathBuf, String> {
    home_dir()
        .map(|home| home.join(".codex-pet-desk"))
        .ok_or_else(|| "Could not find the user home directory.".to_string())
}

fn hook_dir() -> Result<PathBuf, String> {
    Ok(codex_pet_runtime_dir()?.join("hooks"))
}

fn hook_script_path() -> Result<PathBuf, String> {
    Ok(hook_dir()?.join("codex-pet-hook.cjs"))
}

fn hook_event_file() -> Result<PathBuf, String> {
    Ok(codex_pet_runtime_dir()?.join("hook-events.jsonl"))
}

fn codex_config_path() -> Result<PathBuf, String> {
    home_dir()
        .map(|home| home.join(".codex").join("config.toml"))
        .ok_or_else(|| "Could not find the user home directory.".to_string())
}

fn claude_settings_path() -> Result<PathBuf, String> {
    home_dir()
        .map(|home| home.join(".claude").join("settings.json"))
        .ok_or_else(|| "Could not find the user home directory.".to_string())
}

fn write_hook_script() -> Result<PathBuf, String> {
    let script = hook_script_path()?;
    if let Some(parent) = script.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&script, HOOK_SCRIPT).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }
    Ok(script)
}

fn build_hook_status() -> Result<HookStatus, String> {
    let script = hook_script_path()?;
    let event_file = hook_event_file()?;
    let codex_path = codex_config_path()?;
    let claude_path = claude_settings_path()?;

    let codex_installed = codex_path
        .exists()
        .then(|| fs::read_to_string(&codex_path).ok())
        .flatten()
        .map(|content| content.contains(HOOK_SOURCE_MARKER))
        .unwrap_or(false);
    let claude_installed = claude_path
        .exists()
        .then(|| fs::read_to_string(&claude_path).ok())
        .flatten()
        .map(|content| content.contains(HOOK_SOURCE_MARKER))
        .unwrap_or(false);

    let targets = vec![
        HookTargetStatus {
            name: "Codex CLI".to_string(),
            path: codex_path.to_string_lossy().to_string(),
            installed: codex_installed,
            detail: "Uses top-level notify in config.toml.".to_string(),
        },
        HookTargetStatus {
            name: "Claude Code".to_string(),
            path: claude_path.to_string_lossy().to_string(),
            installed: claude_installed,
            detail: "Uses a Stop hook in settings.json.".to_string(),
        },
    ];
    Ok(HookStatus {
        installed: script.exists() && targets.iter().any(|target| target.installed),
        hook_script: script.to_string_lossy().to_string(),
        event_file: event_file.to_string_lossy().to_string(),
        targets,
    })
}

fn install_codex_hook(script: &Path) -> Result<(), String> {
    let config = codex_config_path()?;
    if let Some(parent) = config.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = if config.exists() {
        fs::read_to_string(&config).map_err(|error| error.to_string())?
    } else {
        String::new()
    };

    let args = vec![
        "node".to_string(),
        script.to_string_lossy().to_string(),
        "--agent".to_string(),
        "codex".to_string(),
        "--event".to_string(),
        "notify".to_string(),
    ];
    let updated = toml_upsert_notify(&content, &toml_build_notify(&args));
    fs::write(&config, ensure_trailing_newline(updated)).map_err(|error| error.to_string())
}

fn install_claude_hook(script: &Path) -> Result<(), String> {
    let config = claude_settings_path()?;
    let mut root = read_json_or_default(&config)?;
    if !root.is_object() {
        root = json!({});
    }
    if root.get("hooks").is_none() || !root["hooks"].is_object() {
        root["hooks"] = json!({});
    }

    let command = format!(
        "node \"{}\" --agent claude-code --event Stop",
        script.to_string_lossy()
    );
    let hooks = root["hooks"]
        .as_object_mut()
        .ok_or_else(|| "Claude hooks is not an object.".to_string())?;
    let entries = hooks.entry("Stop".to_string()).or_insert_with(|| json!([]));
    if !entries.is_array() {
        *entries = json!([]);
    }
    let entries = entries
        .as_array_mut()
        .ok_or_else(|| "Claude Stop hooks is not an array.".to_string())?;

    let mut found = false;
    for outer in entries.iter_mut() {
        if let Some(inner) = outer.get_mut("hooks").and_then(Value::as_array_mut) {
            if inner.iter().any(hook_command_has_marker) {
                for hook in inner
                    .iter_mut()
                    .filter(|hook| hook_command_has_marker(hook))
                {
                    *hook = json!({ "type": "command", "command": command.clone() });
                }
                found = true;
                break;
            }
        }
    }
    if !found {
        entries.push(json!({
            "matcher": "",
            "hooks": [{ "type": "command", "command": command.clone() }]
        }));
    }

    write_json(&config, &root)
}

fn hook_command_has_marker(value: &Value) -> bool {
    value
        .get("command")
        .and_then(Value::as_str)
        .map(|command| command.contains(HOOK_SOURCE_MARKER))
        .unwrap_or(false)
}

fn read_json_or_default(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, ensure_trailing_newline(body)).map_err(|error| error.to_string())
}

fn toml_build_notify(args: &[String]) -> String {
    let items: Vec<String> = args
        .iter()
        .map(|arg| serde_json::to_string(arg).unwrap_or_else(|_| format!("{arg:?}")))
        .collect();
    format!("notify = [{}] # {HOOK_SOURCE_MARKER}", items.join(", "))
}

fn toml_upsert_notify(content: &str, new_line: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if let Some((start, end)) = toml_notify_span(&lines) {
        let mut result = Vec::with_capacity(lines.len());
        result.extend(lines[..start].iter().map(|line| line.to_string()));
        result.push(new_line.to_string());
        result.extend(lines[end + 1..].iter().map(|line| line.to_string()));
        return result.join("\n");
    }

    if content.trim().is_empty() {
        return new_line.to_string();
    }

    let insert_at = lines
        .iter()
        .position(|line| line.trim_start().starts_with('['))
        .unwrap_or(lines.len());
    let mut result = Vec::with_capacity(lines.len() + 1);
    result.extend(lines[..insert_at].iter().map(|line| line.to_string()));
    result.push(new_line.to_string());
    result.extend(lines[insert_at..].iter().map(|line| line.to_string()));
    result.join("\n")
}

fn toml_notify_span(lines: &[&str]) -> Option<(usize, usize)> {
    let mut start = None;
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('[') {
            break;
        }
        if trimmed.starts_with("notify") {
            start = Some(index);
            break;
        }
    }

    let start = start?;
    let first = lines[start];
    if first.contains('[') && first.contains(']') {
        return Some((start, start));
    }
    for (index, line) in lines.iter().enumerate().skip(start) {
        if line.contains(']') {
            return Some((start, index));
        }
    }
    Some((start, start))
}

fn ensure_trailing_newline(mut value: String) -> String {
    if !value.ends_with('\n') {
        value.push('\n');
    }
    value
}

fn install_from_zip(zip_url: &str, pet_dir: &Path) -> Result<(), String> {
    let bytes = download_bytes(zip_url)?;
    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|error| error.to_string())?;
    let mut manifest = None;
    let mut sprite = None;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        if file.is_dir() {
            continue;
        }

        let Some(name) = file.enclosed_name() else {
            continue;
        };
        let Some(base_name) = name.file_name().and_then(|part| part.to_str()) else {
            continue;
        };

        let lower = base_name.to_lowercase();
        let target_name = if lower == "pet.json" {
            "pet.json".to_string()
        } else if lower == "spritesheet.webp" || lower == "sprite.webp" {
            "spritesheet.webp".to_string()
        } else if lower == "spritesheet.png" || lower == "sprite.png" {
            "spritesheet.png".to_string()
        } else {
            continue;
        };

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        fs::write(pet_dir.join(&target_name), bytes).map_err(|error| error.to_string())?;
        if target_name == "pet.json" {
            manifest = Some(());
        } else {
            sprite = Some(target_name);
        }
    }

    if manifest.is_none() {
        return Err("Petdex package did not contain pet.json.".to_string());
    }

    if let Some(sprite_name) = sprite {
        normalize_pet_manifest(pet_dir, &sprite_name)?;
        Ok(())
    } else {
        Err("Petdex package did not contain a spritesheet.".to_string())
    }
}

fn install_from_assets(request: &PetdexInstallRequest, pet_dir: &Path) -> Result<(), String> {
    let pet_json_url = request
        .pet_json_url
        .as_deref()
        .filter(|url| !url.is_empty())
        .ok_or_else(|| "Petdex entry is missing petJsonUrl.".to_string())?;
    let spritesheet_url = request
        .spritesheet_url
        .as_deref()
        .filter(|url| !url.is_empty())
        .ok_or_else(|| "Petdex entry is missing spritesheetUrl.".to_string())?;

    let manifest_bytes = download_bytes(pet_json_url)?;
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&manifest_bytes).map_err(|error| error.to_string())?;
    let sprite_name = if spritesheet_url.to_lowercase().contains(".png") {
        "spritesheet.png"
    } else {
        "spritesheet.webp"
    };
    manifest["id"] = serde_json::Value::String(request.slug.clone());
    manifest["displayName"] = serde_json::Value::String(request.display_name.clone());
    manifest["spritesheetPath"] = serde_json::Value::String(sprite_name.to_string());
    if manifest.get("description").is_none() || manifest["description"].is_null() {
        let mut description = "Installed from Petdex.".to_string();
        if let Some(kind) = request.kind.as_deref().filter(|value| !value.is_empty()) {
            description = format!("Installed from Petdex - {kind}");
        }
        if let Some(author) = request
            .submitted_by
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            description = format!("{description} - by {author}");
        }
        manifest["description"] = serde_json::Value::String(description);
    }

    let sprite_bytes = download_bytes(spritesheet_url)?;
    fs::write(
        pet_dir.join("pet.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::write(pet_dir.join(sprite_name), sprite_bytes).map_err(|error| error.to_string())?;
    Ok(())
}

fn normalize_pet_manifest(pet_dir: &Path, sprite_name: &str) -> Result<(), String> {
    let manifest_path = pet_dir.join("pet.json");
    let manifest_text = fs::read_to_string(&manifest_path).map_err(|error| error.to_string())?;
    let mut manifest: serde_json::Value =
        serde_json::from_str(&manifest_text).map_err(|error| error.to_string())?;
    manifest["spritesheetPath"] = serde_json::Value::String(sprite_name.to_string());
    fs::write(
        manifest_path,
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("Only HTTPS Petdex assets are supported.".to_string());
    }

    let response = reqwest::blocking::Client::builder()
        .user_agent("CodexPetDesk/1.0")
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|error| error.to_string())
}

fn safe_slug(slug: &str) -> String {
    let safe = slug
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if safe.is_empty() {
        "petdex-pet".to_string()
    } else {
        safe
    }
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            create_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_pet_storage_dir,
            fetch_petdex_pets,
            hook_status,
            install_code_hooks,
            install_petdex_pet,
            list_codex_pets,
            test_hook_bubble,
            take_hook_events
        ])
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
                let _ = open_or_focus_control_window(
                    app,
                    SETTINGS_WINDOW_LABEL,
                    "Codex Pet Desk Settings",
                    "index.html?settings=1&page=settings",
                );
            }
            MENU_OPEN_PETS => {
                let _ = open_or_focus_control_window(
                    app,
                    PETS_WINDOW_LABEL,
                    "Codex Pet Desk Pets",
                    "index.html?settings=1&page=pets",
                );
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
        .text(MENU_OPEN_PETS, "Pets")
        .text(MENU_TOGGLE_PET, visibility_label)
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()
        .expect("failed to build tray menu")
}

fn open_or_focus_control_window(
    app_handle: &tauri::AppHandle,
    label: &str,
    title: &str,
    url: &str,
) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(label) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app_handle, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(720.0, 480.0)
        .min_inner_size(520.0, 360.0)
        .resizable(true)
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
