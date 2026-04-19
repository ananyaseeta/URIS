// src/services/alertService.js
// ─────────────────────────────────────────────────────────────────────────────
// Alert System — generates, retrieves, and resolves alerts.
//
// Alert types:
//   stale_task          — task not updated in 2+ days, deadline within 5 days
//   blocker_escalation  — blocked task not resolved within 48–96 hrs
//   compliance_failure  — intern missed availability submission window
//   reassignment        — middleware recommends reassigning a task
// ─────────────────────────────────────────────────────────────────────────────

const prisma = require('../utils/prisma');

// ─────────────────────────────────────────────────────────────────────────────
// generateBlockerAlerts()
// Checks all tasks with active blockers. If the blocker has existed for:
//   ≥ 48 hrs → create a "blocker_escalation" alert (notify blocking party)
//   ≥ 96 hrs → escalate severity in the alert message (for lead attention)
// ─────────────────────────────────────────────────────────────────────────────
async function generateBlockerAlerts() {
  const blockedTasks = await prisma.task.findMany({
    where: { hasBlocker: true, status: { not: 'completed' } }
  });

  let created = 0;

  for (const task of blockedTasks) {
    const hoursBlocked = (Date.now() - new Date(task.lastUpdatedAt).getTime()) / (1000 * 60 * 60);

    if (hoursBlocked < 48) continue; // not yet threshold

    const existing = await prisma.alert.findFirst({
      where: { taskId: task.id, type: 'blocker_escalation', resolved: false }
    });
    if (existing) continue; // already alerted

    const isEscalated = hoursBlocked >= 96;
    const message = isEscalated
      ? `ESCALATED: Task "${task.title}" has been blocked for ${Math.round(hoursBlocked)} hours. Lead attention required.`
      : `Task "${task.title}" has been blocked for ${Math.round(hoursBlocked)} hours. Blocking party notified.`;

    await prisma.alert.create({
      data: {
        internId: task.internId,
        type:     'blocker_escalation',
        taskId:   task.id,
        message
      }
    });
    created++;
  }

  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateReassignmentAlerts(internId, finalCapacity)
// If an intern's finalCapacity drops below 0.2, flag them for reassignment review.
// Called from capacityService after each compute cycle.
// ─────────────────────────────────────────────────────────────────────────────
async function generateReassignmentAlerts(internId, finalCapacity) {
  if (finalCapacity >= 0.2) return;

  const existing = await prisma.alert.findFirst({
    where: { internId, type: 'reassignment', resolved: false }
  });
  if (existing) return;

  await prisma.alert.create({
    data: {
      internId,
      type:    'reassignment',
      message: `Intern ${internId} has a final capacity score of ${Math.round(finalCapacity * 100)}. Consider reassigning active tasks.`
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getAllActiveAlerts()
// Returns all unresolved alerts ordered by creation time (newest first).
// ─────────────────────────────────────────────────────────────────────────────
async function getAllActiveAlerts() {
  return prisma.alert.findMany({
    where:   { resolved: false },
    orderBy: { createdAt: 'desc' }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveAlert(alertId)
// Marks an alert as resolved. Called by PATCH /alerts/:id/resolve.
// ─────────────────────────────────────────────────────────────────────────────
async function resolveAlert(alertId) {
  return prisma.alert.update({
    where: { id: alertId },
    data:  { resolved: true }
  });
}

module.exports = {
  generateBlockerAlerts,
  generateReassignmentAlerts,
  getAllActiveAlerts,
  resolveAlert
};
