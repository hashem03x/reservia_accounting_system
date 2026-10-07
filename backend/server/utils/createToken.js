const jwt = require('jsonwebtoken');

const createToken = payload =>
  jwt.sign({ userId: payload }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const createRefreshToken = payload =>
  jwt.sign({ userId: payload }, process.env.REFRESH_TOKEN_SECRET_KEY, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN,
  });

module.exports = { createToken, createRefreshToken };
