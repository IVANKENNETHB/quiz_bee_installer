/**
 * Shared helpers used across the quiz application.
 * Kept as small, pure functions so they are easy to test and reuse.
 */

/**
 * Fisher-Yates (Knuth) shuffle.
 * Returns a NEW shuffled array and never mutates the input, so the
 * original question bank (and any external references) stay intact.
 *
 * @param {Array} items
 * @returns {Array}
 */
function shuffleArray(items) {
  const shuffled = Array.isArray(items) ? [...items] : [];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Picks `count` unique questions at random from a pool.
 * Because it shuffles first and then slices, duplicates cannot occur
 * and the original array is not modified.
 *
 * @param {Array} questions
 * @param {number} count
 * @returns {Array}
 */
function selectRandomQuestions(questions, count) {
  const pool = Array.isArray(questions) ? questions : [];
  const safeCount = Math.max(0, Math.min(Number(count) || 0, pool.length));

  return shuffleArray(pool).slice(0, safeCount);
}

/**
 * Interleaves an ordered list of question-like objects by their `type`,
 * preserving relative order within each type. Used for non-randomized
 * sessions so that "original order" mixes types (e.g. multiple-choice and
 * scramble) instead of returning only the first block of the bank.
 *
 * Items with no `type` are appended last in their original order.
 *
 * @param {Array} questions
 * @returns {Array}
 */
function interleaveByType(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const groups = new Map();

  list.forEach((question) => {
    const key = question && question.type ? question.type : "";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(question);
  });

  const typedKeys = [...groups.keys()].filter((key) => key !== "");
  const result = [];
  let added = true;

  for (let i = 0; added; i += 1) {
    added = false;

    typedKeys.forEach((key) => {
      const group = groups.get(key);
      if (i < group.length) {
        result.push(group[i]);
        added = true;
      }
    });
  }

  if (groups.has("")) {
    result.push(...groups.get(""));
  }

  return result;
}

/**
 * Normalizes a free-text answer for comparison:
 * lowercases, trims, collapses whitespace, and strips punctuation.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeAnswer(value) {
  return String(value === null || value === undefined ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Formats seconds as M:SS for the timer display.
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
