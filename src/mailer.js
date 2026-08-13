const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = require('./config');

// Opt-in, same pattern as reCAPTCHA (see config.js): no SMTP_HOST means
// sending is a silent no-op rather than an error, so nobody who hasn't
// configured it is affected.
const transporter = SMTP_HOST
  ? nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  })
  : null;

// Sends one confirmation email per upload batch, with each uploaded file
// attached as the "for your records" copy. Meant to be called fire-and-forget
// right after the receipt row(s) are created (not awaited by the request),
// same as the background OCR job - a slow or failing send should never hold
// up the upload response.
async function sendReceiptConfirmation(user, files) {
  if (!transporter) return; // SMTP not configured - nothing to do
  if (!user.email || !user.email.trim()) return; // user hasn't set an email

  try {
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: user.email,
      subject: files.length === 1 ? 'Receipt uploaded' : `${files.length} receipts uploaded`,
      text: `Hi ${user.display_name},\n\nFor your records, here ${files.length === 1 ? 'is a copy' : 'are copies'} of the receipt${files.length === 1 ? '' : 's'} you just uploaded to the expense report service.\n`,
      attachments: files.map((f) => ({ filename: f.originalname, path: f.path })),
    });
  } catch (err) {
    console.error(`Failed to send receipt confirmation email to ${user.email}:`, err.message);
  }
}

module.exports = { sendReceiptConfirmation };
