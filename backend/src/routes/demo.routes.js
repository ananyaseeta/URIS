const express = require('express');
const router = express.Router();
const { runDemo } = require('../controllers/demo.controller');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const { validate }                 = require('../middleware/validate.middleware');
const { schemas }                  = require('../validation/schemas');
const { ROLES } = require('../constants/roles');

const ADMIN_ROLES = [ROLES.CORE_ADMIN, ROLES.TECHNICAL_LEAD, ROLES.OPERATIONS_LEAD, ROLES.RESEARCH_LEAD];

// Demo endpoint is development-only — blocked in production to prevent
// fabricated data from entering the real database.
router.post('/run', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: 'Demo endpoint is not available in production.' });
  }
  next();
}, verifyToken, requireRole(...ADMIN_ROLES), validate(schemas.runDemo), runDemo);

module.exports = router;
