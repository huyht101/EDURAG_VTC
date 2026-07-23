/**
 * Tiện ích làm sạch dữ liệu đầu vào chống XSS
 */

/**
 * Mã hóa các ký tự HTML đặc biệt để tránh thực thi mã JavaScript (Stored XSS)
 * @param {string} str Chuỗi đầu vào cần escape
 * @returns {string} Chuỗi đã được mã hóa an toàn
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#x27;';
      default: return m;
    }
  });
}

module.exports = {
  escapeHtml
};
