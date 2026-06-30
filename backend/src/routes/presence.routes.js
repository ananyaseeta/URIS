'use strict';

const express = require('express');
const router  = express.Router();
const {
  handleCheckIn,
  handleCheckOut,
  handleDeclareWindow,
  handleGetMyPresence,
  handleGetPresenceStatus,
} = require('../controllers/presence.controller');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const { ROLES } = require('../constants/roles');

const INTERN_ROLES = [
  ROLES.TECHNICAL_INTERN,
  ROLES.OPERATIONS_INTERN,
  ROLES.RESEARCH_INTERN,
  ROLES.ORENDA_MEMBER,
];

const CAN_VIEW = [
  ROLES.CORE_ADMIN,
  ROLES.TECHNICAL_LEAD,
  ROLES.OPERATIONS_LEAD,
  ROLES.RESEARCH_LEAD,
  ROLES.OPERATIONS_PROGRAM_MANAGER,
  ROLES.OBSERVER_TEAM_LEAD,
  ROLES.COLLABORATOR_LEAD,
];

// Intern-only actions
router.post('/check-in',        verifyToken, requireRole(...INTERN_ROLES), handleCheckIn);
router.post('/check-out',       verifyToken, requireRole(...INTERN_ROLES), handleCheckOut);
router.post('/window',          verifyToken, requireRole(...INTERN_ROLES), handleDeclareWindow);
router.get('/me',               verifyToken, requireRole(...INTERN_ROLES), handleGetMyPresence);

// Admin/lead: view any intern's status
router.get('/status/:internId', verifyToken, requireRole(...CAN_VIEW),    handleGetPresenceStatus);

module.exports = router;
