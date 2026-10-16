/**
 * QuizApp
 * -----------------------------------------------------------
 * The single coordinator ("mediator") for the whole site. It owns the
 * Quiz, Timer and Scoreboard, renders the three screens, and routes all
 * user interaction through one action switch. Event listeners are bound
 * exactly once; dynamic content relies on event delegation so no
 * duplicate handlers are ever created.
 */
class QuizApp {
  /**
   * Difficulty levels. Each level restricts which question types are in
   * play and caps how many questions a single round may use.
   */
  static get LEVELS() {
    return {
      normal: {
        label: "Normal",
        types: [Question.TYPE_MULTIPLE_CHOICE],
        max: Number.MAX_SAFE_INTEGER,
      },
      advanced: {
        label: "Advanced",
        types: [Question.TYPE_MULTIPLE_CHOICE, Question.TYPE_SCRAMBLE],
        max: Number.MAX_SAFE_INTEGER,
      }
    };
  }

  constructor(allQuestions) {
    const list = Array.isArray(allQuestions) ? allQuestions : [];
    const builtins = list.filter((data) => data && data.source !== "imported");
    const imported = list.filter((data) => data && data.source === "imported");

    this.baseQuestions = builtins.map((data) => new Question(data));
    this.importedQuestions = imported.map((data) => new Question(data));
    this.questions = [];
    this.quiz = new Quiz([]);
    this.rebuildBank();

    this.scoreboard = new Scoreboard();

    this.mode = "practice";
    this.questionSeconds = 0;
    this.teamsDraft = [];
    // Best score per team, kept independent of the Scoreboard instance so it
    // survives practice sessions replacing the board.
    this.teamBestScores = new Map();
    // Name of the team answering the current quizmaster session (fixed for
    // the whole quiz). Chosen in the lobby.
    this.answeringTeam = "";

    this.currentResponse = null;
    this.answered = false;
    this.revealed = false;
    this.responses = new Map();

    // Unsubmitted scramble drafts, keyed by question index. Kept apart
    // from currentResponse (which renderQuestion rebuilds per question).
    this.drafts = new Map();

    // Per-index remaining clock, so paging backward cannot refill the timer.
    this.remainingByIndex = new Map();

    this.suspendTimerStart = false;
    this.countdownActive = false;
    this.countdownHandle = null;

    // Pending "advance after time is up" callback. Must be cancelled whenever
    // the session ends, otherwise it keeps rendering into a finished quiz.
    this.autoAdvanceHandle = null;

    this.reviewFilter = "all";
    this.importStatusHandle = null;

    // Active screen tracking, used to return from the Settings page.
    this.currentScreen = "home";
    this.previousScreen = "home";
    this.timerPausedForSettings = false;

    // Authentication gates the whole app. False until a user has registered
    // or signed in during this session.
    this.authenticated = false;

    // Sound effects (see js/sound.js). Mirrored on the Home toggle.
    this.soundEnabled = true;
    // Background music. Controlled by the Home toggle + volume slider.
    this.bgmEnabled = true;
    this.bgmVolume = 0.8;
    this.bgmUnlockArmed = false;

    // In-flight confirmation modal resolver, if any.
    this.confirmResolver = null;
    this.confirmReturnFocus = null;
    this.templateOpen = false;
    this.templateReturnFocus = null;

    this.timer = new Timer({
      duration: 0,
      onTick: (remaining, duration) => this.updateTimerDisplay(remaining, duration),
      onTimeUp: () => this.handleTimeUp()
    });

    this.dom = this.cacheDom();
    this.init();
  }

  /* ===================== Initialization ===================== */

  cacheDom() {
    const byId = (id) => document.getElementById(id);

    return {
      screens: {
        home: byId("screen-home"),
        lobby: byId("screen-lobby"),
        quiz: byId("screen-quiz"),
        results: byId("screen-results"),
        settings: byId("screen-settings"),
        login: byId("screen-login"),
        register: byId("screen-register")
      },
      // Home
      modeGroup: byId("mode-group"),
      modeHelp: byId("mode-help"),
      levelGroup: byId("level-group"),
      levelHelp: byId("level-help"),
      countHelp: byId("count-help"),
      startBtn: byId("start-btn"),
      countGroup: byId("count-group"),
      countAllOption: byId("count-all-option"),
      countAllLabel: byId("count-all-label"),
      // Lobby
      teamsPanel: byId("teams-panel"),
      teamNameInput: byId("team-name-input"),
      teamList: byId("team-list"),
      teamError: byId("team-error"),
      lobbyScoreList: byId("lobby-score-list"),
      lobbyAwardTeam: byId("lobby-award-team"),
      lobbyStartBtn: byId("lobby-start-btn"),
      lobbyStartHint: byId("lobby-start-hint"),
      shuffleChoices: byId("shuffle-choices"),
      soundToggle: byId("sound-toggle"),
      bgmToggle: byId("bgm-toggle"),
      bgm: byId("bgm"),
      bgmVolume: byId("bgm-volume"),
      bgmVolumeValue: byId("bgm-volume-value"),
      bankTotal: byId("bank-total"),
      bankMc: byId("bank-mc"),
      bankId: byId("bank-id"),
      importFile: byId("import-file"),
      importStatus: byId("import-status"),
      // Quiz
      progressText: byId("progress-text"),
      progressTrack: byId("progress-track"),
      progressFill: byId("progress-fill"),
      scoreLabel: byId("score-label"),
      scoreText: byId("score-text"),
      timerChip: byId("timer-chip"),
      timerText: byId("timer-text"),
      typeBadge: byId("type-badge"),
      questionCard: byId("question-card"),
      questionText: byId("question-text"),
      answerArea: byId("answer-area"),
      feedback: byId("feedback"),
      answerHint: byId("answer-hint"),
      answeringChip: byId("answering-chip"),
      answeringTeamText: byId("answering-team-text"),
      countdown: byId("countdown"),
      countdownValue: byId("countdown-value"),
      // Settings
      settingsOpen: byId("settings-open"),
      settingsTitle: byId("settings-title"),
      // Authentication
      loginUsername: byId("login-username"),
      loginPassword: byId("login-password"),
      loginError: byId("login-error"),
      registerUsername: byId("register-username"),
      registerPassword: byId("register-password"),
      registerConfirmPassword: byId("register-confirm-password"),
      registerError: byId("register-error"),
      // Results
      resultsTitle: byId("results-title"),
      resultsSummary: byId("results-summary"),
      resultsLeaderboard: byId("results-leaderboard"),
      retryBtn: byId("retry-incorrect-btn"),
      reviewFilter: byId("review-filter"),
      reviewList: byId("review-list"),
      // Confirmation modal
      confirmOverlay: byId("confirm-modal"),
      confirmMessage: byId("confirm-message"),
      confirmOk: byId("confirm-ok"),
      confirmCancel: byId("confirm-cancel"),
      // Template download modal
      templateOverlay: byId("template-modal")
    };
  }

  init() {
    this.updateBankStats();
    this.renderTeamsDraft();
    this.bindEvents();
    this.applyMode("practice");
    this.setBgmVolume(this.bgmVolume);
    this.setBgmEnabled(this.dom.bgmToggle ? this.dom.bgmToggle.checked : true);

    // Decide between the sign-in and registration screen once the backend
    // is reachable. Without the Tauri shell the app simply starts.
    void this.startAuthentication();
  }

