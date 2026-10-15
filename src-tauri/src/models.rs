use serde::{Deserialize, Serialize};

/// A quiz question as consumed by the frontend. Field names are serialized in
/// camelCase to match the existing `Question` value object in `src/js`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    #[serde(default)]
    pub id: i64,
    /// "builtin" or "imported".
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(rename = "type")]
    pub qtype: String,
    pub text: String,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    /// Either a numeric index (multiple choice) or a string (scramble).
    pub correct_answer: serde_json::Value,
    #[serde(default)]
    pub accepted_answers: Vec<String>,
    #[serde(default)]
    pub explanation: String,
}

fn default_source() -> String {
    "builtin".to_string()
}

/// Settings returned to the frontend. Serialized in camelCase to match
/// `QuizApi.getSettings()` in `src/js/api.js`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub timer_default: i64,
    pub question_count_default: String,
    pub shuffle_choices_default: bool,
    /// "normal" or "advanced".
    pub level_default: String,
    /// Whether synthesized sound cues are enabled.
    pub sound_default: bool,
    /// Whether looping background music is enabled.
    pub bgm_default: bool,
    /// Background-music volume as a percentage (0-100).
    pub bgm_volume_default: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            timer_default: 0,
            question_count_default: "40".to_string(),
            shuffle_choices_default: false,
            level_default: "normal".to_string(),
            sound_default: true,
            bgm_default: true,
            bgm_volume_default: 80,
        }
    }
}

/// Aggregate attempt statistics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: i64,
    pub correct: i64,
}

/// A persisted quiz team used for the quizmaster leaderboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    /// The team's best single-game score. Never decreases.
    #[serde(default)]
    pub score: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_serialize_to_camel_case() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        let obj = json.as_object().unwrap();

        // The frontend (src/js/api.js applySettings) reads camelCase keys.
        for key in [
            "timerDefault",
            "questionCountDefault",
            "shuffleChoicesDefault",
            "levelDefault",
            "soundDefault",
            "bgmDefault",
            "bgmVolumeDefault",
        ] {
            assert!(obj.contains_key(key), "missing camelCase key: {}", key);
        }

        assert_eq!(json["levelDefault"], "normal");
        assert_eq!(json["soundDefault"], true);
        assert_eq!(json["bgmDefault"], true);
        assert_eq!(json["bgmVolumeDefault"], 80);
    }

    #[test]
    fn question_serializes_type_and_camel_case() {
        let q = Question {
            id: 1,
            source: "builtin".into(),
            qtype: "multiple-choice".into(),
            text: "Q?".into(),
            options: Some(vec!["A".into()]),
            correct_answer: serde_json::json!(0),
            accepted_answers: vec![],
            explanation: String::new(),
        };

        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["type"], "multiple-choice");
        assert_eq!(json["correctAnswer"], 0);
        assert_eq!(json["acceptedAnswers"].as_array().unwrap().len(), 0);
    }
}
