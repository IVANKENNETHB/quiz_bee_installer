use crate::models::{Question, Team};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

/// Settings key holding the fingerprint of the bundled built-in seed.
const SEED_VERSION_KEY: &str = "builtin_seed_version";

/// A stable fingerprint of the bundled `seed_questions.json` contents.
fn seed_version() -> String {
    let mut hasher = DefaultHasher::new();
    include_str!("../seed_questions.json").hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Opens (or creates) the SQLite database, applies the schema and seeds the
/// built-in question bank on first run.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    init_schema(&conn)?;
    seed_builtin(&conn)?;
    Ok(conn)
}

/// Creates the tables if they do not already exist.
pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS questions (
            id               INTEGER PRIMARY KEY,
            source           TEXT NOT NULL DEFAULT 'builtin',
            type             TEXT NOT NULL,
            text             TEXT NOT NULL,
            options          TEXT,
            correct_answer   TEXT NOT NULL,
            accepted_answers TEXT NOT NULL DEFAULT '[]',
            explanation      TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS teams (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            score       INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS attempts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            given       TEXT,
            is_correct  INTEGER NOT NULL,
            answered_at TEXT NOT NULL
        );
        ",
    )?;

    // Databases created before team scores existed miss the column; add it
    // without touching existing rows.
    ensure_column(conn, "teams", "score", "INTEGER NOT NULL DEFAULT 0")?;

    Ok(())
}

/// Adds `column` to `table` when it is missing (idempotent migration helper).
fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut exists = false;
    let mut rows = stmt.query([])?;

    while let Some(row) = rows.next()? {
        let name: String = row.get("name")?;

        if name == column {
            exists = true;
            break;
        }
    }

    if !exists {
        conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition),
            [],
        )?;
    }

    Ok(())
}

/// Seeds the built-in bank on first run and re-syncs it whenever the bundled
/// `seed_questions.json` changes. User-imported questions are preserved.
///
/// Old builds only inserted the built-in rows when the table was empty, so
/// edited seed data (for example shortened scramble answers) never reached
/// databases that had already been created. Storing a fingerprint of the seed
/// lets every install pick up new or corrected built-in questions.
fn seed_builtin(conn: &Connection) -> rusqlite::Result<()> {
    let version = seed_version();

    if get_setting(conn, SEED_VERSION_KEY)?.as_deref() == Some(version.as_str()) {
        return Ok(());
    }

    let seed: Vec<Question> =
        serde_json::from_str(include_str!("../seed_questions.json")).expect("seed_questions.json is valid");

    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM questions WHERE source = 'builtin'", [])?;
    for q in &seed {
        insert_builtin_question(&tx, q)?;
    }
    tx.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SEED_VERSION_KEY, version],
    )?;
    tx.commit()?;
    Ok(())
}

/// Inserts a built-in question preserving the id declared in the seed file.
fn insert_builtin_question(conn: &Connection, q: &Question) -> rusqlite::Result<()> {
    let options_json = match &q.options {
        Some(opts) => Some(serde_json::to_string(opts).unwrap()),
        None => None,
    };
    let correct_json = serde_json::to_string(&q.correct_answer).unwrap();
    let accepted_json = serde_json::to_string(&q.accepted_answers).unwrap();

    conn.execute(
        "INSERT INTO questions (id, source, type, text, options, correct_answer, accepted_answers, explanation)
         VALUES (?1, 'builtin', ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            q.id,
            q.qtype,
            q.text,
            options_json,
            correct_json,
            accepted_json,
            q.explanation
        ],
    )?;

    Ok(())
}

/// Inserts a single question and returns it with the assigned id.
pub fn insert_question(conn: &Connection, source: &str, q: &Question) -> rusqlite::Result<Question> {
    let options_json = match &q.options {
        Some(opts) => Some(serde_json::to_string(opts).unwrap()),
        None => None,
    };
    let correct_json = serde_json::to_string(&q.correct_answer).unwrap();
    let accepted_json = serde_json::to_string(&q.accepted_answers).unwrap();

    conn.execute(
        "INSERT INTO questions (source, type, text, options, correct_answer, accepted_answers, explanation)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            source,
            q.qtype,
            q.text,
            options_json,
            correct_json,
            accepted_json,
            q.explanation
        ],
    )?;

    let mut inserted = q.clone();
    inserted.id = conn.last_insert_rowid();
    inserted.source = source.to_string();
    Ok(inserted)
}

