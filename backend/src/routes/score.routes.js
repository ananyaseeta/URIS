const express = require('express');
const router = express.Router();
const { getScoreHistory } = require('../controllers/score.controller');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const { validate }    = require('../middleware/validate.middleware');
const { schemas }     = require('../validation/schemas');
const { ROLES } = require('../constants/roles');

// Only leads and CORE_ADMIN may fetch any intern's score history.
// Interns have no self-service score history endpoint — they see scores
// via their own dashboard which is scoped to their own data.
const CAN_VIEW_SCORES = [
  ROLES.CORE_ADMIN,
  ROLES.TECHNICAL_LEAD,
  ROLES.OPERATIONS_LEAD,
  ROLES.RESEARCH_LEAD,
  ROLES.OPERATIONS_PROGRAM_MANAGER,
  ROLES.OBSERVER_TEAM_LEAD,
  ROLES.COLLABORATOR_LEAD,
];

// Support both /history/:internId and /history?internId=X for admin filtering
router.get('/history', verifyToken, requireRole(...CAN_VIEW_SCORES), getScoreHistory);
router.get('/history/:internId', verifyToken, requireRole(...CAN_VIEW_SCORES), getScoreHistory);

module.exports = router;
