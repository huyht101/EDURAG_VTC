const router = require('express').Router();

const { authMiddleware } = require('../middlewares/auth-middleware');
const controller = require('../controllers/citation-controller');

router.use(authMiddleware);
router.get('/:id/file', controller.streamFile);
router.get('/:id/source', controller.detail);
router.get('/:id', controller.detail);

module.exports = router;
