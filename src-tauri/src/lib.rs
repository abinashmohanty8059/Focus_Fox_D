use std::collections::HashMap;
use std::fs;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn load_env() -> HashMap<String, String> {
    let mut env_vars = HashMap::new();
    
    // Check multiple directories to locate the .env file
    let paths = vec![
        std::path::PathBuf::from(".env"),
        std::path::PathBuf::from("../.env"),
        std::path::PathBuf::from("../../.env"),
        std::path::PathBuf::from("src-tauri/.env"),
    ];

    let mut content = None;
    for path in paths {
        if let Ok(text) = fs::read_to_string(&path) {
            content = Some(text);
            break;
        }
    }

    // If still not found, check alongside the running executable
    if content.is_none() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let exe_env = exe_dir.join(".env");
                if let Ok(text) = fs::read_to_string(&exe_env) {
                    content = Some(text);
                }
            }
        }
    }

    if let Some(content) = content {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                env_vars.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }
    
    // Fallback: Also check system environment variables
    let keys = vec!["SUPABASE_URL", "SUPABASE_KEY", "GEMINI_API_KEY", "DRIVE_API_KEY"];
    for key in keys {
        if !env_vars.contains_key(key) {
            if let Ok(val) = std::env::var(key) {
                env_vars.insert(key.to_string(), val);
            }
        }
    }
    
    env_vars
}

#[tauri::command]
async fn supabase_request(url: String, key: String, endpoint: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let full_url = format!("{}/rest/v1/{}", url, endpoint);
    
    println!("Rust proxying Supabase request: {}", endpoint);

    let res = client.get(&full_url)
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .send()
        .await
        .map_err(|e| e.to_string())?;
        
    let status = res.status();
    if !status.is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Supabase API returned code {}: {}", status, err_text));
    }
    
    let json = res.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
        
    Ok(json)
}

#[tauri::command]
fn list_music_files() -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let music_dir = std::path::PathBuf::from("music");
    
    // Create music directory in CWD if it doesn't exist
    if !music_dir.exists() {
        let _ = fs::create_dir_all(&music_dir);
    }
    
    if let Ok(entries) = fs::read_dir(&music_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        let ext_str = ext.to_string_lossy().to_lowercase();
                        if ext_str == "mp3" || ext_str == "wav" || ext_str == "ogg" || ext_str == "m4a" {
                            if let Ok(abs_path) = fs::canonicalize(&path) {
                                if let Some(abs_str) = abs_path.to_str() {
                                    // Strip Windows UNC prefix if present
                                    let clean_path = if abs_str.starts_with(r"\\?\") {
                                        abs_str[4..].to_string()
                                    } else {
                                        abs_str.to_string()
                                    };
                                    files.push(clean_path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, load_env, supabase_request, list_music_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
