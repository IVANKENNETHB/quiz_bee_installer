/**
 * Team
 * -----------------------------------------------------------
 * Holds a team's display name and score, and exposes safe methods
 * for changing that score. Scores never drop below zero.
 */
class Team {
  /**
   * @param {string} name
   * @param {number} [score]
   */
  constructor(name, score = 0) {
    this.name = String(name || "Unnamed team").trim() || "Unnamed team";
    this.score = Math.max(0, Number(score) || 0);
  }

  /**
   * Adds points to the team's score.
   * @param {number} points
   * @returns {number} The new score.
   */
  addPoints(points) {
    const amount = Math.max(0, Number(points) || 0);
    this.score += amount;

    return this.score;
  }

  /**
   * Deducts points, clamping the score at zero.
   * @param {number} points
   * @returns {number} The new score.
   */
  deductPoints(points) {
    const amount = Math.abs(Number(points) || 0);
    this.score = Math.max(0, this.score - amount);

    return this.score;
  }

  /**
   * Resets the score back to zero.
   * @returns {number}
   */
  resetScore() {
    this.score = 0;

    return this.score;
  }

  /**
   * Raises the score to `value` only when it is higher than the current
   * score, so a team's best score is never lost.
   * @param {number} value
   * @returns {number} The (possibly updated) score.
   */
  raiseTo(value) {
    const amount = Math.max(0, Number(value) || 0);
    if (amount > this.score) {
      this.score = amount;
    }

    return this.score;
  }
}
