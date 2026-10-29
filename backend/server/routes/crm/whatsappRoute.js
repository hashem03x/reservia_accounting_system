const express = require('express');
const whatsappController = require('../../controller/crm/whatsappController');

const router = express.Router();

// Deliberately NOT behind authController.protect/requireCrmAccess - this is Meta's own server
// calling us, not a logged-in Reservia user; the GET handshake is authorized by the verify token,
// the POST deliveries are authorized by the HMAC signature (controller checks both).
router.get('/webhook', whatsappController.verifyWebhook);
router.post('/webhook', whatsappController.receiveWebhook);

module.exports = router;
