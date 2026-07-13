function appError(status, code, message, data) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

module.exports = appError;
