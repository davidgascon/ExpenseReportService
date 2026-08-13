const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR } = require('../config');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'expense-reports.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_approved INTEGER NOT NULL DEFAULT 0,
    employee_number TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- status moves draft -> submitted (sent to your boss) -> paid (reimbursed).
  -- Reopening a submitted or paid report sends it back to draft and clears
  -- both timestamps.
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'paid')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at TEXT,
    paid_at TEXT
  );

  -- Receipts belong to a user directly (so they can be uploaded and sit in a
  -- personal "inbox" before being assigned to a report). report_id is NULL
  -- until the user checks it off to include in a specific report.
  -- ocr_status is 'pending' while a background OCR scan is still running on
  -- a freshly-uploaded image, and 'done' once it's finished (or wasn't
  -- needed, e.g. a PDF receipt).
  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    receipt_date TEXT,
    total REAL NOT NULL DEFAULT 0,
    project_name TEXT NOT NULL DEFAULT '',
    gl_code TEXT NOT NULL DEFAULT '',
    attendees TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT 'Project Lunch: ',
    ocr_raw_text TEXT,
    ocr_status TEXT NOT NULL DEFAULT 'done' CHECK (ocr_status IN ('pending', 'done')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
  CREATE INDEX IF NOT EXISTS idx_receipts_report_id ON receipts(report_id);
  CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);

  -- Usage log for the admin dashboard: one row per notable action, so the
  -- admin can see how actively the service is being used.
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
`);

// ---------- Lightweight migrations ----------
// SQLite can't add a CHECK constraint or change a column via ALTER TABLE, but
// it can add a plain column, which covers the schema changes we've needed so
// far. This lets existing installs pick up new columns without deleting
// data/. Add a new `if` block here (not a rewrite of the CREATE TABLE above)
// whenever a future change only needs a new column with a default value.
function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

if (!columnNames('receipts').includes('ocr_status')) {
  db.exec("ALTER TABLE receipts ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'done'");
}

if (!columnNames('receipts').includes('gl_code')) {
  db.exec("ALTER TABLE receipts ADD COLUMN gl_code TEXT NOT NULL DEFAULT ''");
}

// A freely-editable "Description" field (what actually lands in the
// exported spreadsheet's Description column) - defaults to a short prefix
// the person fills in themselves, but can be changed to anything. This
// must run before the table-rebuild migrations below so their explicit
// column lists can already assume it exists.
if (!columnNames('receipts').includes('description')) {
  db.exec("ALTER TABLE receipts ADD COLUMN description TEXT NOT NULL DEFAULT 'Project Lunch: '");
}

// The default description text was originally a longer placeholder
// ("Project Lunch: (list who attended)") before being shortened to just
// "Project Lunch: " per explicit request. Backfill any receipt that still
// has the old default text untouched - if someone already customized
// their description, it won't match this exact string and is left alone.
db.prepare("UPDATE receipts SET description = 'Project Lunch: ' WHERE description = 'Project Lunch: (list who attended)'").run();

// Employee # and Department are now per-user, editable fields (used to
// populate the exported spreadsheet's header) rather than left as
// whatever David's original template happened to contain.
if (!columnNames('users').includes('employee_number')) {
  db.exec("ALTER TABLE users ADD COLUMN employee_number TEXT NOT NULL DEFAULT ''");
}
if (!columnNames('users').includes('department')) {
  db.exec("ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT ''");
}

// Optional email, used to send a "for your records" copy of each upload
// batch (see src/mailer.js) - blank is fine and simply means that user never
// gets emailed.
if (!columnNames('users').includes('email')) {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''");
}

// New registrations now require admin approval before they can log in.
// Critical detail: this ADD COLUMN's DEFAULT is 1 (approved), not 0 -
// specifically so that everyone who already has an account on an existing
// install (David included) doesn't suddenly get locked out the moment this
// column appears. Going forward, every real registration explicitly passes
// its own is_approved value at INSERT time (see models.insertUser) rather
// than relying on this column's default, so the default here only ever
// matters for this one-time backfill of pre-existing rows.
if (!columnNames('users').includes('is_approved')) {
  db.exec('ALTER TABLE users ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 1');
}

// The reports.status CHECK constraint gained a third value ('paid'), and a
// paid_at column was added. SQLite can't alter a CHECK constraint or add a
// column with one via ALTER TABLE, so this one needs a full table rebuild
// (SQLite's standard "rename, recreate, copy, drop" pattern) instead of the
// simple ADD COLUMN used above. Only runs once, detected by checking whether
// the existing table's own SQL definition already mentions 'paid'.
//
// IMPORTANT gotcha this rebuild has to account for: SQLite's `ALTER TABLE
// ... RENAME TO` automatically rewrites *other* tables' foreign key clauses
// to point at the new name (so receipts.report_id, which said `REFERENCES
// reports(id)`, silently became `REFERENCES "reports_pre_paid_status"(id)`
// the moment `reports` was renamed away). Recreating a table under the
// original `reports` name afterward does NOT undo that rewrite - it's baked
// into receipts' own stored schema. Left alone, that leaves every future
// receipt insert broken with "no such table: main.reports_pre_paid_status"
// once `reports_pre_paid_status` is dropped, even though the rename/copy/
// drop of `reports` itself completes with no error. Fix: rebuild `receipts`
// in the exact same transaction, so its foreign key clause gets re-declared
// fresh against the final `reports` table rather than inherited from
// history. `foreign_keys` is toggled off for the duration since we're
// briefly renaming a table (`reports`) that receipts currently references.
const reportsTableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reports'").get();
if (reportsTableDef && !reportsTableDef.sql.includes("'paid'")) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN TRANSACTION;
    ALTER TABLE reports RENAME TO reports_pre_paid_status;
    CREATE TABLE reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'paid')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT,
      paid_at TEXT
    );
    INSERT INTO reports (id, user_id, name, status, created_at, submitted_at)
      SELECT id, user_id, name, status, created_at, submitted_at FROM reports_pre_paid_status;
    DROP TABLE reports_pre_paid_status;
    CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);

    ALTER TABLE receipts RENAME TO receipts_pre_paid_status;
    CREATE TABLE receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      receipt_date TEXT,
      total REAL NOT NULL DEFAULT 0,
      project_name TEXT NOT NULL DEFAULT '',
      gl_code TEXT NOT NULL DEFAULT '',
      attendees TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT 'Project Lunch: ',
      ocr_raw_text TEXT,
      ocr_status TEXT NOT NULL DEFAULT 'done' CHECK (ocr_status IN ('pending', 'done')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO receipts (id, user_id, report_id, filename, original_name, receipt_date, total, project_name, gl_code, attendees, notes, description, ocr_raw_text, ocr_status, created_at)
      SELECT id, user_id, report_id, filename, original_name, receipt_date, total, project_name, gl_code, attendees, notes, description, ocr_raw_text, ocr_status, created_at FROM receipts_pre_paid_status;
    DROP TABLE receipts_pre_paid_status;
    CREATE INDEX IF NOT EXISTS idx_receipts_report_id ON receipts(report_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}

// Self-healing repair for installs that already ran an earlier, buggy
// version of the migration above (one that only rebuilt `reports`, not
// `receipts`) - their `receipts` table is permanently stuck referencing the
// now-dropped `reports_pre_paid_status` table, and every receipt insert
// fails with "no such table: main.reports_pre_paid_status" no matter how
// many times the container restarts, since the migration guard above only
// looks at whether `reports` itself mentions 'paid' (it already does, so it
// never re-runs) and never inspects `receipts`. This check is independent
// of that one and runs on every startup - a no-op once repaired.
const receiptsTableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'receipts'").get();
if (receiptsTableDef && receiptsTableDef.sql.includes('reports_pre_paid_status')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN TRANSACTION;
    ALTER TABLE receipts RENAME TO receipts_dangling_fk;
    CREATE TABLE receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      receipt_date TEXT,
      total REAL NOT NULL DEFAULT 0,
      project_name TEXT NOT NULL DEFAULT '',
      gl_code TEXT NOT NULL DEFAULT '',
      attendees TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT 'Project Lunch: ',
      ocr_raw_text TEXT,
      ocr_status TEXT NOT NULL DEFAULT 'done' CHECK (ocr_status IN ('pending', 'done')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO receipts (id, user_id, report_id, filename, original_name, receipt_date, total, project_name, gl_code, attendees, notes, description, ocr_raw_text, ocr_status, created_at)
      SELECT id, user_id, report_id, filename, original_name, receipt_date, total, project_name, gl_code, attendees, notes, description, ocr_raw_text, ocr_status, created_at FROM receipts_dangling_fk;
    DROP TABLE receipts_dangling_fk;
    CREATE INDEX IF NOT EXISTS idx_receipts_report_id ON receipts(report_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}

// If nobody is marked admin yet (fresh install just got its first user via
// insertUser, or an existing install is upgrading to this version for the
// first time), promote the earliest-registered account automatically. This
// runs on every startup but is a no-op once an admin exists.
const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
if (adminCount === 0) {
  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1').get();
  if (firstUser) {
    // Also force-approve here (belt and suspenders alongside insertUser's own
    // logic) - there must never be a path where the sole admin account can't
    // actually log in.
    db.prepare('UPDATE users SET is_admin = 1, is_approved = 1 WHERE id = ?').run(firstUser.id);
  }
}

// Note: the "sessions" table itself is created by better-sqlite3-session-store
// (see server.js) so its schema stays in sync with whatever that library expects.

module.exports = db;
