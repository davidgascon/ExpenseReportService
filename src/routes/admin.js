const express = require('express');
const bcrypt = require('bcryptjs');
const models = require('../db/models');
const { getMissingProfileFields } = require('../profileFields');

const router = express.Router();

router.get('/', (req, res) => {
  const totals = models.getOverallTotals();
  const userStats = models.getPerUserActivityStats();
  const recentActivity = models.listRecentActivity(100);
  const actionCounts = models.getActivityActionCounts();
  const pendingUsers = models.listPendingUsers();
  res.render('admin', {
    totals,
    userStats,
    recentActivity,
    actionCounts,
    pendingUsers,
    resetSuccessFor: req.query.reset || null,
    getMissingProfileFields,
  });
});

const CHART_RANGES = [7, 30, 365];

// Receipts-over-time chart data, gap-filled so every day/month in range
// shows up even with zero uploads (the model only returns buckets that
// actually have rows). Day granularity for 7/30 days, month for the 1-year
// view - 365 daily bars would be unreadable and rarely more useful.
router.get('/receipts-chart', (req, res) => {
  const range = CHART_RANGES.includes(Number(req.query.range)) ? Number(req.query.range) : 30;
  const granularity = range === 365 ? 'month' : 'day';
  const rows = models.getReceiptCountsSince(range, granularity);
  const countsByBucket = new Map(rows.map((r) => [r.bucket, r.n]));

  const labels = [];
  const counts = [];

  if (granularity === 'day') {
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      counts.push(countsByBucket.get(key) || 0);
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
      counts.push(countsByBucket.get(key) || 0);
    }
  }

  res.json({ range, labels, counts });
});

// Site-wide banner shown to everyone (see server.js, which looks this up on
// every request). Blank clears/hides it.
router.post('/broadcast', (req, res) => {
  const message = (req.body.message || '').trim();
  models.setBroadcastMessage(message);
  models.logActivity(req.user.id, 'broadcast_updated', message ? message.slice(0, 80) : '(cleared)');
  res.redirect('/admin');
});

// New registrations need an admin to approve them before they can log in.
router.post('/users/:id/approve', (req, res) => {
  const targetUser = models.getUserById(Number(req.params.id));
  if (!targetUser) {
    return res.status(404).render('error', { message: 'User not found.' });
  }
  models.approveUser(targetUser.id);
  models.logActivity(req.user.id, 'user_approved', targetUser.username);
  res.redirect('/admin');
});

// Denying a pending registration deletes it outright - there's nothing else
// to "reject," since a denied account was never usable in the first place.
router.post('/users/:id/deny', (req, res) => {
  const targetUser = models.getUserById(Number(req.params.id));
  if (!targetUser) {
    return res.status(404).render('error', { message: 'User not found.' });
  }
  models.denyUser(targetUser.id);
  models.logActivity(req.user.id, 'user_denied', targetUser.username);
  res.redirect('/admin');
});

// Admin-initiated password reset, for when someone is locked out and can't
// provide their current password (there's no email/SMTP set up for this app,
// so a self-serve "forgot password" email flow isn't practical here).
router.get('/users/:id/reset-password', (req, res) => {
  const targetUser = models.getUserById(Number(req.params.id));
  if (!targetUser) {
    return res.status(404).render('error', { message: 'User not found.' });
  }
  res.render('admin-reset-password', { targetUser, error: null });
});

router.post('/users/:id/reset-password', async (req, res) => {
  const targetUser = models.getUserById(Number(req.params.id));
  if (!targetUser) {
    return res.status(404).render('error', { message: 'User not found.' });
  }
  const { new_password, confirm_password } = req.body;
  if (!new_password || new_password.length < 4) {
    return res.status(400).render('admin-reset-password', { targetUser, error: 'New password must be at least 4 characters.' });
  }
  if (new_password !== confirm_password) {
    return res.status(400).render('admin-reset-password', { targetUser, error: 'New passwords do not match.' });
  }

  const password_hash = await bcrypt.hash(new_password, 12);
  models.updatePasswordHash(targetUser.id, password_hash);
  models.logActivity(req.user.id, 'admin_password_reset', targetUser.username);
  res.redirect('/admin?reset=' + encodeURIComponent(targetUser.display_name));
});

module.exports = router;
