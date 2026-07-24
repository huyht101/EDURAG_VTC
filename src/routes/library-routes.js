const router = require('express').Router();

const controller = require('../controllers/library-controller');
const { authMiddleware } = require('../middlewares/auth-middleware');
const roleMiddleware = require('../middlewares/role-middleware');
const validateRequest = require('../middlewares/validate-middleware');
const { validateLibraryQuery } = require('../validators/library');
const ROLES = require('../constants/roles');

router.use(authMiddleware, roleMiddleware([ROLES.STUDENT]));
router.get('/', validateRequest(validateLibraryQuery, 'query'), controller.list);
router.get('/:id/source', controller.streamSource);
router.get('/:id', controller.detail);

module.exports = router;
