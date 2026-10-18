const { Router } = require('express');
const authController = require('../../controller/user/authController');
const { getMe, getMySystems } = require('../../controller/portal/portalController');

const router = Router();

// Deliberately only `protect` - no ERP-membership/resource check. Every authenticated user (ERP
// staff AND customers alike) must be able to ask "who am I" and "what can I access", including a
// user with zero system memberships (docs section "Load authorized systems" - "User has no
// system access: all five cards are disabled, and the UI explains that an administrator must
// grant access" - the UI needs this exact response to render that state, not a 403).
router.use(authController.protect);

router.get('/', getMe);
router.get('/systems', getMySystems);

module.exports = router;
