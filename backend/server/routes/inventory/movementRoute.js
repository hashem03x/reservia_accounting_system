const express = require('express');

const authController = require('../../controller/user/authController');
const {
  createMovement,
  getMovements,
  getMovement,
  updateMovement,
  deleteMovement
} = require('../../controller/movementController'); // Ensure all functions are imported

const {checkUserPermissions} = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

const router = express.Router();

router.use(authController.protect);

// Routes for movements
router
  .route('/')
  .post(
    checkUserPermissions({ resource: Resources.movements, action: Actions.create }),
    createMovement
  )
  .get(
    checkUserPermissions({ resource: Resources.movements, action: Actions.read }),
    getMovements
  );

//  router
//   .route('/:variant')
//   .get(
//     checkUserPermissions({ resource: Resources.movements, action: Actions.read }),
//     getMovements
//   );


router
  .route('/:id')
  .get(
    checkUserPermissions({ resource: Resources.movements, action: Actions.read }),
    getMovement
  )
  .put(
    checkUserPermissions({ resource: Resources.movements, action: Actions.update }),
    updateMovement
  )
  .delete(
    checkUserPermissions({ resource: Resources.movements, action: Actions.delete }),
    deleteMovement
  );

module.exports = router;