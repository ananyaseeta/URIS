const prisma = require('../utils/prisma');

/**
 * Generate blocker escalation alerts for tasks that have been blocked
 * for more than 48 hours. Escalates to critical at 96 hours.
 */
async function generateBlockerAlerts() {
  const blockedTasks = await prisma.task.findMany({
    where: { hasBlocker: true, status: { not: 'completed' } },
  });

  let created = 0;

  for (const task of blockedTasks) {
    const hoursBlocked = (Date.now() - new Date(task.lastUpdatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursBlocked < 48) continue;

    // Idempotent generation: do not create duplicate unresolved escalation alerts.
    const existing = await prisma.alert.findFirst({
      where: { taskId: task.id, type: 'blocker_escalation', resolved: false },
    });
    if (existing) continue;

    const isEscalated = hoursBlocked >= 96;

    // 48h => medium severity (blocker party)
    // 96h => high severity (lead/admin) + operational risk messaging
    const severity = isEscalated ? 'high' : 'medium';

    const message = isEscalated
      ? `ESCALATED (96h): Task "${task.title}" has been blocked for ${Math.round(hoursBlocked)} hours. Lead/Admin escalation required. Marking operational risk.`
      : `BLOCKER ESCALATION (48h): Task "${task.title}" has been blocked for ${Math.round(hoursBlocked)} hours. Notifying blocker party.`;

    // Note: no new Prisma fields yet. We express escalation indicators + operational risk via the alert message.
    await prisma.alert.create({
      data: {
        internId: task.internId,
        type: 'blocker_escalation',
        taskId: task.id,
        message,
        severity,
      },
    });
    created++;
  }


  return created;
}

/**
 * Generate a reassignment alert when an intern's capacity drops below threshold.
 */
async function generateReassignmentAlerts(internId, finalCapacity) {
  if (finalCapacity >= 0.2) return;

  const existing = await prisma.alert.findFirst({
    where: { internId, type: 'reassignment', resolved: false },
  });
  if (existing) return;

  // Fetch intern name for a human-readable message
  const intern = await prisma.intern.findUnique({
    where: { id: internId },
    include: { user: { select: { name: true, email: true } } },
  });
  const internName = intern?.user?.name || intern?.user?.email?.split('@')[0] || internId;

  await prisma.alert.create({
    data: {
      internId,
      type:     'reassignment',
      severity: 'warning',
      message:  `${internName} has a final capacity score of ${Math.round(finalCapacity * 100)}. Consider reassigning active tasks.`,
    },
  });
}

/**
 * Fetch all unresolved alerts, ordered newest first.
 * Includes severity so the frontend can filter by critical/warning.
 */
async function getAllActiveAlerts() {
  return prisma.alert.findMany({
    where:   { resolved: false },
    orderBy: { createdAt: 'desc' },
  });
}

async function resolveAlert(alertId) {
  return prisma.alert.update({
    where: { id: alertId },
    data:  { resolved: true },
  });
}

module.exports = {
  generateBlockerAlerts,
  generateReassignmentAlerts,
  getAllActiveAlerts,
  resolveAlert,
};
