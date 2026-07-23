/**
 * Email Service - Abstraction for sending emails (Password reset, notifications, OTPs)
 */

async function sendEmail({ to, subject, html, text }) {
  const isEnabled = process.env.SMTP_ENABLED === 'true';

  if (!isEnabled) {
    // Development / Fallback mode: log email details to console securely
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[EMAIL SERVICE] Sending Email to: ${to} | Subject: ${subject}`);
      if (text) console.log(`[EMAIL SERVICE] Body Text: ${text}`);
    }
    return { sent: true, provider: 'DEV_CONSOLE_MOCK' };
  }

  // Production / SMTP mode can be wired here (e.g. using nodemailer if installed)
  try {
    // Future SMTP transport integration
    return { sent: true, provider: 'SMTP' };
  } catch (error) {
    console.error('[EMAIL SERVICE] Failed to send email via SMTP:', error);
    return { sent: false, error: error.message };
  }
}

async function sendPasswordResetEmail(toEmail, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
  const subject = '[EduRAG VTC] Yêu cầu đặt lại mật khẩu';
  const text = `Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản ${toEmail}.\nVui lòng truy cập đường dẫn sau để đặt lại mật khẩu (hiệu lực 15 phút):\n${resetUrl}\n\nMã token: ${resetToken}`;
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>Đặt lại mật khẩu - EduRAG VTC</h2>
      <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản <strong>${toEmail}</strong>.</p>
      <p>Vui lòng click vào nút bên dưới hoặc sử dụng đường dẫn để đặt lại mật khẩu (link có hiệu lực trong 15 phút):</p>
      <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 4px;">Đặt lại mật khẩu</a>
      <p style="margin-top: 15px; color: #666;">Token: <code>${resetToken}</code></p>
    </div>
  `;
  return sendEmail({ to: toEmail, subject, text, html });
}

module.exports = {
  sendEmail,
  sendPasswordResetEmail
};
