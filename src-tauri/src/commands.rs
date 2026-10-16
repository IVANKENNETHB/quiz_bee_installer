use crate::db;
use crate::models::{Question, Settings, Stats, Team};
use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::SaltString;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub conn: Mutex<Connection>,
}

/// Hashes a plain-text password with Argon2id so the database only ever
/// stores a digest.
fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut rand::rngs::OsRng);
    let hashed = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| format!("could not hash password: {error}"))?;

    Ok(hashed.to_string())
}

/// Returns every question (built-in + imported).
#[tauri::command]
pub fn get_questions(state: State<'_, AppState>) -> Result<Vec<Question>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::list_all(&conn).map_err(|e| e.to_string())
}

/// Inserts imported questions and returns them with assigned ids.
#[tauri::command]
pub fn add_questions(
    state: State<'_, AppState>,
    questions: Vec<Question>,
) -> Result<Vec<Question>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let mut inserted = Vec::with_capacity(questions.len());
    for q in &questions {
        inserted.push(db::insert_question(&tx, "imported", q).map_err(|e| e.to_string())?);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

/// Removes all user-imported questions.
#[tauri::command]
pub fn clear_imported(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::clear_imported(&conn).map_err(|e| e.to_string())
}

/// Records one quiz attempt.
#[tauri::command]
pub fn record_attempt(
    state: State<'_, AppState>,
    question_id: i64,
    given: Option<String>,
    is_correct: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::record_attempt(&conn, question_id, given, is_correct).map_err(|e| e.to_string())
}

/// Returns aggregate attempt statistics.
#[tauri::command]
pub fn get_stats(state: State<'_, AppState>) -> Result<Stats, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let (total, correct) = db::get_stats(&conn).map_err(|e| e.to_string())?;
    Ok(Stats { total, correct })
}

/// Clears all recorded attempts.
#[tauri::command]
pub fn reset_attempts(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::reset_attempts(&conn).map_err(|e| e.to_string())
}

/// Reads persisted app settings, applying defaults for missing keys.
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let defaults = Settings::default();

    let timer_default = db::get_setting(&conn, "timer_default")
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(defaults.timer_default);

    let question_count_default = db::get_setting(&conn, "question_count_default")
        .map_err(|e| e.to_string())?
        .unwrap_or(defaults.question_count_default);

    let shuffle_choices_default = db::get_setting(&conn, "shuffle_choices_default")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(defaults.shuffle_choices_default);

    let level_default = db::get_setting(&conn, "level_default")
        .map_err(|e| e.to_string())?
        .unwrap_or(defaults.level_default);

    let sound_default = db::get_setting(&conn, "sound_default")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(defaults.sound_default);

    let bgm_default = db::get_setting(&conn, "bgm_default")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(defaults.bgm_default);

    let bgm_volume_default = db::get_setting(&conn, "bgm_volume_default")
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse::<i64>().ok())
        .map(|v| v.clamp(0, 100))
        .unwrap_or(defaults.bgm_volume_default);

    Ok(Settings {
        timer_default,
        question_count_default,
        shuffle_choices_default,
        level_default,
        sound_default,
        bgm_default,
        bgm_volume_default,
    })
}

/// Persists a single setting key/value pair.
#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

/// True when at least one user is registered. Used to decide whether the app
/// should show the registration or sign-in screen on startup.
#[tauri::command]
pub fn has_users(state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    db::has_users(&conn).map_err(|e| e.to_string())
}

/// Registers the first user account.
#[tauri::command]
pub fn register(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let password_hash = hash_password(&password).map_err(|e| e.to_string())?;

    db::create_user(&conn, &username, &password_hash).map_err(|e| e.to_string())?;
    Ok(())
}

/// Signs a user in. Fails when the username or the password is wrong.
#[tauri::command]
pub fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let password_hash = hash_password(&password).map_err(|e| e.to_string())?;

    let matches = db::verify_user(&conn, &username, &password_hash).map_err(|e| e.to_string())?;

    if !matches {
        return Err("Invalid username or password.".to_string());
    }

    Ok(())
}

/// Inserts a team into the database, or returns the existing one if the name is taken.
#[tauri::command]
pub fn add_team(state: State<'_, AppState>, name: String) -> Result<Team, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::add_team(&conn, &name).map_err(|e| e.to_string())
}

/// Returns all saved teams ordered by name.
#[tauri::command]
pub fn get_teams(state: State<'_, AppState>) -> Result<Vec<Team>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::get_teams(&conn).map_err(|e| e.to_string())
}

/// Deletes a team (and its score) by name.
#[tauri::command]
pub fn remove_team(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::remove_team(&conn, &name).map_err(|e| e.to_string())?;
    Ok(())
}

/// Stores a team's best score (never decreases).
#[tauri::command]
pub fn set_team_score(state: State<'_, AppState>, name: String, score: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::set_team_score(&conn, &name, score).map_err(|e| e.to_string())
}

/// Resolves the user's Downloads folder, creating it if necessary.
fn default_download_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "Could not determine the home directory.".to_string())?;

    let dir = std::path::PathBuf::from(home).join("Downloads");

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    Ok(dir)
}

/// Saves the import template to the default Downloads folder.
#[tauri::command]
pub fn save_template_to_downloads(contents: String) -> Result<String, String> {
    let path = default_download_dir()?.join("quiz-questions-template.csv");

    std::fs::write(&path, contents).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

/// Saves the import template to an explicit path chosen by the user.
#[tauri::command]
pub fn save_template_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Opens a file with the operating system's default application.
#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
