function neutralizeFormula(value) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^[\t\r]/u.test(text) || /^[\u0000-\u0020]*[=+\-@]/u.test(text)) return `'${text}`;
  return text;
}

function csvCell(value) {
  return `"${neutralizeFormula(value).replace(/"/g, '""')}"`;
}

function csvRow(values) {
  return `${values.map(csvCell).join(',')}\r\n`;
}

module.exports = { neutralizeFormula, csvCell, csvRow };
