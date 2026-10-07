const ApiError = require('../utils/apiError');

const sendErrForDev = (err, res) => {
  const response = {
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  };

  // Include additional error details if available
  if (err.details) {
    response.details = err.details;
  }

  return res.status(err.statusCode).json(response);
};

const sendErrForProd = (err, res) => {
  const response = {
    status: err.status,
    message: err.message,
  };

  // Include validation errors in production for better user feedback
  if (err.details && err.details.validationErrors) {
    response.validationErrors = err.details.validationErrors;
  }

  return res.status(err.statusCode).json(response);
};

const handleJwtInvalidSignture = () => new ApiError('Invalid token, please login again..', 401);

const handleJwtExpired = () => new ApiError('Expired token, please login again..', 401);

//============================================//

const globalError = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log errors in both environments
  console.error(`Error: ${err.message}`);
  if (err.details) {
    console.error('Error details:', JSON.stringify(err.details, null, 2));
  }

  if (process.env.NODE_ENV === 'development') {
    sendErrForDev(err, res);
  } else {
    // Anything that isn't exactly 'development' (production, staging, alpha, or unset) gets the
    // safe response path - previously this was an `else if (NODE_ENV === 'production')`, so any
    // other value silently sent no response at all and left the caller hanging until its own
    // timeout, rather than a fast, correct error.
    if (err.name === 'JsonWebTokenError') err = handleJwtInvalidSignture();
    if (err.name === 'TokenExpiredError') err = handleJwtExpired();

    sendErrForProd(err, res);
  }
};

module.exports = globalError;
