const express = require('express');
const router  = express.Router();
const { getTasksOverview, getTasks, createTask, internUpdateTask } = require('../controllers/tasks.controller');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const { validate }                 = require('../middleware/validate.middleware');
const { schemas }                  = require('../validation/schemas');
const { ROLES } = require('../constants/roles');

router.get('/overview',        verifyToken, requireRole(ROLES.ADMIN),                               getTasksOverview);
router.get('/',                verifyToken, validate(schemas.getTasks),                             getTasks);
router.post('/create',         verifyToken, requireRole(ROLES.ADMIN), validate(schemas.createTask), createTask);
router.patch('/:taskId/progress', verifyToken, requireRole(ROLES.INTERN), validate(schemas.internUpdateTask), internUpdateTask);

module.exports = router;
