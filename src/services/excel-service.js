/**
 * Excel / CSV Parser Service for Bulk Student Import
 */

function parseCsvOrExcel(contentString) {
  const lines = contentString.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('File không chứa dữ liệu hoặc thiếu dòng tiêu đề (header).');
  }

  // Header line
  const headers = lines[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = lines[i].split(/[,;\t]/).map((v) => v.trim().replace(/^["']|["']$/g, ''));
    if (values.length === 0 || (values.length === 1 && !values[0])) continue;

    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = values[index] || '';
    });
    rows.push({ lineNumber: i + 1, data: rowObj });
  }

  return rows;
}

function normalizeStudentRow(row) {
  const { data, lineNumber } = row;
  const email = data.email || data['hộp thư'] || data['thư điện tử'] || '';
  const fullName = data.fullname || data.name || data['họ và tên'] || data['họ tên'] || '';
  const studentCode = data.studentcode || data.msv || data['mã sinh viên'] || data['mã sv'] || '';
  const dateOfBirth = data.dateofbirth || data.dob || data['ngày sinh'] || '2000-01-01';
  const phone = data.phone || data['số điện thoại'] || data['sđt'] || null;

  if (!email || !email.includes('@')) {
    throw new Error(`Dòng ${lineNumber}: Email '${email}' không hợp lệ.`);
  }
  if (!fullName) {
    throw new Error(`Dòng ${lineNumber}: Họ và tên là bắt buộc.`);
  }
  if (!studentCode) {
    throw new Error(`Dòng ${lineNumber}: Mã sinh viên (MSV) là bắt buộc.`);
  }

  // Chống CSV/Excel Formula Injection
  const formulaChars = ['=', '+', '-', '@'];
  const eStr = email.trim();
  const fStr = fullName.trim();
  const sStr = studentCode.trim();

  if (formulaChars.some((char) => eStr.startsWith(char))) {
    throw new Error(`Dòng ${lineNumber}: Email không được phép bắt đầu bằng ký tự công thức (${formulaChars.join(', ')}).`);
  }
  if (formulaChars.some((char) => fStr.startsWith(char))) {
    throw new Error(`Dòng ${lineNumber}: Họ và tên không được phép bắt đầu bằng ký tự công thức (${formulaChars.join(', ')}).`);
  }
  if (formulaChars.some((char) => sStr.startsWith(char))) {
    throw new Error(`Dòng ${lineNumber}: Mã sinh viên không được phép bắt đầu bằng ký tự công thức (${formulaChars.join(', ')}).`);
  }
  if (phone) {
    const pStr = phone.trim();
    if (formulaChars.some((char) => pStr.startsWith(char)) && !/^\+?\d+$/.test(pStr)) {
      throw new Error(`Dòng ${lineNumber}: Số điện thoại không hợp lệ hoặc chứa ký tự công thức.`);
    }
  }

  return {
    email: eStr.toLowerCase(),
    fullName: fStr,
    studentCode: sStr,
    dateOfBirth: dateOfBirth.trim(),
    phone: phone ? phone.trim() : null
  };
}

module.exports = {
  parseCsvOrExcel,
  normalizeStudentRow
};