/// Maps a DB row into a `Question` for the frontend.
fn row_to_question(row: &rusqlite::Row) -> rusqlite::Result<Question> {
    let options_json: Option<String> = row.get("options")?;
    let correct_json: String = row.get("correct_answer")?;
    let accepted_json: String = row.get("accepted_answers")?;

    let options = options_json.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok());
    let correct_answer: serde_json::Value =
        serde_json::from_str(&correct_json).unwrap_or(serde_json::Value::Null);
    let accepted_answers: Vec<String> = serde_json::from_str(&accepted_json).unwrap_or_default();

    Ok(Question {
        id: row.get("id")?,
        source: row.get("source")?,
        qtype: row.get("type")?,
        text: row.get("text")?,
        options,
        correct_answer,
        accepted_answers,
        explanation: row.get("explanation")?,
    })
}

/// Returns every question (built-in + imported), ordered by id.
pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<Question>> {
    let mut stmt = conn.prepare(
        "SELECT id, source, type, text, options, correct_answer, accepted_answers, explanation
         FROM questions ORDER BY id ASC",
    )?;

    let rows = stmt.query_map([], |row| row_to_question(row))?;
    rows.collect()
}

/// Removes all user-imported questions; the built-in bank is untouched.
pub fn clear_imported(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM questions WHERE source = 'imported'", [])
}

/// Records a single attempt.
pub fn record_attempt(
    conn: &Connection,
    question_id: i64,
    given: Option<String>,
    is_correct: bool,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO attempts (question_id, given, is_correct, answered_at) VALUES (?1, ?2, ?3, ?4)",
        params![question_id, given, if is_correct { 1 } else { 0 }, now],
    )?;
    Ok(())
}

/// Reads a setting value, falling back to `None` when unset.
pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

/// Upserts a setting value.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Inserts a team, or returns the existing one if the name is already taken.
pub fn add_team(conn: &Connection, name: &str) -> rusqlite::Result<Team> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO teams (name, created_at) VALUES (?1, ?2)",
        params![name, now],
    )?;

    conn.query_row(
        "SELECT id, name, score FROM teams WHERE name = ?1",
        params![name],
        |row| Ok(Team { id: row.get(0)?, name: row.get(1)?, score: row.get(2)? }),
    )
}

/// Returns all saved teams ordered by name.
pub fn get_teams(conn: &Connection) -> rusqlite::Result<Vec<Team>> {
    let mut stmt = conn.prepare("SELECT id, name, score FROM teams ORDER BY name ASC")?;
    let rows = stmt.query_map([], |row| {
        Ok(Team {
            id: row.get(0)?,
            name: row.get(1)?,
            score: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// Removes a team (and its score) by name.
pub fn remove_team(conn: &Connection, name: &str) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM teams WHERE name = ?1", params![name])
}

/// Sets a team's best score. The stored score never decreases.
pub fn set_team_score(conn: &Connection, name: &str, score: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE teams SET score = MAX(score, ?2) WHERE name = ?1",
        params![name, score],
    )?;

    Ok(())
}

/// Aggregate attempt totals.
pub fn get_stats(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(is_correct), 0) FROM attempts",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

/// Deletes every recorded attempt.
pub fn reset_attempts(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM attempts", [])
}

/// True when at least one user is registered. Used to decide between the
/// registration and sign-in screens on startup.
pub fn has_users(conn: &Connection) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;

    Ok(count > 0)
}

/// Inserts a user together with the password digest computed by the caller.
pub fn create_user(conn: &Connection, username: &str, password_hash: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?1, ?2, datetime('now'))",
        params![username, password_hash],
    )?;

    Ok(())
}

