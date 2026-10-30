const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const { intakePublicLead } = require('../../services/crm/publicLeadIntakeService');

// POST /crm/public/leads - the real public website's quote/lead forms. Unauthenticated by design
// (there is no logged-in user on the public site), but never unprotected: scoped CORS
// (routes/crm/publicLeadRoute.js), a dedicated rate limit (middleware/publicLeadRateLimit.js),
// strict field validation (utils/validators/crm/publicLeadValidators.js) and a honeypot all run
// before this handler, and the response below NEVER includes anything beyond a ref code - no
// internal lead id, owner, stage, or any other CRM-internal field a public caller has no business
// seeing.
exports.submitPublicLead = asyncHandler(async (req, res) => {
  const result = await intakePublicLead(req.body);
  if (result.honeypot) {
    // Same success shape a real submission gets - never reveal the detection to whatever sent it.
    // No refCode: nothing was created.
    return res.status(201).json(apiResponse('Thank you - we will be in touch shortly.', true, {}));
  }
  res.status(201).json(apiResponse('Thank you - we will be in touch shortly.', true, { refCode: result.refCode }));
});
