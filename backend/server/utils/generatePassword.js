const crypto = require('crypto');

// 18 random bytes -> 24-char base64url string: mixed-case letters, digits, -/_ - well above the
// app's own minimum (userValidator.js requires >= 6). Shared by scripts/createAdminUser.js and
// controller/portal/platformAdminController.js#resetUserPassword, so an admin-set password is
// generated the same, genuinely-random way wherever the app offers "generate one for me".
function generateStrongPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

module.exports = { generateStrongPassword };
