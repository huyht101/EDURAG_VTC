const router = require('express').Router();

const { authMiddleware } = require('../middlewares/auth-middleware');
const roleMiddleware = require('../middlewares/role-middleware');
const validateRequest = require('../middlewares/validate-middleware');
const validateDashboardQuery = require('../validators/dashboard');
const controller = require('../controllers/dashboard-controller');
const ROLES = require('../constants/roles');

router.use(authMiddleware, roleMiddleware([ROLES.ADMIN]));
router.get('/summary', validateRequest(validateDashboardQuery, 'query'), controller.summary);

module.exports = router;
