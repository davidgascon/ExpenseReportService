const path = require('path');

// Resolve DATA_DIR relative to the current working directory (where the
// service is started from), falling back to a sibling "data" folder next to
// this file. Always absolute, since express's res.sendFile() and various
// filesystem calls require an absolute path.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'));

// reCAPTCHA on the registration page is opt-in: leave both blank and it's
// simply not shown/checked (registration works exactly as before). Get a
// site key + secret key from https://www.google.com/recaptcha/admin (choose
// "reCAPTCHA v2" / "I'm not a robot" Checkbox) and set both in .env to turn
// it on.
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

// Email receipt confirmations are opt-in, same shape as reCAPTCHA above:
// leave SMTP_HOST blank and mailer.js simply no-ops (uploads work exactly as
// before, nobody gets emailed). Set all of these in .env to turn it on.
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || '';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '';

module.exports = {
  DATA_DIR,
  UPLOAD_ROOT,
  RECAPTCHA_SITE_KEY,
  RECAPTCHA_SECRET_KEY,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
};
