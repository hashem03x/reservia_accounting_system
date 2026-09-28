/** @description   this class is responsible about operational error (errors that can be predicted)*/
class ApiError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith(4) ? 'fail' : 'error';
    this.operational = true;
    
    // Store additional error details if provided
    if (details) {
      this.details = details;
    }
  }
}

module.exports = ApiError;