/// Compares a password digest against the stored one. Returns false when the
/// username is unknown or when the password does not match.
pub fn verify_user(conn: &Connection, username: &str, password_hash: &str) -> rusqlite::Result<bool> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT password_hash FROM users WHERE username = ?1",
            params![username],
            |row| row.get("password_hash"),
        )
        .optional()?;

    Ok(stored.as_deref() == Some(password_hash))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> Connection {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "quizbee_test_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        let conn = Connection::open(&path).unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    fn mcq(id: i64) -> Question {
        Question {
            id,
            source: "builtin".to_string(),
            qtype: "multiple-choice".to_string(),
            text: "Sample?".to_string(),
            options: Some(vec!["A".into(), "B".into()]),
            correct_answer: serde_json::json!(0),
            accepted_answers: vec![],
            explanation: "because".to_string(),
        }
    }

    fn scramble(id: i64) -> Question {
        Question {
            id,
            source: "builtin".to_string(),
            qtype: "scramble".to_string(),
            text: "Term?".to_string(),
            options: None,
            correct_answer: serde_json::json!("Phishing"),
            accepted_answers: vec!["phishing".into()],
            explanation: "".to_string(),
        }
    }

    #[test]
    fn seeds_all_builtin_questions() {
        let conn = temp_db();
        seed_builtin(&conn).unwrap();
        let all = list_all(&conn).unwrap();
        assert_eq!(all.len(), 56);
        assert_eq!(all[0].id, 1);
        assert_eq!(all[0].qtype, "multiple-choice");
        assert!(all[0].options.as_ref().unwrap().len() == 4);
    }

    #[test]
    fn seed_is_idempotent() {
        let conn = temp_db();
        seed_builtin(&conn).unwrap();
        seed_builtin(&conn).unwrap();
        assert_eq!(list_all(&conn).unwrap().len(), 56);
    }

    #[test]
    fn resyncs_builtin_when_seed_changes_and_keeps_imported() {
        let conn = temp_db();

        // Simulate a database seeded by an older build whose built-in answers
        // were long/multi-word and which had no stored seed fingerprint.
        conn.execute(
            "INSERT INTO questions (id, source, type, text, options, correct_answer, accepted_answers, explanation)
             VALUES (29, 'builtin', 'scramble', 'old prompt', NULL, '\"Multi-factor authentication (MFA)\"', '[\"mfa\"]', '')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO questions (id, source, type, text, options, correct_answer, accepted_answers, explanation)
             VALUES (41, 'imported', 'scramble', 'keep me', NULL, '\"Firewall\"', '[\"firewall\"]', '')",
            [],
        )
        .unwrap();

        seed_builtin(&conn).unwrap();

        let all = list_all(&conn).unwrap();
        let builtin: Vec<&Question> = all.iter().filter(|q| q.source == "builtin").collect();

        // Built-in bank was fully refreshed...
        assert_eq!(builtin.len(), 56);
        let q29 = all.iter().find(|q| q.id == 29).unwrap();
        assert_eq!(q29.correct_answer, serde_json::json!("Token"));
        // ...and the stale long answer is gone.
        assert!(all
            .iter()
            .all(|q| q.correct_answer != serde_json::json!("Multi-factor authentication (MFA)")));

        // ...while imported questions are preserved.
        assert!(all.iter().any(|q| q.source == "imported" && q.text == "keep me"));
    }

    #[test]
    fn round_trips_answer_types() {
        let conn = temp_db();
        seed_builtin(&conn).unwrap();
        let all = list_all(&conn).unwrap();

        let mc = all.iter().find(|q| q.id == 1).unwrap();
        assert_eq!(mc.correct_answer, serde_json::json!(0));

        let id_q = all.iter().find(|q| q.qtype == "scramble").unwrap();
        assert!(id_q.correct_answer.is_string());
        assert!(id_q.options.is_none());
    }

    #[test]
    fn import_add_and_clear_keeps_builtin() {
        let conn = temp_db();
        seed_builtin(&conn).unwrap();

        let inserted = insert_question(&conn, "imported", &mcq(0)).unwrap();
        assert!(inserted.id > 1016);
        insert_question(&conn, "imported", &scramble(0)).unwrap();
        assert_eq!(list_all(&conn).unwrap().len(), 58);

        let removed = clear_imported(&conn).unwrap();
        assert_eq!(removed, 2);
        assert_eq!(list_all(&conn).unwrap().len(), 56);
    }

    #[test]
    fn settings_upsert_and_defaults() {
        let conn = temp_db();
        assert!(get_setting(&conn, "timer_default").unwrap().is_none());

        set_setting(&conn, "timer_default", "30").unwrap();
        assert_eq!(get_setting(&conn, "timer_default").unwrap().unwrap(), "30");

        set_setting(&conn, "timer_default", "15").unwrap();
        assert_eq!(get_setting(&conn, "timer_default").unwrap().unwrap(), "15");
    }

    #[test]
    fn records_and_resets_attempts() {
        let conn = temp_db();
        record_attempt(&conn, 1, Some("0".into()), true).unwrap();
        record_attempt(&conn, 2, None, false).unwrap();

        let (total, correct) = get_stats(&conn).unwrap();
        assert_eq!(total, 2);
        assert_eq!(correct, 1);

        reset_attempts(&conn).unwrap();
        let (total, correct) = get_stats(&conn).unwrap();
        assert_eq!(total, 0);
        assert_eq!(correct, 0);
    }

    #[test]
    fn deserializes_frontend_payload_and_imports() {
        let conn = temp_db();
        seed_builtin(&conn).unwrap();

        // Shape sent by src/js/api.js: camelCase keys, null options for
        // scramble, numeric or string correctAnswer.
        let payload = r#"[
            {
                "type": "multiple-choice",
                "text": "Imported MCQ?",
                "options": ["A", "B", "C", "D"],
                "correctAnswer": 2,
                "acceptedAnswers": [],
                "explanation": "because"
            },
            {
                "type": "scramble",
                "text": "Imported ID?",
                "options": null,
                "correctAnswer": "Firewall",
                "acceptedAnswers": ["firewall"],
                "explanation": ""
            }
        ]"#;

        let questions: Vec<Question> = serde_json::from_str(payload).unwrap();
        assert_eq!(questions.len(), 2);
        assert_eq!(questions[0].correct_answer, serde_json::json!(2));
        assert_eq!(questions[1].correct_answer, serde_json::json!("Firewall"));
        assert!(questions[1].options.is_none());

        for q in &questions {
            let inserted = insert_question(&conn, "imported", q).unwrap();
            assert_eq!(inserted.source, "imported");
        }

        let all = list_all(&conn).unwrap();
        assert_eq!(all.len(), 58);
        assert_eq!(
            all.iter().filter(|q| q.source == "imported").count(),
            2
        );
    }

    #[test]
    fn adds_and_retrieves_teams() {
        let conn = temp_db();

        let team = add_team(&conn, "Alpha").unwrap();
        assert_eq!(team.name, "Alpha");
        assert_eq!(team.score, 0);
        assert!(team.id > 0);

        add_team(&conn, "Beta").unwrap();
        add_team(&conn, "Gamma").unwrap();

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 3);

        let names: Vec<&str> = teams.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"Alpha"));
        assert!(names.contains(&"Beta"));
        assert!(names.contains(&"Gamma"));
    }

    #[test]
    fn add_team_is_idempotent_for_duplicate_name() {
        let conn = temp_db();

        let first = add_team(&conn, "Alpha").unwrap();
        let second = add_team(&conn, "Alpha").unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(first.name, second.name);

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
    }

    #[test]
    fn set_team_score_keeps_the_highest_value() {
        let conn = temp_db();
        add_team(&conn, "Alpha").unwrap();

        set_team_score(&conn, "Alpha", 7).unwrap();
        let team = add_team(&conn, "Alpha").unwrap();
        assert_eq!(team.score, 7);

        // A lower score must not overwrite the best.
        set_team_score(&conn, "Alpha", 4).unwrap();
        let team = add_team(&conn, "Alpha").unwrap();
        assert_eq!(team.score, 7);

        // A higher score replaces it.
        set_team_score(&conn, "Alpha", 9).unwrap();
        let team = add_team(&conn, "Alpha").unwrap();
        assert_eq!(team.score, 9);
    }

    #[test]
    fn remove_team_deletes_the_row_and_score() {
        let conn = temp_db();
        add_team(&conn, "Alpha").unwrap();
        add_team(&conn, "Beta").unwrap();
        set_team_score(&conn, "Alpha", 5).unwrap();

        let removed = remove_team(&conn, "Alpha").unwrap();
        assert_eq!(removed, 1);

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].name, "Beta");

        assert_eq!(remove_team(&conn, "Alpha").unwrap(), 0);
    }

    #[test]
    fn migrates_legacy_teams_without_score_column() {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "quizbee_legacy_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        let conn = Connection::open(&path).unwrap();

        // Simulate an old database missing the score column.
        conn.execute_batch(
            "CREATE TABLE teams (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );
            INSERT INTO teams (name, created_at) VALUES ('Alpha', '2024-01-01T00:00:00Z');",
        )
        .unwrap();

        init_schema(&conn).unwrap();

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].name, "Alpha");
        assert_eq!(teams[0].score, 0);

        set_team_score(&conn, "Alpha", 3).unwrap();
        assert_eq!(get_teams(&conn).unwrap()[0].score, 3);
    }

    #[test]
    fn has_users_reflects_registration() {
        let conn = temp_db();

        assert!(!has_users(&conn).unwrap());

        create_user(&conn, "admin", "admin-hash").unwrap();
        assert!(has_users(&conn).unwrap());

        create_user(&conn, "teacher", "teacher-hash").unwrap();
        assert!(has_users(&conn).unwrap());
    }

    #[test]
    fn verify_user_accepts_only_the_matching_digest() {
        let conn = temp_db();
        create_user(&conn, "admin", "admin-hash").unwrap();

        assert!(verify_user(&conn, "admin", "admin-hash").unwrap());
        assert!(!verify_user(&conn, "admin", "teacher-hash").unwrap());
        assert!(!verify_user(&conn, "guest", "admin-hash").unwrap());
    }

    #[test]
    fn create_user_rejects_a_taken_username() {
        let conn = temp_db();
        create_user(&conn, "admin", "admin-hash").unwrap();

        let error = create_user(&conn, "admin", "other-hash").unwrap_err();
        assert!(error.to_string().contains("UNIQUE"));
    }
}
