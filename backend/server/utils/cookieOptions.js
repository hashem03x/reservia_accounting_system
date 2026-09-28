const accessTokenCookieOptions = {
  httpOnly: true, // client side js cannot access the cookie
  maxAge: 30 * 24 * 60 * 60 * 1000, // one month
  secure: process.env.NODE_ENV !== 'development', // cookie only works in https (secure is true if NODE_ENV is production and false if NODE_ENV is development)
  // sameSite: process.env.NODE_ENV === 'development' ? 'none' : 'strict', // cookie only works in the same site (sameSite is strict if NODE_ENV is production and none if NODE_ENV is development)
  // sameSite: process.env.NODE_ENV === 'development' ? 'none' : 'lax',
  sameSite: 'none',
};

const refreshTokenCookieOptions = {
  httpOnly: true,
  maxAge: 6 * 30 * 24 * 60 * 60 * 1000, // six months
  secure: process.env.NODE_ENV !== 'development',
  // sameSite: process.env.NODE_ENV === 'development' ? 'none' : 'strict',
  // sameSite: process.env.NODE_ENV === 'development' ? 'none' : 'lax',
  sameSite: 'none',
  path: '/api/v1/auth/refresh-token',
};

module.exports = {
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
};
