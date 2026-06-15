const express = require('express');
const router  = express.Router();
const { getShortlist, assignTask } = require('../controllers/assignment.controller');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const { requirePermission }        = require('../middleware/permission.middleware');
const { validate }                 = require('../middleware/validate.middleware');
const { schemas }                  = require('../validation/schemas');
const { ROLES }   = require('../constants/roles');
const { PERMISSIONS } = require('../constants/permissions');

// Route guards use requirePermission so delegates (effectiveRole=CORE_ADMIN) pass through
router.post('/shortlist',   verifyToken, requirePermission(PERMISSIONS.CAN_ASSIGN_TASKS), validate(schemas.getShortlist), getShortlist);
router.post('/assign-task', verifyToken, requirePermission(PERMISSIONS.CAN_ASSIGN_TASKS), validate(schemas.assignTask),   assignTask);

module.exports = router;