  bindEvents() {
    // One delegated click handler for every [data-action] and every
    // multiple-choice option button. This guarantees single binding. A single
    // click only highlights a choice; the answer is committed on double-click.
    document.addEventListener("click", (event) => {
      const tile = event.target.closest(".letter-tile");

      if (tile) {
        this.moveScrambleTile(tile);
        return;
      }

      const option = event.target.closest("[data-option-index]");

      if (option) {
        this.highlightMultipleChoice(Number(option.dataset.optionIndex));
        return;
      }

      const actionEl = event.target.closest("[data-action]");

      if (actionEl) {
        this.handleQuizAction(actionEl.dataset.action, actionEl);
      }
    });

    // Double-clicking a choice commits it (the mouse equivalent of Enter).
    document.addEventListener("dblclick", (event) => {
      const option = event.target.closest("[data-option-index]");

      if (option) {
        event.preventDefault();
        this.lockMultipleChoice(Number(option.dataset.optionIndex));
      }
    });

    // Keyboard shortcuts that do not require a per-render listener.
    document.addEventListener("keydown", (event) => this.handleKeydown(event));

    // Mode switches retarget the setup screen's primary action.
    this.dom.modeGroup.addEventListener("change", () => {
      this.applyMode(this.readSetting("mode", "practice"));
    });

    // Level switches change which question types and how many are available.
    if (this.dom.levelGroup) {
      this.dom.levelGroup.addEventListener("change", () => {
        this.updateBankStats();
        this.persistSettings();
      });
    }

    // Sound effects toggle.
    if (this.dom.soundToggle) {
      this.dom.soundToggle.addEventListener("change", () => {
        this.setSoundEnabled(this.dom.soundToggle.checked, { persist: true });
      });
    }

    // Background music toggle.
    if (this.dom.bgmToggle) {
      this.dom.bgmToggle.addEventListener("change", () => {
        this.setBgmEnabled(this.dom.bgmToggle.checked, { persist: true });
      });
    }

    // Music volume slider: apply live while dragging, persist on release.
    if (this.dom.bgmVolume) {
      this.dom.bgmVolume.addEventListener("input", () => {
        this.setBgmVolume(Number(this.dom.bgmVolume.value) / 100);
      });
      this.dom.bgmVolume.addEventListener("change", () => {
        this.setBgmVolume(Number(this.dom.bgmVolume.value) / 100, { persist: true });
      });
    }

    // Lobby answering-team selector: remember the choice and re-highlight it.
    if (this.dom.lobbyAwardTeam) {
      this.dom.lobbyAwardTeam.addEventListener("change", () => {
        this.answeringTeam = this.dom.lobbyAwardTeam.value;
        this.renderLobbyLeaderboard();
      });
    }

    // Confirmation modal buttons and backdrop.
    if (this.dom.confirmOk) {
      this.dom.confirmOk.addEventListener("click", () => this.settleConfirm(true));
    }

    if (this.dom.confirmCancel) {
      this.dom.confirmCancel.addEventListener("click", () => this.settleConfirm(false));
    }

    if (this.dom.confirmOverlay) {
      this.dom.confirmOverlay.addEventListener("mousedown", (event) => {
        if (event.target === this.dom.confirmOverlay) {
          this.settleConfirm(false);
        }
      });
    }

    // Template modal backdrop dismisses the dialog.
    if (this.dom.templateOverlay) {
      this.dom.templateOverlay.addEventListener("mousedown", (event) => {
        if (event.target === this.dom.templateOverlay) {
          this.closeTemplateModal();
        }
      });
    }

    // Pressing Enter in the authentication password field submits the form.
    const passwordInputs = [
      this.dom.loginPassword,
      this.dom.registerPassword,
      this.dom.registerConfirmPassword
    ];

    passwordInputs.forEach((input) => {
      if (!input) {
        return;
      }

      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        const isLogin = this.isScreenActive("login");
        this.submitCredentials(isLogin ? "login" : "register");
      });
    });

    // File inputs do not emit delegated clicks, so bind directly.
    this.dom.importFile.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];

      this.handleImportFile(file);
      event.target.value = "";
    });
  }

  /* ===================== Action routing ===================== */

  /**
   * Central command dispatcher. Uses switch...case because the set of
   * quizmaster commands is fixed and known.
   *
   * @param {string} action
   * @param {HTMLElement} [element]
   */
  handleQuizAction(action, element) {
    if (this.countdownActive && ["next", "submit-answer"].indexOf(action) !== -1) {
      return;
    }

    switch (action) {
      case "start":
        this.startQuiz();
        break;

      case "go-to-quiz":
        this.goToQuizLobby();
        break;

      case "next":
        this.goToNextQuestion();
        break;

      case "end":
        this.requestEndQuiz();
        break;

      case "submit-answer":
        this.submitScramble();
        break;

      case "add-team":
        this.addTeamDraft();
        break;

      case "import-file":
        this.dom.importFile.click();
        break;

      case "download-template":
        this.openTemplateModal();
        break;

      case "template-save":
        this.saveTemplateToDownloads();
        break;

      case "template-save-as":
        this.saveTemplateAs();
        break;

      case "template-open":
        this.openTemplateFile();
        break;

      case "template-cancel":
        this.closeTemplateModal();
        break;

      case "clear-imported":
        this.clearImported();
        break;

      case "remove-team":
        this.removeTeamDraft(Number(element && element.dataset.teamIndex));
        break;

      case "play-again":
        if (this.mode === "quizmaster") {
          this.goToQuizLobby();
        } else {
          this.startQuiz();
        }
        break;

      case "retry-incorrect":
        this.retryIncorrect();
        break;

      case "review-filter":
        this.setReviewFilter(element && element.dataset.filter);
        break;

      case "home":
        this.goHome();
        break;

      case "open-settings":
        this.openSettings();
        break;

      case "close-settings":
        this.closeSettings();
        break;

      case "login":
        this.signIn();
        break;

      case "register":
        this.registerAccount();
        break;

      default:
        console.warn("Unknown quiz action:", action);
    }
  }

  handleKeydown(event) {
    const target = event.target;

    // While the confirmation modal is open it owns the keyboard.
    if (this.confirmResolver) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.settleConfirm(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.settleConfirm(true);
      }

      return;
    }

    // The template download modal closes on Escape.
    if (this.templateOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeTemplateModal();
      }

      return;
    }

    // Escape leaves the Settings page.
    if (this.isScreenActive("settings")) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeSettings();
      }

      return;
    }

    // Enter inside the team name field adds a team.
    if (target && target.id === "team-name-input" && event.key === "Enter") {
      event.preventDefault();
      this.addTeamDraft();
      return;
    }

    // Enter inside a scramble text input submits the answer.
    if (target && target.classList.contains("answer-input") && event.key === "Enter") {
      event.preventDefault();
      this.submitScramble();
      return;
    }

    if (!this.isScreenActive("quiz") || target instanceof HTMLInputElement) {
      return;
    }

    // Enter commits the highlighted multiple-choice answer (same as double-click).
    if (event.key === "Enter") {
      if (this.currentResponse !== null && this.currentResponse !== undefined && this.quiz.active) {
        event.preventDefault();
        this.lockMultipleChoice(this.currentResponse);
      }

      return;
    }

    // Right arrow advances to the next question.
    if (event.key === "ArrowRight") {
      this.handleQuizAction("next");
    }
  }

  /* ===================== Screen management ===================== */

  isScreenActive(name) {
    const screen = this.dom.screens[name];

    return Boolean(screen) && !screen.hidden;
  }

  /**
   * Shows one screen and hides the others.
   * @param {"home"|"lobby"|"quiz"|"results"|"settings"} name
   */
  showScreen(name) {
    const screens = this.dom.screens;

    if (!screens[name]) {
      console.warn("Unknown screen:", name);
      return;
    }

    Object.keys(screens).forEach((key) => {
      screens[key].hidden = key !== name;
    });

    this.currentScreen = name;
  }

  /**
   * Opens the Settings page, remembering where to return. Pauses the quiz
   * timer so time does not run down while the user is away.
   */
  openSettings() {
    if (this.currentScreen === "settings") {
      return;
    }

    this.previousScreen = this.currentScreen;

    if (this.currentScreen === "quiz" && this.timer.isRunning()) {
      this.timer.pause();
      this.timerPausedForSettings = true;
    } else {
      this.timerPausedForSettings = false;
    }

    this.showScreen("settings");
    Sound.play("select");

    if (this.dom.settingsTitle) {
      this.dom.settingsTitle.focus({ preventScroll: true });
    }
  }

  /** Closes Settings and returns to the screen it was opened from. */
  closeSettings() {
    if (this.currentScreen !== "settings") {
      return;
    }

    const target = this.previousScreen && this.previousScreen !== "settings"
      ? this.previousScreen
      : "home";

    this.showScreen(target);

    if (target === "quiz" && this.timerPausedForSettings) {
      this.timer.resume();
    }

    this.timerPausedForSettings = false;
    Sound.play("select");
  }

  /* ===================== Authentication ===================== */

  /** Minimum length a new password must have (see submitCredentials). */
  static get MIN_PASSWORD_LENGTH() {
    return 6;
  }

  /**
   * Decides which authentication screen to show. Without the Tauri shell
   * (tests, plain browser) the app simply starts. With it, a fresh install
   * without any registered user gets the registration screen; afterwards the
   * sign-in screen is shown.
   */
  async startAuthentication() {
    if (!window.QuizApi || !QuizApi.isAvailable()) {
      this.showScreen("home");
      return;
    }

    try {
      const registered = await QuizApi.hasUsers();

      if (!registered) {
        this.showScreen("register");
        return;
      }

      this.showScreen("login");
    } catch (error) {
      console.warn("Could not check registered users:", error);
      this.showScreen("login");
    }
  }

  /** Signs the user in and unlocks the rest of the app. */
  async signIn() {
    await this.submitCredentials("login");
  }

  /** Registers the first user account and unlocks the rest of the app. */
  async registerAccount() {
    await this.submitCredentials("register");
  }

  /**
   * Shared body of sign-in and registration. On success the app is unlocked.
   * Signing in shows the home screen. Registering shows the sign-in screen
   * instead, with the new username already filled in, so the admin can sign
   * in with one more click.
   */
  async submitCredentials(action) {
    const isLogin = action === "login";
    const usernameEl = isLogin
      ? this.dom.loginUsername
      : this.dom.registerUsername;
    const passwordEl = isLogin
      ? this.dom.loginPassword
      : this.dom.registerPassword;
    const confirmEl = isLogin ? null : this.dom.registerConfirmPassword;
    const errorEl = isLogin ? this.dom.loginError : this.dom.registerError;
    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    errorEl.hidden = true;
    errorEl.textContent = "";

    if (username.length === 0) {
      this.showAuthError(errorEl, "Please type a username.");
      return;
    }

    if (password.length === 0) {
      this.showAuthError(errorEl, "Please type a password.");
      return;
    }

    if (!isLogin) {
      const confirm = confirmEl ? confirmEl.value : "";

      if (confirm !== password) {
        this.showAuthError(errorEl, "Passwords do not match.");
        return;
      }
    }

    if (password.length < QuizApp.MIN_PASSWORD_LENGTH) {
      this.showAuthError(
        errorEl,
        `Password must be at least ${QuizApp.MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }

    try {
      if (isLogin) {
        await QuizApi.login(username, password);
        this.showScreen("home");
      } else {
        await QuizApi.register(username, password);

        // Offer one more click to sign in with the account just created.
        this.dom.loginUsername.value = username;
        this.showScreen("login");
      }

      this.authenticated = true;
    } catch (error) {
      this.showAuthError(errorEl, messageOf(error));
    }
  }

  /** Reports a rejected login or registration as an inline message. */
  showAuthError(element, message) {
    element.textContent = message || "Something went wrong.";
    element.hidden = false;
  }

  /** Normalizes a rejected command promise into a human readable message. */
  messageOf(error) {
    if (error && error.message) {
      return error.message;
    }

    return String(error);
  }

  applyMode(mode) {
    this.mode = mode === "quizmaster" ? "quizmaster" : "practice";

    // The setup screen's primary action changes with the mode: quizmaster
    // hosts go on to the lobby (to add teams) before the quiz can start.
    const startBtn = this.dom.startBtn;

    if (startBtn) {
      const isQuizmaster = this.mode === "quizmaster";

      startBtn.textContent = isQuizmaster ? "Go to Quiz" : "Start Quiz";
      startBtn.dataset.action = isQuizmaster ? "go-to-quiz" : "start";
    }
  }

  /**
   * Quizmaster flow: leave the setup screen for the team lobby. Reuses the
   * same draft teams the host already added and refreshes the lobby preview.
   */
  goToQuizLobby(options = {}) {
    const { skipIntro = false } = options;

    if (!skipIntro) {
      this.clearCountdown();
      this.cancelAutoAdvance();
      this.timer.stop();
      this.quiz.end();
    }

    // Defensive: ensure the shared teams panel is visible on the lobby.
    if (this.dom.teamsPanel) {
      this.dom.teamsPanel.hidden = false;
    }

    this.renderTeamsDraft();
    this.renderLobbyLeaderboard();
    this.syncLobbyStartState();
    this.showScreen("lobby");

    if (this.dom.teamNameInput) {
      this.dom.teamNameInput.focus({ preventScroll: true });
    }
  }

  /**
   * Enables the lobby's Start button only when at least one team exists and
   * keeps the inline hint in sync.
   */
  syncLobbyStartState() {
    const ready = this.teamsDraft.length > 0;

    if (this.dom.lobbyStartBtn) {
      this.dom.lobbyStartBtn.disabled = !ready;
    }

    if (this.dom.lobbyStartHint) {
      this.dom.lobbyStartHint.textContent = ready
        ? "Teams are ready. Start when everyone is set."
        : "Add at least one team to start.";
    }
  }

  /**
   * Renders the pre-quiz leaderboard using each team's best saved score and
   * highlights the team that is set to answer.
   */
  renderLobbyLeaderboard() {
    const list = this.dom.lobbyScoreList;

    if (!list) {
      return;
    }

    list.innerHTML = "";

    if (!this.scoreboard.hasTeams()) {
      const empty = document.createElement("li");
      empty.className = "score-empty";
      empty.textContent = "No teams yet.";
      list.appendChild(empty);
      return;
    }

    this.scoreboard.getRankings().forEach((entry) => {
      const item = document.createElement("li");
      item.className = "score-item";

      if (entry.rank === 1 && entry.score > 0) {
        item.classList.add("leader");
      }

      if (entry.name === this.answeringTeam) {
        item.classList.add("active-team");
      }

      const rank = document.createElement("span");
      rank.className = "score-rank";
      rank.textContent = `#${entry.rank}`;

      const label = document.createElement("span");
      label.className = "score-name";
      label.textContent = entry.name;

      const score = document.createElement("span");
      score.className = "score-value";
      score.textContent = String(entry.score);

      item.append(rank, label, score);
      list.appendChild(item);
    });
  }

  /**
   * Keeps the shared scoreboard in step with the draft teams: drops removed
   * teams, adds new ones at zero, and preserves every existing best score.
   */
  syncScoreboardTeams() {
    const names = this.teamsDraft.map((name) => String(name).trim()).filter((name) => name.length > 0);

    // Remove teams no longer in the draft.
    this.scoreboard.getTeamNames().forEach((name) => {
      if (!names.some((candidate) => candidate.toLowerCase() === name.toLowerCase())) {
        this.scoreboard.removeTeam(name);
      }
    });

    // Add newly drafted teams, seeding each with its remembered best score.
    names.forEach((name) => {
      if (!this.scoreboard.getTeam(name)) {
        const best = this.teamBestScores.get(name);
        this.scoreboard.addTeam(name, Number(best) || 0);
      }
    });
  }

  /**
   * Fills the lobby "Answering team" dropdown and keeps the current choice
   * (defaulting to the first team). A team is always preselected so the
   * quizmaster always knows who answers before the quiz begins.
   */
  renderLobbyTeamSelector() {
    const select = this.dom.lobbyAwardTeam;

    if (!select) {
      return;
    }

    const names = this.scoreboard.getTeamNames();
    select.innerHTML = "";

    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });

    if (names.length === 0) {
      this.answeringTeam = "";
      return;
    }

    const stillValid = names.some((name) => name.toLowerCase() === this.answeringTeam.toLowerCase());

    if (!stillValid) {
      this.answeringTeam = names[0];
    }

    select.value = this.answeringTeam;
  }

  goHome() {
    this.clearCountdown();
    this.cancelAutoAdvance();
    this.timer.stop();
    this.quiz.end();
    this.showScreen("home");

    // Focus was left behind on an element that is now hidden, so hand it
    // back to the primary action of the screen the user just landed on.
    if (this.dom.startBtn) {
      this.dom.startBtn.focus({ preventScroll: true });
    }
  }

  /* ===================== Settings ===================== */

  readSetting(name, fallback) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);

    return checked ? checked.value : fallback;
  }

  readSettingNumber(name, fallback) {
    const value = Number(this.readSetting(name, fallback));

    return Number.isFinite(value) ? value : fallback;
  }

  /* ===================== Levels ===================== */

  /** Active level key ("normal" | "advanced"). */
  getLevelName() {
    const name = this.readSetting("level", "normal");

    return QuizApp.LEVELS[name] ? name : "normal";
  }

  /** Active level definition. */
  getLevelConfig() {
    return QuizApp.LEVELS[this.getLevelName()];
  }

  /** Maximum questions a round may use for the active level. */
  getLevelMax() {
    return this.getLevelConfig().max;
  }

  /** Questions eligible for the active level, in bank order. */
  getLevelPool() {
    const types = this.getLevelConfig().types;

    return this.questions.filter((question) => types.indexOf(question.type) !== -1);
  }

  /* ===================== Team setup ===================== */

  renderTeamsDraft() {
    const list = this.dom.teamList;
    list.innerHTML = "";

    if (this.teamsDraft.length === 0) {
      const empty = document.createElement("li");
      empty.className = "team-empty";
      empty.textContent = "Add at least one team to start.";
      list.appendChild(empty);
    } else {
      this.teamsDraft.forEach((name, index) => {
        const item = document.createElement("li");
        item.className = "team-item";

        const label = document.createElement("span");
        label.textContent = name;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-tiny btn-danger-outline";
        remove.textContent = "Remove";
        remove.dataset.action = "remove-team";
        remove.dataset.teamIndex = String(index);
        remove.setAttribute("aria-label", `Remove team ${name}`);

        item.append(label, remove);
        list.appendChild(item);
      });
    }

    this.syncScoreboardTeams();
    this.renderLobbyTeamSelector();
    this.syncLobbyStartState();
    this.renderLobbyLeaderboard();
  }

  addTeamDraft() {
    const input = this.dom.teamNameInput;
    const name = input.value.trim();
    this.clearTeamError();

    if (name.length === 0) {
      this.showTeamError("Please type a team name first.");
      return;
    }

    if (name.length > 24) {
      this.showTeamError("Team names must be 24 characters or fewer.");
      return;
    }

    if (this.teamsDraft.some((team) => team.toLowerCase() === name.toLowerCase())) {
      this.showTeamError("That team already exists.");
      return;
    }

    if (this.teamsDraft.length >= 8) {
      this.showTeamError("You can add up to 8 teams.");
      return;
    }

    this.teamsDraft.push(name);
    input.value = "";
    input.focus({ preventScroll: true });
    this.renderTeamsDraft();

    if (window.QuizApi && QuizApi.isAvailable()) {
      QuizApi.addTeam(name).catch((error) => {
        console.warn("Failed to save team to database:", error);
      });
    }
  }

  removeTeamDraft(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.teamsDraft.length) {
      return;
    }

    const [name] = this.teamsDraft.splice(index, 1);
    this.renderTeamsDraft();

    if (name) {
      this.teamBestScores.delete(name);
    }

    if (name && window.QuizApi && QuizApi.isAvailable()) {
      QuizApi.removeTeam(name).catch((error) => {
        console.warn("Failed to remove team from database:", error);
      });
    }
  }

  showTeamError(message) {
    this.dom.teamError.textContent = message;
    this.dom.teamError.hidden = false;
  }

  clearTeamError() {
    this.dom.teamError.textContent = "";
    this.dom.teamError.hidden = true;
  }

  /* ===================== Starting a quiz ===================== */

  startQuiz(customQuestions = null) {
    this.clearCountdown();
    this.cancelAutoAdvance();

    const isCustom = Array.isArray(customQuestions) && customQuestions.length > 0;

    if (isCustom) {
      // "Retry incorrect only" always runs as a solo practice session built
      // from an explicit subset, ignoring the setup radios.
      this.mode = "practice";
      this.applyMode(this.mode);
      this.questionSeconds = this.readSettingNumber("timer", 0);

      this.setupScoreboard();
      this.responses = new Map();
      this.drafts = new Map();
      this.currentResponse = null;
      this.reviewFilter = "all";

      this.timer.setDuration(this.questionSeconds);

      this.quiz = new Quiz(customQuestions);
      this.quiz.start({ randomize: false, questionCount: customQuestions.length, shuffleChoices: false });

      this.finishStart();
      return;
    }

    this.mode = this.readSetting("mode", "practice");
    this.applyMode(this.mode);

    const requestedCount = this.readSettingNumber("count", 10);
    const randomize = this.readSetting("order", "random") === "random";
    const shuffleChoices = this.dom.shuffleChoices.checked;
    this.questionSeconds = this.readSettingNumber("timer", 0);

    this.setupScoreboard();
    this.responses = new Map();
    this.drafts = new Map();
    this.currentResponse = null;
    this.reviewFilter = "all";

    this.timer.setDuration(this.questionSeconds);

    // A previous "retry incorrect" session may have replaced this.quiz with a
    // subset, so rebuild from the full bank before a normal start.
    this.rebuildBank();

    // The active level decides which question types are in play and caps
    // the round size (e.g. Normal = multiple choice only, up to 50).
    const pool = this.getLevelPool();
    const questionCount = Math.max(0, Math.min(requestedCount, this.getLevelMax(), pool.length));

    this.quiz = new Quiz(pool);
    this.quiz.start({ randomize, questionCount, shuffleChoices });
    this.persistSettings();

    this.finishStart();
  }

  /** Shared tail of startQuiz: reset per-index state, show the quiz, render. */
  finishStart() {
    // Cleared after quiz.start so the setDuration tick above can never seed a
    // stale remaining-time entry from a previous session.
    this.remainingByIndex = new Map();

    this.showScreen("quiz");

    // With a per-question timer we hold the clock until the "get ready"
    // countdown finishes, so the first second is never lost to the
    // screen transition.
    const useCountdown = this.questionSeconds > 0;
    this.suspendTimerStart = useCountdown;

    this.renderQuestion();

    if (useCountdown) {
      this.presentCountdown(3);
    }
  }

  setupScoreboard() {
    if (this.mode === "practice") {
      this.scoreboard = new Scoreboard();
      this.scoreboard.addTeam("Player");
      return;
    }

    // Quizmaster keeps a persistent board so each team's best score carries
    // across sessions. Only the draft team list is synchronized here.
    this.syncScoreboardTeams();

    if (!this.scoreboard.hasTeams()) {
      this.scoreboard.addTeam("Team 1", 0);
    }
  }

  /**
   * Shows a short "get ready" countdown overlay, then kicks off the
   * timer. While it is visible, quiz navigation is blocked so the first
   * question cannot be skipped and the clock does not run.
   *
   * @param {number} seconds Starting value.
   */
  presentCountdown(seconds) {
    const overlay = this.dom.countdown;
    const value = this.dom.countdownValue;

    if (!overlay || !value) {
      this.suspendTimerStart = false;

      if (this.timer.isEnabled()) {
        this.timer.start();
      }

      return;
    }

    let remaining = Math.max(1, Number(seconds) || 1);

    this.countdownActive = true;
    overlay.hidden = false;
    value.textContent = String(remaining);
    value.classList.add("pop");
    overlay.focus({ preventScroll: true });

    const step = () => {
      remaining -= 1;

      if (remaining <= 0) {
        this.clearCountdown();
        this.dom.questionText.focus({ preventScroll: true });

        if (this.timer.isEnabled()) {
          this.timer.start();
        }

        return;
      }

      value.textContent = String(remaining);
      value.classList.remove("pop");
      void value.offsetWidth;
      value.classList.add("pop");
      this.countdownHandle = window.setTimeout(step, 1000);
    };

    this.countdownHandle = window.setTimeout(step, 1000);
  }

  /** Hides the countdown overlay and cancels any pending tick. */
  clearCountdown() {
    if (this.countdownHandle !== null) {
      window.clearTimeout(this.countdownHandle);
      this.countdownHandle = null;
    }

    this.countdownActive = false;

    if (this.dom.countdown) {
      this.dom.countdown.hidden = true;
    }
  }

  /**
   * Cancels a pending "advance to the next question" callback scheduled by
   * handleTimeUp. Called whenever the session ends or restarts so a stale
   * callback can never resume a finished quiz (which used to restart the
   * timer and force-finish the remaining questions with fabricated scores).
   */
  cancelAutoAdvance() {
    if (this.autoAdvanceHandle !== null) {
      window.clearTimeout(this.autoAdvanceHandle);
      this.autoAdvanceHandle = null;
    }
  }

  /* ===================== Rendering the quiz ===================== */

  renderQuestion() {
    // A stale callback must never render into a session that already ended.
    if (!this.quiz.active) {
      return;
    }

    const question = this.quiz.getCurrentQuestion();

    if (!question) {
      this.finishQuiz();
      return;
    }

    const index = this.quiz.currentIndex;
    const saved = this.responses.get(index);

    this.currentResponse = saved ? saved.response : null;
    this.answered = saved ? saved.answered : false;
    this.revealed = saved ? saved.revealed : false;

    this.dom.progressText.textContent = `${this.quiz.getProgressNumber()} / ${this.quiz.getTotal()}`;
    this.dom.typeBadge.textContent = question.isMultipleChoice() ? "Multiple Choice" : "Scramble";
    this.dom.questionText.textContent = question.text;

    this.renderAnswerArea(question);
    this.clearFeedback();
    this.updateScoreDisplay();
    this.updateProgress();
    this.updateControlStates();
    this.animateQuestionCard();

    if (saved) {
      if (this.mode === "quizmaster") {
        // Revisiting a locked question must not reveal correctness.
        this.lockAnswerQuiet(question, saved.response);
        this.showFeedback(question, {
          neutral: true,
          message: saved.team ? `Answer locked for ${saved.team}.` : "Answer locked."
        });
      } else {
        this.markAnswer(question, saved.response, saved.isCorrect);
        this.showFeedback(question, {
          isCorrect: saved.isCorrect,
          timeUp: false,
          alwaysShowAnswer: true
        });
      }
    }

    this.restartTimer();
    this.dom.questionText.focus({ preventScroll: true });
  }

  /**
   * Refreshes the thin progress bar under the status chips.
   */
  updateProgress() {
    const total = this.quiz.getTotal();
    const current = total === 0 ? 0 : this.quiz.currentIndex + 1;
    const percent = total === 0 ? 0 : Math.round((current / total) * 100);

    if (this.dom.progressFill) {
      this.dom.progressFill.style.width = `${percent}%`;
    }

    if (this.dom.progressTrack) {
      this.dom.progressTrack.setAttribute("aria-valuenow", String(percent));
    }
  }

  /**
   * Replays the entrance animation so each new question animates in.
   * The forced reflow restarts the CSS animation on the same element.
   */
  animateQuestionCard() {
    const card = this.dom.questionCard;

    if (!card) {
      return;
    }

    card.classList.remove("question-enter");
    void card.offsetWidth;
    card.classList.add("question-enter");
  }

  renderAnswerArea(question) {
    const area = this.dom.answerArea;
    area.innerHTML = "";

    switch (question.type) {
      case Question.TYPE_MULTIPLE_CHOICE:
        area.appendChild(this.buildOptionsView(question));
        break;

      case Question.TYPE_SCRAMBLE:
        area.appendChild(this.buildScrambleView(question));
        break;

      default:
        console.warn("Unknown question type:", question.type);
    }

    if (this.dom.answerHint) {
      if (question.isMultipleChoice()) {
        this.dom.answerHint.textContent = "Click a choice to highlight it, then double-click (or press Enter) to lock in and continue.";
      } else if (this.dom.answerArea.querySelector(".scramble-answer")) {
        this.dom.answerHint.textContent = "Click the letter tiles to arrange the answer, then click Submit Answer to continue.";
      } else {
        this.dom.answerHint.textContent = "Type your answer, then press Enter (or click Submit Answer) to continue.";
      }

      this.dom.answerHint.hidden = false;
    }
  }

  buildOptionsView(question) {
    const list = document.createElement("ul");
    list.className = "option-list";

    question.options.forEach((optionText, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const letter = String.fromCharCode(65 + index);

      button.type = "button";
      button.className = "option-btn";
      button.dataset.optionIndex = String(index);
      button.setAttribute("aria-pressed", "false");

      const badge = document.createElement("span");
      badge.className = "option-letter";
      badge.textContent = letter;

      const label = document.createElement("span");
      label.className = "option-text";
      label.textContent = optionText;

      button.append(badge, label);
      item.appendChild(button);
      list.appendChild(item);
    });

    return list;
  }

  /**
   * Builds the answer area for a scramble question. Single-token answers get
   * click-to-reorder letter tiles; multi-word answers use an accepted
   * single-token alias when one is available. Very short answers fall back
   * to the free-text input.
   */
  buildScrambleView(question) {
    const wrapper = document.createElement("div");
    wrapper.className = "scramble-view";

    const index = this.quiz.currentIndex;
    const letters = question ? question.getScrambledLetters() : [];

    if (letters.length === 0) {
      return this.buildScrambleTextFallback(wrapper, index);
    }

    // A placed answer (saved response or draft) is a joined string; split it
    // back into tiles and remove them from the shuffled source multiset so
    // repeated letters keep the right counts.
    const saved = typeof this.currentResponse === "string"
      ? this.currentResponse
      : this.drafts.get(index);
    const savedLetters = typeof saved === "string"
      ? saved.toUpperCase().split("").filter((ch) => /[A-Z0-9]/.test(ch))
      : [];

    const remaining = letters.slice();
    const placed = [];

    savedLetters.forEach((ch) => {
      const pos = remaining.indexOf(ch);

      if (pos !== -1) {
        placed.push(remaining.splice(pos, 1)[0]);
      }
    });

    const source = document.createElement("div");
    source.className = "scramble-source";
    const answer = document.createElement("div");
    answer.className = "scramble-answer";

    const makeTile = (ch, place) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "letter-tile";
      tile.dataset.letter = ch;
      tile.dataset.place = place;
      tile.textContent = ch;
      return tile;
    };

    remaining.forEach((ch) => source.appendChild(makeTile(ch, "source")));
    placed.forEach((ch) => answer.appendChild(makeTile(ch, "answer")));

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "btn btn-primary";
    submit.textContent = "Submit Answer";
    submit.dataset.action = "submit-answer";
    submit.disabled = remaining.length > 0;

    wrapper.append(source, answer, submit);

    return wrapper;
  }

  /** Free-text fallback used when the answer cannot be scrambled into tiles. */
  buildScrambleTextFallback(wrapper, index) {
    wrapper.classList.add("scramble-view-text");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "answer-input";
    input.placeholder = "Type your answer...";
    input.autocomplete = "off";
    input.maxLength = 120;
    input.setAttribute("aria-label", "Your answer");

    // Restore a saved answer or an unsubmitted draft so paging does not
    // wipe what the user has already typed.
    const restore = typeof this.currentResponse === "string"
      ? this.currentResponse
      : this.drafts.get(index);

    if (typeof restore === "string") {
      input.value = restore;
    }

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "btn btn-primary";
    submit.textContent = "Submit Answer";
    submit.dataset.action = "submit-answer";

    wrapper.append(input, submit);

    return wrapper;
  }

  /** Uppercased string built from the tiles currently placed in the answer row. */
  getScrambleAnswer() {
    const answer = this.dom.answerArea.querySelector(".scramble-answer");

    if (!answer) {
      return "";
    }

    return Array.from(answer.children)
      .map((tile) => tile.dataset.letter)
      .join("");
  }

  /**
   * Click handler for a letter tile: moves it between the source and answer
   * rows, keeps the Submit button's enabled state in step, and persists the
   * placed order as a draft so paging backward/forward does not lose it.
   */
  moveScrambleTile(tile) {
    const question = this.quiz.getCurrentQuestion();

    if (!question || !question.isScramble() || !this.canSelectAnswer()) {
      return;
    }

    const source = this.dom.answerArea.querySelector(".scramble-source");
    const answer = this.dom.answerArea.querySelector(".scramble-answer");
    const from = tile.parentElement;

    if (!source || !answer || (from !== source && from !== answer)) {
      return;
    }

    if (from === source) {
      answer.appendChild(tile);
    } else {
      source.appendChild(tile);
    }

    const submit = this.dom.answerArea.querySelector('[data-action="submit-answer"]');

    if (submit) {
      submit.disabled = source.children.length > 0;
    }

    this.drafts.set(this.quiz.currentIndex, this.getScrambleAnswer());
    Sound.play("select");
  }

  /* ===================== Answering ===================== */

  /** True while a fresh multiple-choice/scramble answer may be given. */
  canSelectAnswer() {
    const question = this.quiz.getCurrentQuestion();

    if (!question || this.countdownActive || this.revealed) {
      return false;
    }

    return !(this.mode === "practice" && this.answered);
  }

  /**
   * A single click only highlights a choice (and plays a soft tick). The
   * answer is not committed until a double-click or Enter.
   */
  highlightMultipleChoice(index) {
    if (!this.canSelectAnswer()) {
      return;
    }

    const question = this.quiz.getCurrentQuestion();

    if (!question || !question.isMultipleChoice()) {
      return;
    }

    this.currentResponse = index;
    this.highlightSelectedOption(index);
    Sound.play("select");
  }

  /** Double-click / Enter on a choice: locks it in and grades it. */
  lockMultipleChoice(index) {
    if (!this.canSelectAnswer()) {
      return;
    }

    const question = this.quiz.getCurrentQuestion();

    if (!question || !question.isMultipleChoice()) {
      return;
    }

    this.currentResponse = index;
    this.highlightSelectedOption(index);
    this.finalizeAnswer();
  }

  submitScramble() {
    const question = this.quiz.getCurrentQuestion();

    if (this.countdownActive || this.revealed) {
      return;
    }

    if (!question || !question.isScramble()) {
      return;
    }

    if (this.mode === "practice" && this.answered) {
      return;
    }

    // Tile UI assembles the answer from the placed tiles; the fallback
    // multi-word input reads whatever the player typed.
    const answerRow = this.dom.answerArea.querySelector(".scramble-answer");
    let value;

    if (answerRow) {
      value = this.getScrambleAnswer();
    } else {
      const input = this.dom.answerArea.querySelector(".answer-input");
      value = input ? input.value : "";
    }

    if (normalizeAnswer(value).length === 0) {
      this.showFeedback(question, { validation: true, message: "Please arrange or type an answer before submitting." });
      return;
    }

    this.currentResponse = value;
    this.finalizeAnswer();
  }

  /**
   * Commits the current response. Practice mode grades it instantly, while
   * quizmaster mode quietly records it against the answering team without
   * revealing correctness. Either way the quiz auto-advances afterwards.
   */
  finalizeAnswer() {
    const question = this.quiz.getCurrentQuestion();

    if (!question || this.revealed) {
      return;
    }

    if (this.mode === "practice") {
      this.evaluateResponse(this.currentResponse);
    } else {
      this.recordTeamResponse();
    }

    this.scheduleAutoAdvance();
  }

  /** Queues (or re-queues) the automatic move to the next question. */
  scheduleAutoAdvance() {
    this.cancelAutoAdvance();

    // Quizmaster gets a little longer so the host can see the answer.
    const delay = this.mode === "practice" ? 1000 : 1500;

    this.autoAdvanceHandle = window.setTimeout(() => {
      this.autoAdvanceHandle = null;
      this.advanceToNext();
    }, delay);
  }

  evaluateResponse(response) {
    const question = this.quiz.getCurrentQuestion();
    const isCorrect = question.isCorrect(response);

    Sound.play(isCorrect ? "correct" : "incorrect");

    this.answered = true;
    this.revealed = true;

    this.quiz.recordResponse(isCorrect);
    this.responses.set(this.quiz.currentIndex, {
      response,
      isCorrect,
      answered: true,
      revealed: true
    });

    this.recordAttempt(question, response, isCorrect);

    this.timer.stop();
    this.markAnswer(question, response, isCorrect);
    this.showFeedback(question, { isCorrect, timeUp: false, alwaysShowAnswer: false });
    this.updateScoreDisplay();
    this.updateControlStates();
  }

  /**
   * Persists a single attempt to SQLite (best effort, never blocks the UI).
   * No-ops outside the Tauri shell or for questions without a database id.
   */
  recordAttempt(question, response, isCorrect) {
    if (!window.QuizApi || !QuizApi.isAvailable()) {
      return;
    }

    if (!question || question.id === undefined || question.id === null) {
      return;
    }

    const given = response === null || response === undefined ? null : response;

    QuizApi.recordAttempt(question.id, given, isCorrect).catch((error) => {
      console.warn("Failed to record attempt:", error);
    });
  }

  /**
   * Quizmaster mode: records the answering team's response without revealing
   * whether it was correct. The response is scored internally and tallied at
   * the end of the quiz, so the leaderboard stays at zero during play.
   */
  recordTeamResponse() {
    const question = this.quiz.getCurrentQuestion();

    if (!question || this.revealed) {
      return;
    }

    const hasResponse = this.currentResponse !== null && this.currentResponse !== undefined;
    const isCorrect = hasResponse ? question.isCorrect(this.currentResponse) : false;
    const team = this.answeringTeam;

    this.revealed = true;
    this.answered = hasResponse;

    this.quiz.recordResponse(isCorrect);
    this.responses.set(this.quiz.currentIndex, {
      response: this.currentResponse,
      isCorrect,
      answered: hasResponse,
      revealed: true,
      team
    });

    if (hasResponse) {
      this.recordAttempt(question, this.currentResponse, isCorrect);
    }

    this.timer.stop();
    this.lockAnswerQuiet(question, this.currentResponse);
    this.showFeedback(question, {
      neutral: true,
      message: hasResponse ? `Answer locked for ${team}.` : "No answer locked."
    });
    this.updateScoreDisplay();
    this.updateControlStates();
  }

  /**
   * Locks the answer UI without marking it right or wrong. Used in
   * quizmaster mode so the host (and players) cannot infer correctness.
   */
  lockAnswerQuiet(question, response) {
    switch (question.type) {
      case Question.TYPE_MULTIPLE_CHOICE: {
        const buttons = this.dom.answerArea.querySelectorAll(".option-btn");

        buttons.forEach((button) => {
          const index = Number(button.dataset.optionIndex);

          button.disabled = true;
          button.setAttribute("aria-pressed", index === response ? "true" : "false");
          button.classList.toggle("selected", index === response);
        });
        break;
      }

      case Question.TYPE_SCRAMBLE: {
        const answerRow = this.dom.answerArea.querySelector(".scramble-answer");

        if (answerRow) {
          this.dom.answerArea.querySelectorAll(".letter-tile").forEach((tile) => {
            tile.disabled = true;
          });
          break;
        }

        const input = this.dom.answerArea.querySelector(".answer-input");

        if (input) {
          input.disabled = true;
        }
        break;
      }

      default:
        break;
    }
  }

  highlightSelectedOption(index) {
    const buttons = this.dom.answerArea.querySelectorAll(".option-btn");

    buttons.forEach((button) => {
      const isSelected = Number(button.dataset.optionIndex) === index;

      button.classList.toggle("selected", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
  }

  markAnswer(question, response, isCorrect) {
    switch (question.type) {
      case Question.TYPE_MULTIPLE_CHOICE: {
        const buttons = this.dom.answerArea.querySelectorAll(".option-btn");

        buttons.forEach((button) => {
          const index = Number(button.dataset.optionIndex);
          button.disabled = true;
          button.setAttribute("aria-pressed", index === response ? "true" : "false");

          if (index === question.correctAnswer) {
            button.classList.add("correct");
          }

          if (index === response && !isCorrect) {
            button.classList.add("wrong");
          }
        });
        break;
      }

      case Question.TYPE_SCRAMBLE: {
        const answerRow = this.dom.answerArea.querySelector(".scramble-answer");

        if (answerRow) {
          // Lock every tile so the assembled answer can no longer change.
          this.dom.answerArea.querySelectorAll(".letter-tile").forEach((tile) => {
            tile.disabled = true;
          });

          if (answerRow.children.length > 0) {
            answerRow.classList.add(isCorrect ? "correct" : "wrong");
          }
          break;
        }

        const input = this.dom.answerArea.querySelector(".answer-input");

        if (input) {
          input.disabled = true;

          // An untouched box should not flash red on reveal - only grade a
          // response that was actually given.
          const gaveAnswer = response !== null && response !== undefined && String(response).trim().length > 0;

          if (gaveAnswer) {
            input.classList.add(isCorrect ? "correct" : "wrong");
          }
        }
        break;
      }

      default:
        break;
    }
  }

  /* ===================== Timer ===================== */

  restartTimer() {
    const seconds = this.questionSeconds;
    const skip = this.answered || this.revealed;

    if (seconds <= 0) {
      this.timer.stop();
      this.dom.timerChip.hidden = true;
      return;
    }

    this.dom.timerChip.hidden = false;

    // Revisiting a question resumes the clock it already had instead of
    // refilling it, so paging backward/forward cannot reset the countdown.
    const stored = this.remainingByIndex.get(this.quiz.currentIndex);
    const resume = Number.isFinite(stored) && stored > 0 && stored <= seconds ? stored : seconds;

    this.timer.reset(resume);

    if (!skip && !this.suspendTimerStart) {
      this.timer.start();
    }

    this.suspendTimerStart = false;
  }

  updateTimerDisplay(remaining, duration) {
    this.dom.timerText.textContent = formatTime(remaining);
    this.dom.timerChip.classList.toggle("warning", duration > 0 && remaining <= 10 && remaining > 0);

    if (this.quiz.active && duration > 0 && remaining > 0) {
      this.remainingByIndex.set(this.quiz.currentIndex, remaining);
    }

    // Tense cue once per second over the final 5 seconds, only while the
    // question is still live (not yet answered/revealed).
    if (duration > 0 && remaining > 0 && remaining <= 5 && !this.revealed) {
      Sound.play("urgent");
    }
  }

  /**
   * Response that should still count when the clock hits zero: the
   * highlighted (but not yet locked) multiple-choice option, or - for an
   * unsubmitted scramble - the answer currently assembled or typed in the
   * answer area. Returns null when nothing was actually given.
   */
  getTimedOutResponse(question) {
    if (this.currentResponse !== null && this.currentResponse !== undefined) {
      return this.currentResponse;
    }

    if (question.isScramble()) {
      const answerRow = this.dom.answerArea.querySelector(".scramble-answer");

      if (answerRow) {
        const assembled = this.getScrambleAnswer();
        return assembled.length > 0 ? assembled : null;
      }

      const input = this.dom.answerArea.querySelector(".answer-input");
      const typed = input ? input.value : "";

      return typed.trim().length > 0 ? typed : null;
    }

    return null;
  }

  handleTimeUp() {
    const question = this.quiz.getCurrentQuestion();

    if (!question || this.revealed) {
      return;
    }

    this.revealed = true;

    const timedOutResponse = this.getTimedOutResponse(question);

    if (this.mode === "practice") {
      if (timedOutResponse !== null) {
        // An answer was already highlighted/assembled, so grade it the same
        // way a locked-in answer would be graded - running out of time must
        // not turn a correct choice into a wrong one.
        this.currentResponse = timedOutResponse;
        this.evaluateResponse(timedOutResponse);
      } else {
        Sound.play("incorrect");
        this.answered = true;
        this.quiz.recordResponse(false);
        this.responses.set(this.quiz.currentIndex, {
          response: this.currentResponse,
          isCorrect: false,
          answered: true,
          revealed: true
        });
        this.recordAttempt(question, this.currentResponse, false);
        this.markAnswer(question, this.currentResponse, false);
        this.showFeedback(question, { isCorrect: false, timeUp: true, alwaysShowAnswer: true });
      }
    } else {
      const hasResponse = timedOutResponse !== null && timedOutResponse !== undefined;
      const isCorrect = hasResponse ? question.isCorrect(timedOutResponse) : false;
      const team = this.answeringTeam;

      // Timing out always grades the question: a fully assembled scramble (or
      // a highlighted choice) still counts, and a blank/partial one is marked
      // incorrect rather than left as "Skipped".
      this.answered = true;
      this.currentResponse = timedOutResponse;
      this.quiz.recordResponse(isCorrect);
      this.responses.set(this.quiz.currentIndex, {
        response: timedOutResponse,
        isCorrect,
        answered: true,
        revealed: true,
        team
      });
      this.recordAttempt(question, timedOutResponse, isCorrect);
      this.lockAnswerQuiet(question, timedOutResponse);
      this.showFeedback(question, { neutral: true, message: "Time's up!" });
    }

    this.updateScoreDisplay();
    this.updateControlStates();

    this.cancelAutoAdvance();
    this.autoAdvanceHandle = window.setTimeout(() => {
      this.autoAdvanceHandle = null;
      this.advanceToNext();
    }, 2000);
  }

  /* ===================== Feedback ===================== */

  showFeedback(question, { isCorrect = false, timeUp = false, alwaysShowAnswer = false, validation = false, neutral = false, message = "" } = {}) {
    const feedback = this.dom.feedback;
    feedback.innerHTML = "";
    feedback.hidden = false;
    feedback.className = "feedback";

    if (this.dom.answerHint) {
      this.dom.answerHint.hidden = true;
    }

    if (validation) {
      feedback.classList.add("validation");
      feedback.textContent = message || "Invalid input.";
      return;
    }

    // Neutral feedback (quizmaster): confirms the answer is locked without
    // revealing whether it is correct or showing the correct answer.
    if (neutral) {
      feedback.classList.add("neutral");

      const neutralHeading = document.createElement("p");
      neutralHeading.className = "feedback-heading";
      neutralHeading.textContent = message || "Answer locked.";
      feedback.appendChild(neutralHeading);
      return;
    }

    const heading = document.createElement("p");
    heading.className = "feedback-heading";

    if (timeUp) {
      heading.textContent = "Time's up!";
      feedback.classList.add("wrong");
    } else if (isCorrect) {
      heading.textContent = "Correct!";
      feedback.classList.add("correct");
    } else {
      heading.textContent = "Incorrect";
      feedback.classList.add("wrong");
    }

    feedback.appendChild(heading);

    if (!isCorrect || timeUp || alwaysShowAnswer) {
      const answer = document.createElement("p");
      answer.className = "feedback-answer";

      const label = document.createElement("strong");
      label.textContent = "Correct answer: ";

      answer.append(label, document.createTextNode(question.getCorrectAnswer()));
      feedback.appendChild(answer);
    }

    if (question.explanation) {
      const explanation = document.createElement("p");
      explanation.className = "feedback-explanation";
      explanation.textContent = question.explanation;
      feedback.appendChild(explanation);
    }
  }

  clearFeedback() {
    this.dom.feedback.hidden = true;
    this.dom.feedback.innerHTML = "";
    this.dom.feedback.className = "feedback";
  }

  /* ===================== Navigation ===================== */

  /**
   * Stores an unanswered scramble draft so paging backward/forward does not
   * wipe it. renderAnswerArea() rebuilds the tiles/input from scratch, which
   * used to silently discard the draft. For the tile UI the placed order is
   * persisted as a joined string; the text fallback stores the typed value.
   */
  captureUnansweredInput() {
    if (this.answered || this.revealed || !this.quiz.active) {
      return;
    }

    const question = this.quiz.getCurrentQuestion();

    if (!question || !question.isScramble()) {
      return;
    }

    const answerRow = this.dom.answerArea.querySelector(".scramble-answer");

    if (answerRow) {
      const placed = this.getScrambleAnswer();

      if (placed.length > 0) {
        this.drafts.set(this.quiz.currentIndex, placed);
      } else {
        this.drafts.delete(this.quiz.currentIndex);
      }
      return;
    }

    const input = this.dom.answerArea.querySelector(".answer-input");

    if (input && !input.disabled) {
      this.drafts.set(this.quiz.currentIndex, input.value);
    }
  }

  /**
   * "Next" button / right-arrow handler. Asks for confirmation before leaving
   * the current question, then actually advances.
   */
  goToNextQuestion() {
    if (!this.quiz.active) {
      return;
    }

    this.captureUnansweredInput();

    // Practice mode requires an answer before moving on so questions
    // cannot be skipped silently. Quizmaster mode advances freely.
    if (this.mode === "practice" && !this.answered && !this.revealed) {
      const question = this.quiz.getCurrentQuestion();

      this.showFeedback(question, {
        validation: true,
        message: "Please answer the question before continuing."
      });

      return;
    }

    const finishing = !this.quiz.hasNext();
    const message = finishing
      ? "Finish the quiz and view your results?"
      : "Are you sure you want to go to the next question?";

    this.confirmAction({
      message,
      confirmLabel: finishing ? "Finish" : "Next"
    }).then((confirmed) => {
      if (confirmed) {
        this.advanceToNext();
      }
    });
  }

  /** Performs the actual advance (or finish) without any confirmation. */
  advanceToNext() {
    if (!this.quiz.active) {
      return;
    }

    this.captureUnansweredInput();

    if (this.quiz.hasNext()) {
      this.quiz.nextQuestion();
      this.renderQuestion();
    } else {
      this.finishQuiz();
    }
  }

  updateControlStates() {
    const isQuizmaster = this.mode === "quizmaster";

    // The quiz is always full-width now (the leaderboard lives in the lobby).
    this.dom.screens.quiz.classList.add("solo");

    // The running "Top score" chip would hint at the standings during play,
    // so it stays hidden for the quizmaster. The answering team is shown
    // instead so everyone knows who is playing.
    const scoreChip = this.dom.scoreLabel ? this.dom.scoreLabel.closest(".status-chip") : null;

    if (scoreChip) {
      scoreChip.hidden = isQuizmaster;
    }

    if (this.dom.answeringChip) {
      this.dom.answeringChip.hidden = !isQuizmaster;
    }

    if (this.dom.answeringTeamText) {
      this.dom.answeringTeamText.textContent = this.answeringTeam || "—";
    }
  }

  /* ===================== Scoring (quizmaster) ===================== */

  updateScoreDisplay() {
    if (this.mode === "practice") {
      this.dom.scoreLabel.textContent = "Score";
      this.dom.scoreText.textContent = `${this.quiz.getScore()} / ${this.quiz.getTotal()}`;
    } else {
      this.dom.scoreLabel.textContent = "Top score";
      this.dom.scoreText.textContent = String(this.scoreboard.getTopScore());
    }
  }

  /* ===================== Confirmation modal ===================== */

  /**
   * Shows the in-app confirmation modal and resolves to true (confirm) or
   * false (cancel / Esc / backdrop click).
   * @returns {Promise<boolean>}
   */
  confirmAction({ message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", title = "Are you sure?" } = {}) {
    if (!this.dom.confirmOverlay) {
      return Promise.resolve(window.confirm(message));
    }

    // Resolve any previous, still-open prompt as cancelled.
    if (this.confirmResolver) {
      this.confirmResolver(false);
      this.confirmResolver = null;
    }

    this.dom.confirmMessage.textContent = message;
    this.dom.confirmOk.textContent = confirmLabel;
    this.dom.confirmCancel.textContent = cancelLabel;

    const titleEl = document.getElementById("confirm-title");

    if (titleEl) {
      titleEl.textContent = title;
    }

    this.confirmReturnFocus = document.activeElement;
    this.dom.confirmOverlay.hidden = false;
    Sound.play("confirm");

    // Focus the confirm button so Enter activates it.
    this.dom.confirmOk.focus({ preventScroll: true });

    return new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  /** Closes the modal and resolves the pending confirmAction promise. */
  settleConfirm(confirmed) {
    if (!this.confirmResolver) {
      return;
    }

    const resolve = this.confirmResolver;

    this.confirmResolver = null;
    this.dom.confirmOverlay.hidden = true;

    if (this.confirmReturnFocus && typeof this.confirmReturnFocus.focus === "function") {
      this.confirmReturnFocus.focus({ preventScroll: true });
    }

    this.confirmReturnFocus = null;
    resolve(Boolean(confirmed));
  }

  /* ===================== Sound ===================== */

  setSoundEnabled(enabled, { persist = false } = {}) {
    this.soundEnabled = Boolean(enabled);

    if (window.Sound) {
      Sound.setEnabled(this.soundEnabled);
    }

    if (this.dom.soundToggle) {
      this.dom.soundToggle.checked = this.soundEnabled;
    }

    if (persist) {
      this.persistSettings();
    }
  }

  /* ===================== Background music ===================== */

  /**
   * Starts (or stops) the looping background track and syncs the Home toggle.
   * Playback is deferred to the first user gesture when the browser blocks
   * autoplay, so the theme begins as soon as the user interacts with the app.
   */
  setBgmEnabled(enabled, { persist = false } = {}) {
    this.bgmEnabled = Boolean(enabled);

    if (this.dom.bgmToggle) {
      this.dom.bgmToggle.checked = this.bgmEnabled;
    }

    const bgm = this.dom.bgm;

    if (bgm) {
      bgm.volume = this.bgmVolume;

      if (this.bgmEnabled) {
        this.playBgm();
      } else {
        bgm.pause();
      }
    }

    if (persist) {
      this.persistSettings();
    }
  }

  /**
   * Sets the background-music volume (0..1) and syncs the Home slider.
   * @param {number} value Fractional volume; clamped to [0, 1].
   * @param {{persist?: boolean}} [options]
   */
  setBgmVolume(value, { persist = false } = {}) {
    const clamped = Math.min(1, Math.max(0, Number(value) || 0));
    this.bgmVolume = clamped;

    if (this.dom.bgm) {
      this.dom.bgm.volume = clamped;
    }

    if (this.dom.bgmVolume) {
      this.dom.bgmVolume.value = String(Math.round(clamped * 100));
    }

    if (this.dom.bgmVolumeValue) {
      this.dom.bgmVolumeValue.textContent = `${Math.round(clamped * 100)}%`;
    }

    if (persist) {
      this.persistSettings();
    }
  }

  /** Plays the background track, retrying once after the first interaction. */
  playBgm() {
    const bgm = this.dom.bgm;

    if (!bgm || !this.bgmEnabled) {
      return;
    }

    const promise = bgm.play();

    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {
        this.armBgmUnlock();
      });
    }
  }

  /** Arms a one-shot listener that starts playback on the next user gesture. */
  armBgmUnlock() {
    if (this.bgmUnlockArmed) {
      return;
    }

    this.bgmUnlockArmed = true;

    const unlock = () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      this.bgmUnlockArmed = false;

      if (this.bgmEnabled) {
        const bgm = this.dom.bgm;

        if (bgm) {
          bgm.play().catch(() => {});
        }
      }
    };

    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
  }

  /* ===================== Ending / results ===================== */

  requestEndQuiz() {
    if (!this.quiz.active) {
      return;
    }

    const unfinished = this.quiz.getAnsweredCount() < this.quiz.getTotal();
    const message = unfinished
      ? "Are you sure you want to quit? Unanswered questions will be marked as incorrect."
      : "Are you sure you want to end the quiz and view your results?";

    this.confirmAction({
      message,
      confirmLabel: "Quit",
      cancelLabel: "Keep Playing"
    }).then((confirmed) => {
      if (confirmed) {
        this.finishQuiz();
      }
    });
  }

  finishQuiz() {
    this.cancelAutoAdvance();
    this.clearCountdown();
    this.timer.stop();
    this.quiz.end();
    Sound.play("finish");

    // Quizmaster scores are only revealed once play is over.
    if (this.mode === "quizmaster") {
      this.tallyTeamScores();
    }

    this.showScreen("results");
    this.renderResults();
    this.dom.resultsTitle.focus({ preventScroll: true });
  }

  /**
   * Records the answering team's score for this session as its best result:
   * the team keeps the higher of its previous best and this session's correct
   * count. Scores never decrease. Called once, when the quizmaster session
   * ends, so the leaderboard stays hidden at zero throughout the quiz.
   */
  tallyTeamScores() {
    const team = this.scoreboard.getTeam(this.answeringTeam);

    if (!team) {
      return;
    }

    let correct = 0;
    this.quiz.questions.forEach((question, index) => {
      const saved = this.responses.get(index);

      if (saved && saved.isCorrect) {
        correct += 1;
      }
    });

    team.raiseTo(correct);
    this.teamBestScores.set(team.name, team.score);

    if (window.QuizApi && QuizApi.isAvailable()) {
      QuizApi.setTeamScore(team.name, team.score).catch((error) => {
        console.warn("Failed to save team score:", error);
      });
    }
  }

  renderResults() {
    this.renderSummary();
    this.renderResultsLeaderboard();
    this.renderReview();
    this.updateRetryButton();
  }

  /** Questions from the finished session that were not answered correctly. */
  getIncorrectQuestions() {
    return this.quiz.questions.filter((question, index) => {
      const saved = this.responses.get(index);
      return !(saved && saved.isCorrect);
    });
  }

  /** Shows the retry button only in practice mode when something was missed. */
  updateRetryButton() {
    if (!this.dom.retryBtn) {
      return;
    }

    this.dom.retryBtn.hidden = !(this.mode === "practice" && this.getIncorrectQuestions().length > 0);
  }

  retryIncorrect() {
    if (this.mode !== "practice") {
      return;
    }

    const missed = this.getIncorrectQuestions();

    if (missed.length === 0) {
      return;
    }

    this.startQuiz(missed);
  }

  renderSummary() {
    const container = this.dom.resultsSummary;
    container.innerHTML = "";

    const total = this.quiz.getTotal();
    const correct = this.quiz.getScore();
    const answered = this.quiz.getAnsweredCount();
    const incorrect = Math.max(0, answered - correct);
    const skipped = Math.max(0, total - answered);

    if (this.mode === "practice") {
      this.dom.resultsTitle.textContent = "Quiz Complete";

      const percent = this.quiz.getPercentage();

      const pct = document.createElement("p");
      pct.className = "summary-percent";
      pct.textContent = `${percent}%`;

      const tiles = document.createElement("div");
      tiles.className = "summary-tiles";
      tiles.append(
        this.buildStatTile("Correct", correct, "correct"),
        this.buildStatTile("Incorrect", incorrect, "wrong"),
        this.buildStatTile("Skipped", skipped, "skipped")
      );

      const note = document.createElement("p");
      note.className = "summary-note";
      note.textContent = this.getPerformanceMessage(percent);

      container.append(pct, tiles, note);
      return;
    }

    this.dom.resultsTitle.textContent = "Final Standings";

    const leaders = this.scoreboard.getLeaders();
    const winner = document.createElement("p");
    winner.className = "summary-score";

    if (leaders.length === 0) {
      winner.textContent = "No points were scored.";
    } else if (this.scoreboard.hasTies()) {
      winner.textContent = `It's a tie: ${leaders.map((team) => team.name).join(", ")} (${this.scoreboard.getTopScore()} pts)`;
    } else {
      winner.textContent = `Winner: ${leaders[0].name} with ${leaders[0].score} pts`;
    }

    const tiles = document.createElement("div");
    tiles.className = "summary-tiles";
    tiles.append(
      this.buildStatTile("Correct", correct, "correct"),
      this.buildStatTile("Incorrect", incorrect, "wrong"),
      this.buildStatTile("Skipped", skipped, "skipped")
    );

    const note = document.createElement("p");
    note.className = "summary-note";
    note.textContent = `Questions answered: ${answered} / ${total}.`;

    container.append(winner, tiles, note);
  }

  buildStatTile(label, value, variant) {
    const tile = document.createElement("div");
    tile.className = `stat-tile stat-${variant}`;

    const num = document.createElement("span");
    num.className = "stat-value";
    num.textContent = String(value);

    const lbl = document.createElement("span");
    lbl.className = "stat-label";
    lbl.textContent = label;

    tile.append(num, lbl);
    return tile;
  }

  getPerformanceMessage(percent) {
    if (percent >= 90) {
      return "Outstanding — you have a strong command of cybersecurity fundamentals.";
    }

    if (percent >= 70) {
      return "Great work — review a few weak areas and you'll be exam-ready.";
    }

    if (percent >= 50) {
      return "Good start — revisit the explanations below to reinforce the basics.";
    }

    return "Keep practicing — study the review list below and try again.";
  }

  renderResultsLeaderboard() {
    const container = this.dom.resultsLeaderboard;
    container.innerHTML = "";
    container.hidden = this.mode !== "quizmaster";

    if (this.mode !== "quizmaster") {
      return;
    }

    const heading = document.createElement("h3");
    heading.textContent = "Leaderboard";
    container.appendChild(heading);

    const list = document.createElement("ol");
    list.className = "leaderboard-list";

    this.scoreboard.getRankings().forEach((entry) => {
      const item = document.createElement("li");
      item.className = "leaderboard-item";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `#${entry.rank}`;

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = entry.name;

      const score = document.createElement("span");
      score.className = "leaderboard-score";
      score.textContent = `${entry.score} pts`;

      item.append(rank, name, score);
      list.appendChild(item);
    });

    container.appendChild(list);
  }

  /** Builds a uniform view model for every question in the session. */
  getReviewEntries() {
    return this.quiz.questions.map((question, index) => {
      const saved = this.responses.get(index) || null;

      return { question, index, saved, isCorrect: Boolean(saved && saved.isCorrect) };
    });
  }

  setReviewFilter(value) {
    if (value !== "all" && value !== "incorrect") {
      return;
    }

    this.reviewFilter = value;
    this.renderReview();
  }

  /** Renders the All / Incorrect-only review filter chips. */
  renderReviewFilter(entries) {
    const container = this.dom.reviewFilter;

    if (!container) {
      return;
    }

    container.innerHTML = "";
    container.hidden = entries.length === 0;

    if (entries.length === 0) {
      return;
    }

    const wrongCount = entries.filter((entry) => !entry.isCorrect).length;
    const options = [
      { value: "all", label: `All (${entries.length})` },
      { value: "incorrect", label: `Incorrect only (${wrongCount})` }
    ];

    options.forEach((option) => {
      const isActive = this.reviewFilter === option.value;
      const button = document.createElement("button");

      button.type = "button";
      button.className = "review-filter-btn";
      button.dataset.action = "review-filter";
      button.dataset.filter = option.value;
      button.textContent = option.label;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.classList.toggle("active", isActive);

      container.appendChild(button);
    });
  }

  renderReview() {
    const container = this.dom.reviewList;
    container.innerHTML = "";

    const entries = this.getReviewEntries();
    this.renderReviewFilter(entries);

    const heading = document.createElement("h3");
    heading.textContent = "Answer Review";
    container.appendChild(heading);

    const visible = entries.filter((entry) => this.reviewFilter === "all" || !entry.isCorrect);

    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No questions match this filter - every answer was correct.";
      container.appendChild(empty);
      return;
    }

    const list = document.createElement("ul");
    list.className = "review-list";

    visible.forEach((entry) => {
      list.appendChild(this.buildReviewItem(entry.question, entry.index, entry.saved));
    });

    container.appendChild(list);
  }

  buildReviewItem(question, index, saved) {
    const item = document.createElement("li");
    const wasAnswered = saved && saved.answered;
    const isCorrect = Boolean(saved && saved.isCorrect);

    item.className = "review-item";
    item.classList.add(isCorrect ? "review-correct" : "review-wrong");

    const top = document.createElement("div");
    top.className = "review-top";

    const number = document.createElement("span");
    number.className = "review-number";
    number.textContent = `Q${index + 1}`;

    const badge = document.createElement("span");
    badge.className = "review-badge";
    badge.textContent = isCorrect ? "Correct" : wasAnswered ? "Incorrect" : "Skipped";

    top.append(number, badge);

    const text = document.createElement("p");
    text.className = "review-question";
    text.textContent = question.text;

    const yourAnswer = document.createElement("p");
    yourAnswer.className = "review-line";

    const yourLabel = document.createElement("strong");
    yourLabel.textContent = "Your answer: ";

    let given = "—";

    if (wasAnswered && saved && saved.response !== null && saved.response !== undefined) {
      given = question.isMultipleChoice()
        ? question.options[Number(saved.response)]
        : String(saved.response);
    }

    yourAnswer.append(yourLabel, document.createTextNode(given));

    const correctAnswer = document.createElement("p");
    correctAnswer.className = "review-line";

    const correctLabel = document.createElement("strong");
    correctLabel.textContent = "Correct answer: ";

    correctAnswer.append(correctLabel, document.createTextNode(question.getCorrectAnswer()));

    if (this.mode === "quizmaster" && saved && saved.team) {
      const teamLine = document.createElement("p");
      teamLine.className = "review-line review-team";

      const teamLabel = document.createElement("strong");
      teamLabel.textContent = "Answering team: ";

      teamLine.append(teamLabel, document.createTextNode(saved.team));
      item.append(top, text, teamLine, yourAnswer, correctAnswer);
    } else {
      item.append(top, text, yourAnswer, correctAnswer);
    }

    if (question.explanation) {
      const explanation = document.createElement("p");
      explanation.className = "review-explanation";
      explanation.textContent = question.explanation;
      item.appendChild(explanation);
    }

    return item;
  }

  /* ===================== Imported questions ===================== */

  /** Rebuilds the active question list (base + imported) and its Quiz. */
  rebuildBank() {
    this.questions = [...this.baseQuestions, ...this.importedQuestions];
    this.quiz = new Quiz(this.questions);
  }

  handleImportFile(file) {
    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      this.importQuestionsFromText(file.name, String(reader.result || ""));
    };

    reader.onerror = () => {
      this.showImportStatus("Could not read that file. Please try again.", "error");
    };

    reader.readAsText(file);
  }

  async importQuestionsFromText(fileName, text) {
    const parsed = parseImportFile(fileName, text);
    const existingKeys = this.questions.map((question) => questionKey(question));
    const { unique, duplicates } = filterDuplicateQuestions(parsed.questions, existingKeys);

    let newQuestions = [];

    if (unique.length > 0) {
      const payload = unique.map((data) => ({
        type: data.type,
        text: data.text,
        options: data.options,
        correctAnswer: data.correctAnswer,
        acceptedAnswers: data.acceptedAnswers,
        explanation: data.explanation
      }));

      try {
        if (window.QuizApi && QuizApi.isAvailable()) {
          const inserted = await QuizApi.addQuestions(payload);
          newQuestions = (inserted || []).map((data) => new Question(data));
        } else {
          const startId = this.getMaxQuestionId() + 1;
          newQuestions = unique.map((data, index) => new Question({
            id: startId + index,
            type: data.type,
            text: data.text,
            options: data.options,
            correctAnswer: data.correctAnswer,
            acceptedAnswers: data.acceptedAnswers,
            explanation: data.explanation
          }));
        }
      } catch (error) {
        this.showImportStatus(`Could not save imported questions: ${error}`, "error");
        return;
      }

      this.importedQuestions.push(...newQuestions);
      this.rebuildBank();
      this.updateBankStats();
    }

    this.reportImportResult(fileName, newQuestions.length, duplicates.length, parsed.errors, parsed.warnings);
  }

  getMaxQuestionId() {
    return this.questions.reduce((max, question) => Math.max(max, Number(question.id) || 0), 0);
  }

  reportImportResult(fileName, importedCount, duplicateCount, errors, warnings = []) {
    const parts = [];

    if (importedCount > 0) {
      parts.push(`${importedCount} question${importedCount === 1 ? "" : "s"} imported`);
    }

    if (duplicateCount > 0) {
      parts.push(`${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped`);
    }

    if (errors.length > 0) {
      parts.push(`${errors.length} invalid row${errors.length === 1 ? "" : "s"} skipped`);
    }

    if (parts.length === 0) {
      this.showImportStatus(`${fileName}: no valid questions found.${errors.length ? ` ${errors[0]}` : ""}`, "error");
      return;
    }

    const detail = errors.length > 0 ? ` ${errors[0]}` : "";
    const warning = warnings.length > 0 ? ` ${warnings.length} row${warnings.length === 1 ? "" : "s"} had unexpected column counts. ${warnings[0]}` : "";

    this.showImportStatus(`${fileName}: ${parts.join(", ")}.${detail}${warning}`, importedCount > 0 ? "success" : "error");
  }

  async clearImported() {
    if (this.importedQuestions.length === 0) {
      this.showImportStatus("There are no imported questions to clear.", "error");
      return;
    }

    if (!window.confirm(`Remove all ${this.importedQuestions.length} imported question(s)?`)) {
      return;
    }

    try {
      if (window.QuizApi && QuizApi.isAvailable()) {
        await QuizApi.clearImported();
      }

      this.importedQuestions = [];
      this.rebuildBank();
      this.updateBankStats();
      this.showImportStatus("Imported questions cleared. The built-in bank is unchanged.", "success");
    } catch (error) {
      this.showImportStatus(`Could not clear imported questions: ${error}`, "error");
    }
  }

  showImportStatus(message, variant) {
    const status = this.dom.importStatus;

    status.textContent = message;
    status.hidden = false;
    status.className = variant ? `import-status ${variant}` : "import-status";

    if (this.importStatusHandle !== null) {
      window.clearTimeout(this.importStatusHandle);
    }

    // Let the message be read, then clear it so it never lingers stale.
    this.importStatusHandle = window.setTimeout(() => {
      status.hidden = true;
      this.importStatusHandle = null;
    }, 6000);
  }

  /** Builds the example import template as a CSV string. */
  buildTemplateCsv() {
    const rows = [
      ["type", "question", "optionA", "optionB", "optionC", "optionD", "answer", "acceptedAnswers", "explanation"],
      ["multiple-choice", "What is the primary purpose of a firewall?", "Filter network traffic by rules", "Repair damaged hardware", "Create passwords", "Increase storage", "A", "", "A firewall filters network traffic using security rules."],
      ["scramble", "The practice of tricking users into revealing sensitive information.", "", "", "", "", "Phishing", "phishing | phishing email", "Phishing uses deceptive messages or sites."]
    ];
    const csvCell = (value) => {
      const text = String(value === null || value === undefined ? "" : value);

      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  }

  /** Opens the "Download Template" modal. */
  openTemplateModal() {
    if (!this.dom.templateOverlay) {
      // No modal available: fall back to a straight browser download.
      this.downloadTemplateBlob();
      return;
    }

    this.templateReturnFocus = document.activeElement;
    this.templateOpen = true;
    this.dom.templateOverlay.hidden = false;
    Sound.play("confirm");

    const primary = this.dom.templateOverlay.querySelector('[data-action="template-save"]');

    if (primary) {
      primary.focus({ preventScroll: true });
    }
  }

  /** Closes the template modal and restores focus. */
  closeTemplateModal() {
    if (!this.dom.templateOverlay) {
      return;
    }

    this.dom.templateOverlay.hidden = true;
    this.templateOpen = false;

    if (this.templateReturnFocus && typeof this.templateReturnFocus.focus === "function") {
      this.templateReturnFocus.focus({ preventScroll: true });
    }

    this.templateReturnFocus = null;
  }

  /** True when the Tauri desktop shell (and its dialog plugin) is available. */
  canUseNativeTemplateSave() {
    return Boolean(
      window.QuizApi &&
      QuizApi.isAvailable() &&
      window.__TAURI__ &&
      window.__TAURI__.dialog &&
      typeof window.__TAURI__.dialog.save === "function"
    );
  }

  /** Saves the template to the default Downloads folder. */
  async saveTemplateToDownloads() {
    const csv = this.buildTemplateCsv();

    if (!this.canUseNativeTemplateSave()) {
      this.downloadTemplateBlob(csv);
      this.closeTemplateModal();
      this.showImportStatus("Template downloaded.", "success");
      return;
    }

    try {
      const path = await QuizApi.saveTemplateToDownloads(csv);

      this.closeTemplateModal();
      this.showImportStatus(`Template saved to ${path}.`, "success");
    } catch (error) {
      this.showImportStatus(`Could not save the template: ${error}`, "error");
    }
  }

  /** Saves the template to a user-chosen location. */
  async saveTemplateAs() {
    const csv = this.buildTemplateCsv();

    if (!this.canUseNativeTemplateSave()) {
      this.downloadTemplateBlob(csv);
      this.closeTemplateModal();
      this.showImportStatus("Template downloaded.", "success");
      return;
    }

    const path = await this.pickTemplatePath("quiz-questions-template.csv");

    if (!path) {
      return;
    }

    try {
      await QuizApi.saveTemplateFile(path, csv);
      this.closeTemplateModal();
      this.showImportStatus(`Template saved to ${path}.`, "success");
    } catch (error) {
      this.showImportStatus(`Could not save the template: ${error}`, "error");
    }
  }

  /** Saves the template, then opens the saved file with the default app. */
  async openTemplateFile() {
    const csv = this.buildTemplateCsv();

    if (!this.canUseNativeTemplateSave()) {
      this.downloadTemplateBlob(csv);
      this.closeTemplateModal();
      this.showImportStatus("Template downloaded.", "success");
      return;
    }

    const path = await this.pickTemplatePath("quiz-questions-template.csv");

    if (!path) {
      return;
    }

    try {
      await QuizApi.saveTemplateFile(path, csv);
      await QuizApi.openFile(path);
      this.closeTemplateModal();
      this.showImportStatus(`Template saved to ${path} and opened.`, "success");
    } catch (error) {
      this.showImportStatus(`Could not open the template: ${error}`, "error");
    }
  }

  /** Native save dialog; resolves to a path or null when cancelled. */
  async pickTemplatePath(defaultName) {
    try {
      return await window.__TAURI__.dialog.save({
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }]
      });
    } catch (error) {
      this.showImportStatus(`Could not open the save dialog: ${error}`, "error");
      return null;
    }
  }

  /** Browser fallback: triggers a download via a temporary anchor. */
  downloadTemplateBlob(csv = this.buildTemplateCsv()) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "quiz-questions-template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoking immediately can cancel the download in some browsers (Safari).
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /* ===================== Bank stats ===================== */

  /**
   * Applies persisted settings (level/timer/shuffle) to the setup form.
   * Safe to call with null/partial data.
   * @param {object} settings
   */
  applySettings(settings) {
    if (!settings) {
      return;
    }

    if (settings.shuffleChoicesDefault !== undefined && this.dom.shuffleChoices) {
      this.dom.shuffleChoices.checked = Boolean(settings.shuffleChoicesDefault);
    }

    if (settings.soundDefault !== undefined) {
      this.setSoundEnabled(settings.soundDefault);
    }

    if (settings.bgmDefault !== undefined) {
      this.setBgmEnabled(settings.bgmDefault);
    }

    if (settings.bgmVolumeDefault !== undefined) {
      this.setBgmVolume(Number(settings.bgmVolumeDefault) / 100);
    }

    if (settings.levelDefault !== undefined) {
      const levelInput = document.querySelector(`input[name="level"][value="${settings.levelDefault}"]`);

      if (levelInput) {
        levelInput.checked = true;
      }
    }

    if (settings.timerDefault !== undefined) {
      const input = document.querySelector(`input[name="timer"][value="${settings.timerDefault}"]`);

      if (input) {
        input.checked = true;
      }
    }

    // Apply the level before resolving the count so the number-of-questions
    // chips reflect the correct pool.
    this.updateBankStats();
    this.restoreCountSetting(settings.questionCountDefault);
  }

  /**
   * Re-checks the saved "Number of questions" chip after the level has been
   * applied. Falls back to the current selection when the saved value is no
   * longer available (e.g. 40 saved but the Normal level only offers 24).
   */
  restoreCountSetting(saved) {
    if (saved === undefined || saved === null || saved === "") {
      return;
    }

    const group = this.dom.countGroup;

    if (!group) {
      return;
    }

    let target = null;

    if (saved === "all") {
      target = this.dom.countAllOption
        ? this.dom.countAllOption.querySelector('input[name="count"]')
        : null;
    } else {
      target = group.querySelector(`input[name="count"][value="${saved}"]`);
    }

    const chip = target ? target.closest(".count-option") : null;

    if (target && chip && !chip.hidden) {
      target.checked = true;
    }
  }

  /** Saves the current setup selections to SQLite (best effort). */
  persistSettings() {
    if (!window.QuizApi || !QuizApi.isAvailable()) {
      return;
    }

    const allInput = this.dom.countAllOption
      ? this.dom.countAllOption.querySelector('input[name="count"]')
      : null;
    const countValue = allInput && allInput.checked ? "all" : this.readSetting("count", "40");

    QuizApi.setSetting("level_default", this.readSetting("level", "normal")).catch(() => {});
    QuizApi.setSetting("timer_default", this.readSetting("timer", "0")).catch(() => {});
    QuizApi.setSetting("question_count_default", countValue).catch(() => {});
    QuizApi.setSetting("sound_default", this.soundEnabled ? "true" : "false").catch(() => {});
    QuizApi.setSetting("bgm_default", this.bgmEnabled ? "true" : "false").catch(() => {});
    QuizApi.setSetting("bgm_volume_default", String(Math.round(this.bgmVolume * 100))).catch(() => {});
    QuizApi.setSetting(
      "shuffle_choices_default",
      this.dom.shuffleChoices && this.dom.shuffleChoices.checked ? "true" : "false"
    ).catch(() => {});
  }

  updateBankStats() {
    const pool = this.getLevelPool();
    const levelConfig = this.getLevelConfig();
    const total = pool.length;
    const mc = pool.filter((question) => question.isMultipleChoice()).length;
    const scramble = pool.filter((question) => question.isScramble()).length;

    this.dom.bankTotal.textContent = String(total);
    this.dom.bankMc.textContent = String(mc);
    this.dom.bankId.textContent = String(scramble);

    const effectiveMax = Math.min(total, levelConfig.max);

    if (this.dom.levelHelp) {
      this.dom.levelHelp.textContent = `${levelConfig.label} level: ${total} question${total === 1 ? "" : "s"} available. Maximum of ${effectiveMax} per round.`;
    }

    if (this.dom.countHelp) {
      const typeNote = levelConfig.types.indexOf(Question.TYPE_SCRAMBLE) !== -1
        ? "multiple choice and scramble"
        : "multiple choice only";
      this.dom.countHelp.textContent = `Maximum of ${effectiveMax} questions per round (${typeNote}).`;
    }

    // The round size can never exceed the level's cap or the available pool.
    this.syncCountOptions(effectiveMax);
  }

  /**
   * Keeps the "Number of questions" chips in step with the bank size:
   * presets larger than the bank are hidden, and an "All" chip appears
   * unless the exact bank size is already a preset. When the bank exceeds
   * the base presets (50), a dynamic chip for the exact total is created.
   */
  syncCountOptions(total) {
    const group = this.dom.countGroup;

    if (!group) {
      return;
    }

    // Remove any previously created dynamic chips.
    const dynamicChips = group.querySelectorAll(".count-option[data-dynamic='true']");
    dynamicChips.forEach((chip) => chip.remove());

    const basePresets = [10, 20, 30, 40, 50];

    // When the bank exceeds 50, create a dynamic chip for the exact total.
    const dynamicChipNeeded = total > 0 && total > 50 && basePresets.indexOf(total) === -1;
    if (dynamicChipNeeded) {
      const chip = this._createCountOption(total);
      chip.dataset.dynamic = "true";
      group.insertBefore(chip, this.dom.countAllOption || null);
    }

    const allPresets = dynamicChipNeeded ? [...basePresets, total] : basePresets;
    const presetLabels = group.querySelectorAll(".count-option[data-count]");
    let anyVisiblePreset = false;

    presetLabels.forEach((label) => {
      const value = Number(label.dataset.count);
      const show = total > 0 && value <= total;
      const input = label.querySelector('input[name="count"]');

      label.hidden = !show;

      if (show) {
        anyVisiblePreset = true;
      } else if (input) {
        input.checked = false;
      }
    });

    const allLabel = this.dom.countAllOption;

    if (allLabel) {
      const allInput = allLabel.querySelector('input[name="count"]');
      const showAll = total > 0 && allPresets.indexOf(total) === -1;

      allLabel.hidden = !showAll;

      if (allInput) {
        allInput.value = String(total);

        if (!showAll) {
          allInput.checked = false;
        }
      }

      if (this.dom.countAllLabel) {
        this.dom.countAllLabel.textContent = `All (${total})`;
      }
    }

    // Never leave the group without a valid selection.
    if (!group.querySelector('input[name="count"]:checked')) {
      const fallback = this.dom.countAllOption && !this.dom.countAllOption.hidden
        ? this.dom.countAllOption.querySelector('input[name="count"]')
        : null;

      if (fallback) {
        fallback.checked = true;
      } else if (anyVisiblePreset) {
        const visible = Array.from(presetLabels).filter((label) => !label.hidden);
        const largest = visible[visible.length - 1];
        const input = largest && largest.querySelector('input[name="count"]');

        if (input) {
          input.checked = true;
        }
      }
    }

    this.syncStartState(total);
  }

  /**
   * Creates a number-of-questions chip matching the HTML template structure.
   * @param {number} value
   * @returns {HTMLLabelElement}
   */
  _createCountOption(value) {
    const label = document.createElement("label");
    label.className = "option-chip count-option";
    label.dataset.count = String(value);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "count";
    input.value = String(value);

    const span = document.createElement("span");
    span.textContent = String(value);

    label.append(input, span);
    return label;
  }

  syncStartState(total) {
    if (!this.dom.startBtn) {
      return;
    }

    const empty = total === 0;
    this.dom.startBtn.disabled = empty;
    this.dom.startBtn.title = empty ? "Import some questions to begin." : "";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  let questions = Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [];
  let settings = null;
  let savedTeams = [];

  if (window.QuizApi && QuizApi.isAvailable()) {
    try {
      const loaded = await QuizApi.getQuestions();

      if (Array.isArray(loaded) && loaded.length > 0) {
        questions = loaded;
      }
    } catch (error) {
      console.error("Could not load questions from the database; using built-in bank.", error);
    }

    try {
      settings = await QuizApi.getSettings();
    } catch (error) {
      console.warn("Could not load settings:", error);
    }

    try {
      const teams = await QuizApi.getTeams();
      if (Array.isArray(teams)) {
        savedTeams = teams.map((t) => ({ name: t.name, score: Number(t.score) || 0 }));
      }
    } catch (error) {
      console.warn("Could not load teams:", error);
    }
  }

  const app = new QuizApp(questions);
  app.applySettings(settings);

  if (savedTeams.length > 0) {
    app.teamsDraft = savedTeams.map((team) => team.name);
    savedTeams.forEach((team) => app.teamBestScores.set(team.name, team.score));
    app.renderTeamsDraft();
  }

  window.quizApp = app;
});
