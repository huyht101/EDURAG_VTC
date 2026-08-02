function invalid(message = 'sourceLocator không hợp lệ.') {
  const error = new Error(message);
  error.code = 'SOURCE_LOCATOR_INVALID';
  return error;
}

function parseStoredLocator(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    throw invalid('sourceLocator đã lưu không phải JSON hợp lệ.');
  }
}

function validateSourceLocator(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.boxes) || value.boxes.length < 1
    || Object.keys(value).some((key) => key !== 'boxes')) {
    throw invalid('sourceLocator.boxes phải là mảng không rỗng.');
  }
  value.boxes.forEach((box, index) => {
    if (!box || typeof box !== 'object' || Array.isArray(box)) {
      throw invalid(`sourceLocator.boxes[${index}] phải là object.`);
    }
    const coordinateKeys = ['x', 'y', 'width', 'height'];
    if (Object.keys(box).length !== coordinateKeys.length
      || Object.keys(box).some((key) => !coordinateKeys.includes(key))) {
      throw invalid(`sourceLocator.boxes[${index}] chỉ được chứa x, y, width, height.`);
    }
    const { x, y, width, height } = box;
    if (![x, y, width, height].every((coordinate) => (
      typeof coordinate === 'number' && Number.isFinite(coordinate)
    ))) {
      throw invalid(`sourceLocator.boxes[${index}] phải chứa số hữu hạn.`);
    }
    if (x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > 1 || y + height > 1) {
      throw invalid(`sourceLocator.boxes[${index}] vượt ngoài trang normalized 0–1.`);
    }
  });
  return value;
}

function readSourceLocator(value) {
  return validateSourceLocator(parseStoredLocator(value));
}

module.exports = { validateSourceLocator, readSourceLocator };
