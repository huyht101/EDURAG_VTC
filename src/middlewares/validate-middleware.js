// Input Validation Middleware helper

/**
 * Express middleware runner for custom validators
 * @param {Function} validatorFunc - Validation logic function returning { error: string|null }
 */
function validateRequest(validatorFunc) {
  return (req, res, next) => {
    const result = validatorFunc(req.body);
    
    if (result && result.error) {
      return res.status(400).json({
        success: false,
        message: result.error,
        errorCode: 'VALIDATION_ERROR'
      });
    }
    
    next();
  };
}

module.exports = validateRequest;
