// customizationRoute.js

const express = require('express');

const authController = require('../controller/user/authController');
const { getAboutUs, createAboutUs, updateAboutUs, uploadLogo, resizeImage } = require('../controller/aboutUsController');
const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');

const router = express.Router();

router.get('/', getAboutUs);

router.use(authController.protect);

router.post('/',checkUserPermissions({resource:Resources.customization, action:Actions.update}), uploadLogo, resizeImage, createAboutUs);
router.put('/:id',checkUserPermissions({resource:Resources.customization, action:Actions.update}), uploadLogo, resizeImage, updateAboutUs);

module.exports = router;
