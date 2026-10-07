<<<<<<< HEAD
// Auth cookies (access_token / refresh_token). API calls authenticate with the Bearer token returned
// in the login response body; these cookies power the refresh-token ("remember me") and logout flows.
//
// Production (NODE_ENV !== 'development'): frontend and backend are different sites
// (reserviafrontend.vercel.app -> reserviabackend.vercel.app), so cookies must be
// `SameSite=None; Secure` - unchanged.
//
// Local development (NODE_ENV === 'development'): the app runs over plain http, where browsers
// REJECT a `SameSite=None` cookie that isn't also `Secure` - previously the refresh cookie was
// silently dropped locally, so "remember me"/session restore never worked. http://localhost:5173 ->
// http://localhost:5000 is the SAME site (ports don't count), so `SameSite=Lax` without `Secure`
// is both accepted and sent on credentialed fetches. Use `localhost` (not 127.0.0.1) for both.
const isDevelopment = process.env.NODE_ENV === 'development';

const baseCookieOptions = {
  httpOnly: true, // client side js cannot access the cookie
  secure: !isDevelopment,
  sameSite: isDevelopment ? 'lax' : 'none',
};

const accessTokenCookieOptions = {
  ...baseCookieOptions,
  maxAge: 30 * 24 * 60 * 60 * 1000, // one month
};

const refreshTokenCookieOptions = {
  ...baseCookieOptions,
  maxAge: 6 * 30 * 24 * 60 * 60 * 1000, // six months
=======
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
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
  path: '/api/v1/auth/refresh-token',
};

module.exports = {
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
};
