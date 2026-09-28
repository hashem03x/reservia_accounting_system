const express = require('express');

const {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer
} = require('../../controller/user/customerController');

const { createCustomerValidate, updateCustomerValidate } = require('../../utils/validators/customerValidator');

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Actions, Resources } = require('../../utils/appConstant');


const router = express.Router();

router.use(authController.protect);

// Get all customers
router.route('/')
  .get(
    checkUserPermissions({ resource: Resources.customers, action: Actions.read }),
    getAllCustomers
  ).post(
    checkUserPermissions({ resource: Resources.customers, action: Actions.create }),
    createCustomerValidate,
    createCustomer
  )

// Get a single customer by ID
router.route('/:id')
  .get(
    checkUserPermissions({ resource: Resources.customers, action: Actions.read }),
    getCustomerById
  )
  .put(
    checkUserPermissions({ resource: Resources.customers, action: Actions.update }),
    updateCustomerValidate,
    updateCustomer
  ).
  delete(
    checkUserPermissions({ resource: Resources.customers, action: Actions.delete }),
    deleteCustomer
  )
module.exports = router;