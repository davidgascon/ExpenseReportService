require('dotenv').config();

// Every displayed date/time (admin dashboard, reports, dashboard) is
// rendered server-side via Date.toLocaleString()/toLocaleDateString(), which
// follows this process's timezone - not the visiting browser's. Without
// this, that defaults to the container's own timezone (UTC, for the
// node:20-bookworm-slim image used in the Dockerfile), showing everyone
// times that are hours off from wall-clock Pacific time. Set via TZ here
// (rather than in docker-compose.yml) so it's correct no matter how the
// server is actually run. Still overridable via an actual TZ env var if
// this is ever deployed somewhere other than the Pacific timezone.
process.env.TZ = process.env.TZ || 'America/Los_Angeles';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const db = require('./src/db');
const models = require('./src/db/models');
const { requireAuth, attachUser, requireAdmin } = require('./src/middleware/auth');
const authRoutes = require('./src/routes/auth');
const accountRoutes = require('./src/routes/account');
const reportsRoutes = require('./src/routes/reports');
const receiptsRoutes = require('./src/routes/receipts');
const adminRoutes = require('./src/routes/admin');
const ocr = require('./src/ocr');
const { CHANGELOG } = require('./src/changelog');

const SqliteStore = require('better-sqlite3-session-store')(session);

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  console.error('ERROR: SESSION_SECRET is not set. Set it in your .env file before starting the server.');
  process.exit(1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'Coffee, Spreadsheets, and Mild Panic');
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SqliteStore({
    client: db,
    expired: { clear: true, intervalMs: 15 * 60 * 1000 },
  }),
  name: 'expense.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.use(attachUser(models));

const RECENT_RELEASE_DAYS = 3;

// Whether the latest changelog entry shipped within the last few days - true
// only in [0, RECENT_RELEASE_DAYS] so a future-dated entry (typo, or a
// changelog written ahead of the actual deploy) doesn't count as "recent."
function isRecentRelease(dateStr) {
  const releasedAt = new Date(`${dateStr}T00:00:00Z`);
  const daysSince = (Date.now() - releasedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= 0 && daysSince <= RECENT_RELEASE_DAYS;
}

// The admin's site-wide banner (see /admin) is looked up on every request,
// logged-in or not, so it can be shown above the login/register pages too -
// not just inside the app itself. appVersion/recentRelease ride along here
// too so the footer/banners (included on every page) can use them without
// every route passing them explicitly.
app.use((req, res, next) => {
  res.locals.broadcastMessage = models.getBroadcastMessage();
  res.locals.appVersion = CHANGELOG[0].version;
  res.locals.recentRelease = isRecentRelease(CHANGELOG[0].date) ? CHANGELOG[0] : null;
  next();
});

app.get('/', requireAuth, (req, res) => res.redirect('/reports'));

app.get('/changelog', (req, res) => res.render('changelog', { changelog: CHANGELOG }));

app.use('/', authRoutes);
app.use('/account', requireAuth, accountRoutes);
app.use('/reports', requireAuth, reportsRoutes.router);
app.use('/receipts', requireAuth, receiptsRoutes.router);
app.use('/admin', requireAuth, requireAdmin, adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Something went wrong.' });
});

const server = app.listen(PORT, () => {
  console.log(`Expense report service listening on port ${PORT}`);
});

async function shutdown() {
  console.log('Shutting down...');
  server.close();
  await ocr.shutdown();
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
