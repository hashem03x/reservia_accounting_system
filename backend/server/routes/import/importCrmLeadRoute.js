const { Router } = require('express');
const { formatGuideHandler } = require('../../utils/csvImport/formatGuide');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { previewCrmLeads, commitCrmLeads, sampleCrmLeads } = require('../../controller/import/crmLeadImportController');
const authController = require('../../controller/user/authController');
const { requireCrmAccess, requireCrmRole } = require('../../middleware/crmAccess');

const router = Router();

router.use(authController.protect, requireCrmAccess, requireCrmRole('admin', 'md'));

router.get('/sample', sampleCrmLeads);
router.get('/format-guide', formatGuideHandler(require('../../utils/validators/import/crmLeadImportSchema'), 'reservia-crm-leads-format-guide.csv'));
router.post('/preview', uploadTempFile('file'), previewCrmLeads);
router.post('/commit', uploadTempFile('file'), commitCrmLeads);

module.exports = router;
