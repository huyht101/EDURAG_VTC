// Response formatting helper middleware

function responseMiddleware(req, res, next) {
  /**
   * Send a standard success response
   * @param {string} message - Success message
   * @param {object} [data={}] - Response data
   * @param {number} [status=200] - HTTP status code
   */
  res.ok = function (message, data = {}, status = 200) {
    return res.status(status).json({
      success: true,
      message,
      data
    });
  };

  /**
   * Send a standard error response
   * @param {number} status - HTTP status code
   * @param {string} message - Error message
   * @param {string} errorCode - System error code
   */
  res.err = function (status, message, errorCode) {
    return res.status(status).json({
      success: false,
      message,
      errorCode
    });
  };

  next();
}

module.exports = responseMiddleware;
