const express = require('express');
const bcrypt = require('bcryptjs');
const models = require('../db/models');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('account', { error: null, success: null });
});

router.post('/profile', (req, res) => {
  const displayName = (req.body.display_name || '').trim();
  if (!displayName) {
    return res.status(400).render('account', { error: 'Please enter your name.', success: null });
  }
  models.updateProfile({
    id: req.user.id,
    display_name: displayName,
    employee_number: (req.body.employee_number || '').trim(),
    department: (req.body.department || '').trim(),
  });
  // attachUser already ran (and set req.user/res.locals.currentUser) before
  // this handler, using the pre-update row - refresh both here too, or the
  // topbar/form rendered by this very response would still show old values.
  req.user = models.getUserById(req.user.id);
  res.locals.currentUser = req.user;
  res.render('account', { error: null, success: 'Your info has been updated.' });
});

router.post('/password', async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  const ok = await bcrypt.compare(current_password || '', req.user.password_hash);
  if (!ok) {
    return res.status(400).render('account', { error: 'Your current password is incorrect.', success: null });
  }
  if (!new_password || new_password.length < 4) {
    return res.status(400).render('account', { error: 'New password must be at least 4 characters.', success: null });
  }
  if (new_password !== confirm_password) {
    return res.status(400).render('account', { error: 'New passwords do not match.', success: null });
  }

  const password_hash = await bcrypt.hash(new_password, 12);
  models.updatePasswordHash(req.user.id, password_hash);
  res.render('account', { error: null, success: 'Your password has been changed.' });
});

module.exports = router;
