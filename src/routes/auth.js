const express = require('express');
const bcrypt = require('bcryptjs');
const models = require('../db/models');
const { RECAPTCHA_SITE_KEY, RECAPTCHA_SECRET_KEY } = require('../config');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

// Verifies the "I'm not a robot" checkbox against Google's siteverify API.
// Deliberately opt-in: with no secret key configured, this returns true
// unconditionally (registration behaves exactly as before) rather than
// forcing every install to set this up before anyone can create an
// account. If a secret key IS configured but the token is missing/blank,
// that's an unambiguous fail - either the widget didn't render or someone's
// posting straight to the endpoint. If the request to Google itself fails
// (network hiccup, Google's API down), this fails closed (rejects the
// registration) rather than silently letting a bot through - on a
// self-hosted app that normally has working internet access, an occasional
// "try again in a minute" is a better failure mode than defeating the
// point of having a CAPTCHA at all.
async function verifyRecaptcha(token, remoteIp) {
  if (!RECAPTCHA_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const params = new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: token, remoteip: remoteIp || '' });
    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: params });
    const data = await resp.json();
    return !!data.success;
  } catch (err) {
    console.error('reCAPTCHA verification request failed:', err.message);
    return false;
  }
}

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, notice: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = models.findUserByUsername((username || '').trim());
  if (!user) {
    return res.status(401).render('login', { error: 'Invalid username or password.', notice: null });
  }
  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) {
    return res.status(401).render('login', { error: 'Invalid username or password.', notice: null });
  }
  if (!user.is_approved) {
    return res.status(403).render('login', {
      error: 'Your account is still waiting on admin approval. You\'ll be able to log in once an admin approves it.',
      notice: null,
    });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { error: 'Something went wrong. Try again.', notice: null });
    req.session.userId = user.id;
    models.logActivity(user.id, 'login');
    const dest = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(dest);
  });
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null, values: {}, recaptchaSiteKey: RECAPTCHA_SITE_KEY });
});

router.post('/register', async (req, res) => {
  const { username, display_name, password, confirm_password } = req.body;
  const values = { username, display_name };
  const rerender = (status, error) => res.status(status).render('register', { error, values, recaptchaSiteKey: RECAPTCHA_SITE_KEY });

  if (!username || !USERNAME_RE.test(username)) {
    return rerender(400, 'Username must be 3-32 characters: letters, numbers, dot, dash, underscore.');
  }
  if (!display_name || !display_name.trim()) {
    return rerender(400, 'Please enter your name.');
  }
  if (!password || password.length < 4) {
    return rerender(400, 'Password must be at least 4 characters.');
  }
  if (password !== confirm_password) {
    return rerender(400, 'Passwords do not match.');
  }
  if (models.findUserByUsername(username.trim())) {
    return rerender(400, 'That username is already taken.');
  }
  const recaptchaOk = await verifyRecaptcha(req.body['g-recaptcha-response'], req.ip);
  if (!recaptchaOk) {
    return rerender(400, 'Please complete the "I\'m not a robot" verification.');
  }

  const password_hash = await bcrypt.hash(password, 12);
  const user = models.insertUser({
    username: username.trim(),
    display_name: display_name.trim(),
    password_hash,
  });
  models.logActivity(user.id, 'register');

  // The very first account on a fresh install is auto-approved (see
  // models.insertUser) since there's nobody else yet to approve them -
  // everyone after that needs an admin to approve their account before
  // they can log in, so don't start a session for them yet.
  if (!user.is_approved) {
    return res.render('login', {
      error: null,
      notice: 'Your account has been created. An admin needs to approve it before you can log in - check back soon.',
    });
  }

  req.session.regenerate((err) => {
    if (err) return rerender(500, 'Something went wrong. Try again.');
    req.session.userId = user.id;
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;
