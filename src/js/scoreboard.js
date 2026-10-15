/**
 * Scoreboard
 * -----------------------------------------------------------
 * Manages a collection of Team instances. Provides ranked views,
 * detects ties, and exposes the current leaders. The internal team
 * list keeps insertion order; rankings are returned as copies.
 */
class Scoreboard {
  constructor() {
    /** @type {Team[]} */
    this.teams = [];
  }

  /**
   * Adds a team if the name is valid and not already used.
   * @param {string} name
   * @param {number} [score]
   * @returns {Team|null}
   */
  addTeam(name, score = 0) {
    const cleanName = String(name || "").trim();

    if (cleanName.length === 0 || this.getTeam(cleanName)) {
      return null;
    }

    const team = new Team(cleanName, score);
    this.teams.push(team);

    return team;
  }

  /**
   * Removes a team by name.
   * @param {string} name
   * @returns {boolean} True when a team was removed.
   */
  removeTeam(name) {
    const index = this.teams.findIndex((team) => team.name === name);

    if (index === -1) {
      return false;
    }

    this.teams.splice(index, 1);

    return true;
  }

  /**
   * Case-insensitive lookup by team name.
   * @param {string} name
   * @returns {Team|null}
   */
  getTeam(name) {
    const target = String(name || "").trim().toLowerCase();

    return this.teams.find((team) => team.name.toLowerCase() === target) || null;
  }

  hasTeams() {
    return this.teams.length > 0;
  }

  getTeamNames() {
    return this.teams.map((team) => team.name);
  }

  reset() {
    this.teams.forEach((team) => team.resetScore());
  }

  /**
   * Highest score currently on the board (0 when empty).
   * @returns {number}
   */
  getTopScore() {
    return this.teams.reduce((max, team) => Math.max(max, team.score), 0);
  }

  /**
   * Returns teams sorted by score (desc) with a `rank` attached.
   * Ties share the same rank (standard competition ranking).
   * The scoreboard itself is NOT reordered.
   *
   * @returns {Array<{name:string, score:number, rank:number}>}
   */
  getRankings() {
    const sorted = this.teams
      .map((team) => ({ name: team.name, score: team.score }))
      .sort((a, b) => b.score - a.score);

    let lastScore = null;
    let lastRank = 0;

    return sorted.map((entry, index) => {
      const rank = entry.score === lastScore ? lastRank : index + 1;
      lastScore = entry.score;
      lastRank = rank;

      return { ...entry, rank };
    });
  }

  /**
   * True when two or more teams share the top score.
   * Returns false when no team has scored yet, so a 0-0 board is never
   * reported as a tie.
   * @returns {boolean}
   */
  hasTies() {
    if (this.teams.length < 2) {
      return false;
    }

    const topScore = this.getTopScore();

    if (topScore <= 0) {
      return false;
    }

    return this.teams.filter((team) => team.score === topScore).length > 1;
  }

  /**
   * All teams tied for first place. Empty when no team has scored, so
   * an unscored board never declares a winner.
   * @returns {Team[]}
   */
  getLeaders() {
    const topScore = this.getTopScore();

    if (topScore <= 0) {
      return [];
    }

    return this.teams.filter((team) => team.score === topScore);
  }
}
