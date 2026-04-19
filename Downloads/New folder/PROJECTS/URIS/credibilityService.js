// src/services/credibilityService.js
// ─────────────────────────────────────────────────────────────────────────────
// Credibility Engine — evaluates intern reliability using three behavioral signals:
//   Signal 1: Update Frequency    (weight: 0.35)
//   Signal 2: Deadline Adherence  (weight: 0.40)
//   Signal 3: Throughput Accuracy (weight: 0.25)
//
// Final score is 0–1 (saved to DB) and 0–100 (returned in API responses).
// ─────────────────────────────────────────────────────────────────────────────

const prisma = require('../utils/prisma');

const WINDOW_DAYS     = 14;   // look at last 14 days of task data
const UPDATE_WEIGHT   = 0.35;
const DEADLINE_WEIGHT = 0.40;
const THROUGHPUT_WEIGHT = 0.25;

// ─────────────────────────────────────────────────────────────────────────────
// Signal 1 — Update Frequency
// How consistently does the intern update their tasks?
// Score = proportion of tasks that received an update within 2 days during
//         the observation window. Neutral 0.5 if no data exists yet.
// ─────────────────────────────────────────────────────────────────────────────
async function computeUpdateFrequency(internId) {
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: { internId, createdAt: { gt: windowStart }, status: { not: 'completed' } }
  });

  if (tasks.length === 0) return 0.5; // neutral — no history yet

  const twoDaysMs   = 2 * 24 * 60 * 60 * 1000;
  const updatedOnTime = tasks.filter(task => {
    const msSinceUpdate = Date.now() - new Date(task.lastUpdatedAt).getTime();
    return msSinceUpdate <= twoDaysMs;
  });

  return updatedOnTime.length / tasks.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal 2 — Deadline Adherence
// Of all tasks with deadlines that were completed, what fraction were on time?
// Neutral 0.5 if no completed tasks with deadlines exist yet.
// ─────────────────────────────────────────────────────────────────────────────
async function computeDeadlineAdherence(internId) {
  const completedWithDeadline = await prisma.task.findMany({
    where: { internId, status: 'completed', deadline: { not: null } }
  });

  if (completedWithDeadline.length === 0) return 0.5;

  const onTime = completedWithDeadline.filter(task =>
    new Date(task.lastUpdatedAt) <= new Date(task.deadline)
  );

  return onTime.length / completedWithDeadline.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal 3 — Throughput Accuracy
// Does the intern's actual task output match what their declared availability
// would predict? Uses base_capacity (0–1) from Person A to estimate expected
// task completions per week. Score clamped to 0–1.
//
// Heuristic: base_capacity of 1.0 ≈ 3 completable tasks/week (tunable).
// ─────────────────────────────────────────────────────────────────────────────
async function computeThroughputAccuracy(internId, baseCapacity = 0.5) {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const completedThisWeek = await prisma.task.count({
    where: { internId, status: 'completed', lastUpdatedAt: { gt: oneWeekAgo } }
  });

  const TASKS_PER_FULL_CAPACITY = 3; // tune this as the team scales
  const expectedTasks = Math.max(1, Math.round(baseCapacity * TASKS_PER_FULL_CAPACITY));

  return Math.min(completedThisWeek / expectedTasks, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// computeCredibilityScore(internId, baseCapacity)
// Main exported function. Computes all three signals, combines them with
// weights, upserts the result into CredibilityScore table, and returns the
// full breakdown for the API response.
// ─────────────────────────────────────────────────────────────────────────────
async function computeCredibilityScore(internId, baseCapacity = 0.5) {
  try {
    const [updateFreq, deadlineAdh, throughputAcc] = await Promise.all([
      computeUpdateFrequency(internId),
      computeDeadlineAdherence(internId),
      computeThroughputAccuracy(internId, baseCapacity)
    ]);

    const score = (UPDATE_WEIGHT    * updateFreq)   +
                  (DEADLINE_WEIGHT  * deadlineAdh)  +
                  (THROUGHPUT_WEIGHT * throughputAcc);

    const roundedScore = parseFloat(score.toFixed(3));

    // Upsert into DB
    await prisma.credibilityScore.upsert({
      where:  { internId },
      update: {
        updateFrequency:    parseFloat(updateFreq.toFixed(3)),
        deadlineAdherence:  parseFloat(deadlineAdh.toFixed(3)),
        throughputAccuracy: parseFloat(throughputAcc.toFixed(3)),
        score:              roundedScore,
        computedAt:         new Date()
      },
      create: {
        internId,
        updateFrequency:    parseFloat(updateFreq.toFixed(3)),
        deadlineAdherence:  parseFloat(deadlineAdh.toFixed(3)),
        throughputAccuracy: parseFloat(throughputAcc.toFixed(3)),
        score:              roundedScore,
      }
    });

    return {
      internId,
      signals: {
        updateFrequency:    parseFloat(updateFreq.toFixed(3)),
        deadlineAdherence:  parseFloat(deadlineAdh.toFixed(3)),
        throughputAccuracy: parseFloat(throughputAcc.toFixed(3))
      },
      score:       roundedScore,
      scoreOut100: Math.round(roundedScore * 100),
      flag:        roundedScore < 0.5 ? 'low_credibility' : null
    };
  } catch (err) {
    console.error('[credibilityService] computeCredibilityScore error:', err.message);
    throw err;
  }
}

module.exports = { computeCredibilityScore };
