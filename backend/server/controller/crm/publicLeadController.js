const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const { intakePublicLead, registerWaRefCode } = require('../../services/crm/publicLeadIntakeService');

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

// POST /crm/public/wa-ref - registers a WhatsApp Ref code's attribution at click time (Change
// Request 1, Feature 1). Same public/unauthenticated surface as submitPublicLead above; the
// response carries nothing back (fire-and-forget on the website side, must never delay opening
// wa.me) and never errors out loudly for a bad/duplicate code - a failed registration just means
// that one click's code falls back to "WhatsApp Direct" later, never a broken wa.me link.
exports.registerWaRef = asyncHandler(async (req, res) => {
  try {
    await registerWaRefCode(req.body);
  } catch {
    // Swallowed deliberately - see header comment.
  }
  res.status(204).send();
});
