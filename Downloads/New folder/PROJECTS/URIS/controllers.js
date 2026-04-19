// src/controllers/tasksController.js
// ─────────────────────────────────────────────────────────────────────────────

const { syncTasksFromPlane, detectAndMarkStaleTasks, getTasksOverviewForAllInterns } = require('../services/taskService');
const { generateBlockerAlerts } = require('../services/alertService');

// GET /tasks/overview
// Syncs from Plane.so, runs stale detection, returns per-intern task summary.
async function getTasksOverview(req, res) {
  try {
    await syncTasksFromPlane();
    const staleCount = await detectAndMarkStaleTasks();
    await generateBlockerAlerts();

    const overview = await getTasksOverviewForAllInterns();

    res.json({
      success: true,
      message: `Tasks overview fetched. ${staleCount} stale task(s) detected.`,
      data: overview
    });
  } catch (err) {
    console.error('[tasksController] getTasksOverview error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch task overview.', data: null });
  }
}

module.exports = { getTasksOverview };


// ─────────────────────────────────────────────────────────────────────────────
// src/controllers/credibilityController.js
// ─────────────────────────────────────────────────────────────────────────────

// const { computeCredibilityScore } = require('../services/credibilityService');

// GET /credibility/get?internId=xxx
async function getCredibility(req, res) {
  const { internId } = req.query;

  if (!internId) {
    return res.status(400).json({ success: false, message: 'internId is required.', data: null });
  }

  try {
    const { computeCredibilityScore } = require('../services/credibilityService');
    const result = await computeCredibilityScore(internId);

    res.json({ success: true, message: 'Credibility score computed.', data: result });
  } catch (err) {
    console.error('[credibilityController] getCredibility error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to compute credibility score.', data: null });
  }
}

module.exports.getCredibility = getCredibility;


// ─────────────────────────────────────────────────────────────────────────────
// src/controllers/alertsController.js
// ─────────────────────────────────────────────────────────────────────────────

// const { getAllActiveAlerts, resolveAlert } = require('../services/alertService');

// GET /alerts
async function getAlerts(req, res) {
  try {
    const { getAllActiveAlerts } = require('../services/alertService');
    const alerts = await getAllActiveAlerts();

    res.json({ success: true, message: `${alerts.length} active alert(s).`, data: alerts });
  } catch (err) {
    console.error('[alertsController] getAlerts error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch alerts.', data: null });
  }
}

// PATCH /alerts/:id/resolve
async function resolveAlertById(req, res) {
  const { id } = req.params;
  try {
    const { resolveAlert } = require('../services/alertService');
    const updated = await resolveAlert(id);

    res.json({ success: true, message: 'Alert resolved.', data: updated });
  } catch (err) {
    console.error('[alertsController] resolveAlertById error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to resolve alert.', data: null });
  }
}

module.exports.getAlerts        = getAlerts;
module.exports.resolveAlertById = resolveAlertById;
