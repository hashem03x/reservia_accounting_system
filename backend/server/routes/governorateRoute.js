const express = require('express');

const authController = require('../controller/user/authController');
const { updateGovernorateValidator, createGovernorateValidator } = require('../utils/validators/governorateValidator');
const {
  getGovernorates,
  getGovernorateById,
  createGovernorate,
  updateGovernorate,
  deleteGovernorate,
} = require('../controller/governorateController');
const router = express.Router();
// governorate routes
router.route('/').get(getGovernorates);
router.route('/:id').get(getGovernorateById);

router.use(authController.protect, authController.allowedTo('admin'));
router.route('/').post(createGovernorateValidator, createGovernorate);
router.route('/:id').put(updateGovernorateValidator, updateGovernorate).delete(deleteGovernorate);

module.exports = router;
