function makeError(message, status = 500, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

module.exports = { makeError };
