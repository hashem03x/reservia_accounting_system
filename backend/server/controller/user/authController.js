const crypto = require('crypto');

const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../../models/userModel');
const Role = require('../../models/userRoleModel');

const ApiError = require('../../utils/apiError');
const sendMailer = require('../../utils/sendEmail');
const { createToken, createRefreshToken } = require('../../utils/createToken');
const { accessTokenCookieOptions, refreshTokenCookieOptions } = require('../../utils/cookieOptions');

/**
 *  @description   Login
 *  @route         GET /api/v1/auth/login
 *  @access        Public
 */
exports.login = asyncHandler(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
    return next(new ApiError(`The email or password you entered is incorrect. Please try again.`, 401));
  }

  const token = createToken(user._id);
  const refreshToken = createRefreshToken(user._id);

  res.cookie('access_token', token, accessTokenCookieOptions);
  res.cookie('refresh_token', refreshToken, refreshTokenCookieOptions);

  res.status(200).json({ data: user, token });
});

/**
 *  @description   make sure the user is logged in
 */
exports.protect = asyncHandler(async (req, res, next) => {
  // 1- Check if token exist
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new ApiError(`You are not authorized, you must login to get access this route`, 401));
  }

  // 2- Verify that the token has not changed
  const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
  // 3- Check if the user still exists
  const user = await User.findById(decoded.userId);
  if (!user) {
    return next(new ApiError('The user that belongs to this token no longer exists', 401));
  }

  // Check if user change his password after token created
  if (user.passwordChangedAt) {
    const passChangedIimestamp = parseInt(user.passwordChangedAt.getTime() / 1000, 10);
    // Password changed after token created (error)
    if (passChangedIimestamp > decoded.iat) {
      return next(new ApiError('User recently changed his password, please login againg..'));
    }
  }

  req.user = user; // pass user data to the next middleware {role, isAdmin, id, name, email}
  next();
});

// Authorization (user permissions)
// ["admin", "manager"]
exports.allowedTo =
  (...roles) =>
  (req, res, next) => {
    // checks if user is admin  allowed to access any route
    if (req.user.isAdmin) return next();

    if (!roles.includes(req.user.role)) {
      return next(new ApiError('You are not allowed to access this route', 403));
    }
    next();
  };

/**
 *  @description  Forgot password
 *  @route        POST /api/v1/auth/forgotPassword
 *  @access       Public
 */
exports.forgotPassword = asyncHandler(async (req, res, next) => {
  // 1- Get user by email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new ApiError(`There is on user with that email ${req.body.email}`));
  }

  // 2- if user exist, Generate resest random 6 digits and save it in db
  const resetCode = Math.floor(100000 + Math.random() * 90000).toString();
  const hashedResetCode = crypto.createHash('sha256').update(resetCode).digest('hex');
  // Save hashed password reset code into db
  user.passwordResetCode = hashedResetCode;
  // Add expiration time for password reset code (10 min)
  user.passwordResetCodeExpires = Date.now() + 10 * 60 * 1000;
  user.passwordResetVerified = false;

  await user.save();

  // 3- Send the reset code via email
  // const message = `Hi ${user.name}, \nwe received a request to reset the password on your account.\nYour reset code is:
  // ${resetCode} \nEnter this code to complete the reset.\nThanks for helping us keep your account secure.`;
  const emailHtml = `
    <h1>Password Reset Request</h1>
    <p>Hi ${user.name},</p>
    <p>We received a request to reset the password on your account.</p>
    <p>Your reset code is:</p>
    <div style="font-size: 20px; font-weight: bold; margin: 10px 0; padding: 10px; background-color: #f4f4f4; border-radius: 5px; text-align: center;">
        ${resetCode}
    </div>
    <p>Enter this code to complete the reset.</p>
    <p>Thanks for helping us keep your account secure.</p>
    <p>If you did not request this change, please ignore this email.</p>
    <p>Best regards,</p>
    <p>Reversia Team</p>
`;

  try {
    await sendMailer(user.email, 'Your Password Reset Code (Valid for 10 Minutes)', emailHtml);
  } catch (err) {
    user.passwordResetCode = undefined;
    user.passwordResetCodeExpires = undefined;
    user.passwordResetVerified = undefined;

    await user.save();
    return next(new ApiError('There is an error in sending email'), 500);
  }
  res.status(200).json({
    status: 'Success',
    message: 'Reset code sent to email',
  });
});

