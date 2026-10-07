const {Router} = require('express');

const router = Router();

const {
     uploadProductFile,
     uploadVariantFile,
     uploadFile,
     exportController
    } = require('../../controller/inventory/csvController');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');


// router.post('/uploadProductFile', uploadProductFile);


// router.post('/uploadVariantFile', uploadVariantFile);

router.post('/upload',uploadTempFile('file'), uploadFile);
router.get('/export', exportController)


module.exports = router;