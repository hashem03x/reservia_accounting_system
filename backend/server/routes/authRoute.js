const express = require('express');

const router = express.Router();

const {
  login,
  forgotPassword,
  verifyPassResetCode,
  resetPassword,
  logout,
  refreshToken,
} = require('../controller/user/authController');

const { loginValidator } = require('../utils/validators/authValidator');

router.post('/login', loginValidator, login);
router.post('/forgotPassword', forgotPassword);
router.post('/verifyResetCode', verifyPassResetCode);
router.put('/resetPassword', resetPassword);
router.get('/logout', logout);
router.get('/refresh-token', refreshToken);

module.exports = router;
