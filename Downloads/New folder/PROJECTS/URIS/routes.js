// src/routes/taskRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { getTasksOverview } = require('../controllers/tasksController');
const { verifyToken, checkRole } = require('../middleware/auth.middleware');

// Only ADMIN (lead) can see the full task overview
router.get('/overview', verifyToken, checkRole('ADMIN'), getTasksOverview);

module.exports = router;


// ─────────────────────────────────────────────────────────────────────────────
// src/routes/credibilityRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
const expressC  = require('express');
const routerC   = expressC.Router();
const { getCredibility } = require('../controllers/credibilityController');
const { verifyToken: vt, checkRole: cr } = require('../middleware/auth.middleware');

router.get('/get', vt, cr('ADMIN'), getCredibility);

module.exports = routerC;


// ─────────────────────────────────────────────────────────────────────────────
// src/routes/alertRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
const expressA = require('express');
const routerA  = expressA.Router();
const { getAlerts, resolveAlertById } = require('../controllers/alertsController');
const { verifyToken: vtA, checkRole: crA } = require('../middleware/auth.middleware');

routerA.get('/',           vtA, crA('ADMIN'), getAlerts);
routerA.patch('/:id/resolve', vtA, crA('ADMIN'), resolveAlertById);

module.exports = routerA;