/**
 *  @description  Verify password reset code
 *  @route        POST /api/v1/auth/verifyResetCode
 *  @access       Public
 */
exports.verifyPassResetCode = asyncHandler(async (req, res, next) => {
  // 1- Get user based on reset code
  const hashedResetCode = crypto.createHash('sha256').update(req.body.resetCode).digest('hex');

  const user = await User.findOne({
    passwordResetCode: hashedResetCode,
    passwordResetCodeExpires: { $gt: Date.now() },
  });
  if (!user) {
    return next(new ApiError('Reset code invalid or expired'));
  }

  // 2- Reset code valid
  user.passwordResetVerified = true;

  await user.save();

  res.status(200).json({
    status: 'Success',
  });
});

/**
 *  @description  Reset password
 *  @route        PUT /api/v1/auth/resetNewPassword
 *  @access       Public
 */
exports.resetPassword = asyncHandler(async (req, res, next) => {
  // 1- Get user based on email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new ApiError('There is no user for this email', 400));
  }
  // 2- Check if reset code if verified
  if (!user.passwordResetVerified) {
    return next(new ApiError('Reset code not verified', 400));
  }

  user.password = await bcrypt.hash(req.body.newPassword, 5);
  user.passwordResetCode = undefined;
  user.passwordResetVerified = undefined;
  user.passwordResetCodeExpires = undefined;
  user.passwordChangedAt = Date.now();

  await user.save();

  // 3- generate token
  const token = createToken(user._id);
  const refreshToken = createRefreshToken(user._id);

  res.cookie('access_token', token, accessTokenCookieOptions);
  res.cookie('refresh_token', refreshToken, refreshTokenCookieOptions);

  res.status(200).json({ token });
});

/**
 *  @description  Logout
 *  @route        GET /api/v1/auth/logout
 *  @access       Private
 */
exports.logout = asyncHandler(async (req, res, next) => {
  if (!req.cookies.access_token) {
    return next(new ApiError('User not logged in', 401));
  }

  res.clearCookie('refresh_token');
  res.clearCookie('access_token');

  res.status(200).json({ message: 'User logged out' });
});

/**
 *  @description  Refresh token
 *  @route        GET /api/v1/auth/refresh-token
 *  @access       Private
 */
exports.refreshToken = asyncHandler(async (req, res, next) => {
  const token = req.cookies.refresh_token;
  if (!req.cookies.refresh_token || !req.cookies.access_token) {
    return next(new ApiError('User not logged in', 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET_KEY);
  } catch (err) {
    return next(new ApiError('Invalid token', 401));
  }

  const user = await User.findById(decoded.userId);
  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  const newToken = createToken(user._id);
  const newRefreshToken = createRefreshToken(user._id);

  res.cookie('access_token', newToken, accessTokenCookieOptions);
  res.cookie('refresh_token', newRefreshToken, refreshTokenCookieOptions);

  res.status(200).json({ token: newToken, data: user });
});

exports.googleLogin = asyncHandler(async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    res.status(400).json({
      data: null,
      success: false,
      message: 'invalid_credentials',
    });
    return;
  }
  const decoded = jwt.decode(credential);
  if (!decoded) {
    res.status(400).json({
      success: false,
      message: 'invalid_credentials',
    });
    return;
  }
  let user = await User.findOne({ email: decoded.email });

  let accessToken;
  let refreshToken;

  if (user) {
    accessToken = createToken(user._id);
    refreshToken = createRefreshToken(user._id);

    res.cookie('access_token', accessToken, accessTokenCookieOptions);
    res.cookie('refresh_token', refreshToken, refreshTokenCookieOptions);

    res.status(200).json({
      data: user,
      success: true,
      accessToken,
    });
    return;
  }

  // Create new user
  user = await User.create({
    name: decoded.given_name,
    email: decoded.email,
    // password: decoded.sub,
  });

  accessToken = createToken(user._id);
  refreshToken = createRefreshToken(user._id);

  res.cookie('access_token', accessToken, accessTokenCookieOptions);
  res.cookie('refresh_token', refreshToken, refreshTokenCookieOptions);

  res.status(201).json({
    data: user,
    success: true,
    accessToken,
  });
});
