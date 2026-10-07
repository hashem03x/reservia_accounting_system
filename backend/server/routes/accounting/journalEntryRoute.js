const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  getJournalEntriesForProject,
  getJournalEntriesForSalesOrder,
  getJournalEntriesForPurchaseOrder,
<<<<<<< HEAD
  getJournalEntriesForAdvancedPayment,
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
  updateJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  getGeneralLedger,
} = require('../../controller/accounting/journalEntryController');
const { createJournalEntryValidators, updateJournalEntryValidators, reverseJournalEntryValidators } = require('../../utils/validators/journalEntryValidators');

router.use(authController.protect);

// Registered before '/:id' so "general-ledger" is never matched as an :id param (same convention
// as advancedPaymentRoute.js's '/available').
router.get('/general-ledger', checkUserPermissions({ resource: Resources.journalEntries, action: Actions.read }), getGeneralLedger);

router.get('/project/:projectId', checkUserPermissions({ resource: Resources.journalEntries, action: Actions.read }), getJournalEntriesForProject);
router.get('/sales-order/:salesOrderId', checkUserPermissions({ resource: Resources.journalEntries, action: Actions.read }), getJournalEntriesForSalesOrder);
router.get('/purchase-order/:purchaseOrderId', checkUserPermissions({ resource: Resources.journalEntries, action: Actions.read }), getJournalEntriesForPurchaseOrder);
<<<<<<< HEAD
router.get('/advanced-payment/:advancedPaymentId', checkUserPermissions({ resource: Resources.journalEntries, action: Actions.read }), getJournalEntriesForAdvancedPayment);
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.journalEntries, action: Actions.read }), getJournalEntries)
  .post(checkUserPermissions({ resource: Resources.journalEntries, action: Actions.create }), createJournalEntryValidators, createJournalEntry);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.journalEntries, action: Actions.read }), getJournalEntry)
  .patch(checkUserPermissions({ resource: Resources.journalEntries, action: Actions.update }), updateJournalEntryValidators, updateJournalEntry);

router.post('/:id/post', checkUserPermissions({ resource: Resources.journalEntries, action: Actions.update }), postJournalEntry);
router.post('/:id/reverse', checkUserPermissions({ resource: Resources.journalEntries, action: Actions.update }), reverseJournalEntryValidators, reverseJournalEntry);

module.exports = router;
