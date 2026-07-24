const router = require('express').Router();

const { authMiddleware } = require('../middlewares/auth-middleware');
const validateRequest = require('../middlewares/validate-middleware');
const controller = require('../controllers/chat-controller');
const { validateSessionCreate, validatePagination, validateSendMessage } = require('../validators/chat');

router.use(authMiddleware);
router.post('/sessions', validateRequest(validateSessionCreate), controller.createSession);
router.get('/sessions', validateRequest(validatePagination, 'query'), controller.listSessions);
router.get('/sessions/:id/messages', validateRequest(validatePagination, 'query'), controller.getHistory);
router.post('/sessions/:id/messages', validateRequest(validateSendMessage), controller.sendMessage);
router.get('/sessions/:id', validateRequest(validatePagination, 'query'), controller.getHistory);
router.delete('/sessions/:id', controller.deleteSession);

module.exports = router;
