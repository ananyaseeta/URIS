/**
 * demo.controller.js — DEVELOPMENT ONLY
 *
 * This controller exists solely for manually testing the capacity engine
 * pipeline during local development. It is blocked in production by
 * demo.routes.js (NODE_ENV === 'production' returns 403).
 *
 * IMPORTANT: No production business workflow depends on this controller.
 * The MOCK_INTERNS data is confined to this file and must never be used
 * in any production code path.
 */
const { processInternCapacity } = require('../services/processInternCapacity');
const logger = require('../utils/logger');

// MOCK_INTERNS is intentionally NOT imported here.
// The demo endpoint no longer returns fabricated intern records in its response.
// Assignment shortlist in production always uses real DB data via assignmentEngine.

async function runDemo(req, res) {
  try {
    const { busyBlocks, maxFreeBlockHours, weekStatusToggle, task } = req.body;

    // Compute capacity using the real engine against the supplied test inputs.
    // No mock or fabricated business data is injected into the result.
    const { availability, TLI, capacityScore, capacityLabel } = processInternCapacity({
      busyBlocks,
      maxFreeBlockHours,
      weekStatusToggle,
      tasks: [],
      examFlag: false,
      performanceIndex: 3.5,
      credibilityScore: 75,
    });

    return res.status(200).json({
      success: true,
      message: 'Demo pipeline executed successfully (development only — no production data affected)',
      data: { availability, TLI, capacityScore, capacityLabel },
    });
  } catch (err) {
    logger.error({ err }, 'runDemo failed');
    return res.status(500).json({ success: false, message: 'Something went wrong while running the demo pipeline', data: null });
  }
}

module.exports = { runDemo };
