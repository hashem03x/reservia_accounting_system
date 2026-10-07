const { Router } = require('express');

const warehouseController = require('../../controller/inventory/warehouseController');

const { createWarehouseValidator, updateWarehouseValidator, deleteWarehouseValidator } = require('../../utils/validators/warehouseValidator');
const autheController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.get('/', warehouseController.getAllWarehouse);
router.get('/:id', warehouseController.getWarehouse);

router.use(autheController.protect);

// Currency operations routes
router.route('/exchange-rate').put(checkUserPermissions({ resource: Resources.warehouses, action: Actions.update }), warehouseController.updateExchangeRate);

router.route('/currency-balance').put(checkUserPermissions({ resource: Resources.warehouses, action: Actions.update }), warehouseController.updateCurrencyBalance);

router.route('/convert-currency').put(checkUserPermissions({ resource: Resources.warehouses, action: Actions.update }), warehouseController.convertCurrencyToBalance);

router
  .route('/')
  .post(
    checkUserPermissions({ resource: Resources.warehouses, action: Actions.create }),
    warehouseController.uploadWarehouseImage,
    warehouseController.processImage,
    createWarehouseValidator,
    warehouseController.warehouseHandler,
    warehouseController.createWarehouse
  );

router
  .route('/:id')
  .put(
    checkUserPermissions({ resource: Resources.warehouses, action: Actions.update }),
    warehouseController.uploadWarehouseImage,
    warehouseController.processImage,
    updateWarehouseValidator,
    warehouseController.warehouseHandler,
    warehouseController.updateWarehouse
  )
  .delete(checkUserPermissions({ resource: Resources.warehouses, action: Actions.delete }), deleteWarehouseValidator, warehouseController.deleteWarehouse);

module.exports = router;
