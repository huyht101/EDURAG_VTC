const router = require('express').Router();

const internalAuthMiddleware = require('../middlewares/internal-auth-middleware');
const validateRequest = require('../middlewares/validate-middleware');
const validateProcessingCallback = require('../validators/processing-callback');
const controller = require('../controllers/processing-callback-controller');

router.use(internalAuthMiddleware);
router.post(
  '/processing-callback',
  validateRequest(validateProcessingCallback),
  controller.processingCallback
);

module.exports = router;
