const router = require('express').Router();

const documentController = require('../controllers/document-controller');
const { authMiddleware } = require('../middlewares/auth-middleware');
const roleMiddleware = require('../middlewares/role-middleware');
const validateRequest = require('../middlewares/validate-middleware');
const documentUpload = require('../middlewares/document-upload-middleware');
const { validateDocumentQuery, validateDocumentUpdate } = require('../validators/document');
const ROLES = require('../constants/roles');

const managers = [ROLES.TEACHER, ROLES.ADMIN];

// GET /api/documents is accessible by STUDENT, TEACHER, and ADMIN
router.get('/', authMiddleware, roleMiddleware([ROLES.STUDENT, ROLES.TEACHER, ROLES.ADMIN]), validateRequest(validateDocumentQuery, 'query'), documentController.list);

router.use(authMiddleware, roleMiddleware(managers));
router.post('/', documentUpload, documentController.upload);
router.get('/jobs/:jobId', documentController.jobDetail);
router.get('/:id/file', documentController.streamFile);
router.post('/:id/hide', documentController.hide);
router.post('/:id/unhide', documentController.unhide);
router.get('/:id', documentController.detail);
router.patch('/:id', validateRequest(validateDocumentUpdate), documentController.update);
router.delete('/:id', documentController.remove);

module.exports = router;
