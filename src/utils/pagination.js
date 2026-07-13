function sqlPageNumbers(offset, limit) {
  if (!Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Pagination values must be normalized before repository use.');
  }
  return { offset, limit };
}

module.exports = sqlPageNumbers;
