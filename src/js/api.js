/**
 * QuizApi
 * -----------------------------------------------------------
 * Thin async wrapper around the Tauri Rust commands that back the quiz
 * with SQLite. All persistence (questions, imports, attempts, settings)
 * goes through here so the rest of the app stays storage-agnostic.
 *
 * When running outside Tauri (e.g. the Node logic tests or a plain
 * browser) `isAvailable()` returns false and callers fall back to the
 * in-memory bank.
 */
window.QuizApi = {
  /** Resolves the Tauri invoke function, or null when unavailable. */
  _invoke() {
    const tauri = window.__TAURI__;
    if (tauri && tauri.core && typeof tauri.core.invoke === "function") {
      return tauri.core.invoke;
    }
    return null;
  },

  /** True when the app is running inside the Tauri shell. */
  isAvailable() {
    return this._invoke() !== null;
  },

  async _call(command, args) {
    const invoke = this._invoke();
    if (!invoke) {
      throw new Error(`Tauri is not available (tried to call ${command}).`);
    }
    return invoke(command, args || {});
  },

  /** All questions (built-in + imported). */
  getQuestions() {
    return this._call("get_questions");
  },

  /** Inserts imported questions; returns them with assigned ids/source. */
  addQuestions(questions) {
    return this._call("add_questions", { questions });
  },

  /** Removes all imported questions. Returns the number removed. */
  clearImported() {
    return this._call("clear_imported");
  },

  /** Records one attempt (fire-and-forget). */
  recordAttempt(questionId, given, isCorrect) {
    return this._call("record_attempt", {
      questionId,
      given: given === null || given === undefined ? null : String(given),
      isCorrect: Boolean(isCorrect)
    });
  },

  /** Aggregate attempt statistics: { total, correct }. */
  getStats() {
    return this._call("get_stats");
  },

  /** Clears all recorded attempts. */
  resetAttempts() {
    return this._call("reset_attempts");
  },

  /** Persisted settings: { timerDefault, questionCountDefault, shuffleChoicesDefault, levelDefault, soundDefault, bgmDefault, bgmVolumeDefault }. */
  getSettings() {
    return this._call("get_settings");
  },

  /** Persists a single setting. */
  setSetting(key, value) {
    return this._call("set_setting", { key, value: String(value) });
  },

  /** True when at least one user is registered (backend only). */
  hasUsers() {
    return this._call("has_users");
  },

  /** Registers the first user account. */
  register(username, password) {
    return this._call("register", { username, password });
  },

  /** Signs a user in. */
  login(username, password) {
    return this._call("login", { username, password });
  },

  getTeams() {
    return this._call("get_teams");
  },

  addTeam(name) {
    return this._call("add_team", { name });
  },

  /** Deletes a team (and its score) by name. */
  removeTeam(name) {
    return this._call("remove_team", { name });
  },

  /** Stores a team's best score (never decreases). */
  setTeamScore(name, score) {
    return this._call("set_team_score", { name, score: Math.max(0, Number(score) || 0) });
  },

  /** Saves the import template to the default Downloads folder; returns its path. */
  saveTemplateToDownloads(contents) {
    return this._call("save_template_to_downloads", { contents });
  },

  /** Saves the import template to an explicit path. */
  saveTemplateFile(path, contents) {
    return this._call("save_template_file", { path, contents });
  },

  /** Opens a file with the OS default application. */
  openFile(path) {
    return this._call("open_file", { path });
  }
};
