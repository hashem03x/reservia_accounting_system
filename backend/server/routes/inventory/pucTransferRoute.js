const express = require('express');
const { check } = require('express-validator');
const authController = require('../../controller/user/authController');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { getPucTransferOptions, getProductPucTransfers, createPucTransfer } = require('../../controller/inventory/pucTransferController');

const router = express.Router();

router.use(authController.protect);

const productId = check('productId').isMongoId().withMessage('Invalid product id');

// Fast pre-checks - pucTransferService.js re-validates everything inside the transaction.
const createValidators = [
  productId,
  check('project').notEmpty().withMessage('Project is required').isMongoId().withMessage('Invalid project id'),
  check('quantity').notEmpty().withMessage('Quantity is required').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0'),
  check('sourceType').isIn(['warehouse', 'project']).withMessage('The transfer source must be a warehouse or a project'),
  check('warehouse').if(check('sourceType').equals('warehouse')).notEmpty().withMessage('Select the warehouse').isMongoId().withMessage('Invalid warehouse id'),
  check('sourceProject').if(check('sourceType').equals('project')).notEmpty().withMessage('Select the source project').isMongoId().withMessage('Invalid project id'),
  check('date').optional({ nullable: true }).isISO8601().withMessage('Invalid date'),
  check('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  check('requestKey').optional({ nullable: true }).isString().trim().isLength({ min: 8, max: 100 }).withMessage('Invalid request key'),
  validatorMiddleware,
];

router.get('/product/:productId/options', checkUserPermissions({ resource: Resources.products, action: Actions.read }), productId, validatorMiddleware, getPucTransferOptions);
router
  .route('/product/:productId')
  .get(checkUserPermissions({ resource: Resources.products, action: Actions.read }), productId, validatorMiddleware, getProductPucTransfers)
  .post(checkUserPermissions({ resource: Resources.products, action: Actions.update }), createValidators, createPucTransfer);

module.exports = router;
