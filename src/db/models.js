const db = require('./index');

// ---------- Users ----------

const createUser = db.prepare(`
  INSERT INTO users (username, display_name, password_hash, is_admin, is_approved)
  VALUES (@username, @display_name, @password_hash, @is_admin, @is_approved)
`);

// The very first person to register on a fresh install becomes the admin
// (there's no user-management UI to promote someone otherwise yet), and is
// auto-approved for the same reason - there'd be nobody else around yet to
// approve them. Everyone who registers after that needs an admin to
// approve their account (see models.approveUser) before they can log in.
function insertUser({ username, display_name, password_hash }) {
  const isFirstUser = countUsers() === 0;
  const info = createUser.run({
    username,
    display_name,
    password_hash,
    is_admin: isFirstUser ? 1 : 0,
    is_approved: isFirstUser ? 1 : 0,
  });
  return getUserById(info.lastInsertRowid);
}

const getUserByUsername = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
const getUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const countUsersStmt = db.prepare('SELECT COUNT(*) AS n FROM users');

function findUserByUsername(username) {
  return getUserByUsername.get(username);
}

function getUserById(id) {
  return getUserByIdStmt.get(id);
}

function countUsers() {
  return countUsersStmt.get().n;
}

const updateDisplayNameStmt = db.prepare('UPDATE users SET display_name = ? WHERE id = ?');

function updateDisplayName(id, displayName) {
  return updateDisplayNameStmt.run(displayName, id);
}

// Employee # and Department feed the exported spreadsheet's header (see
// excelExport.js) - each person sets their own from their Account page
// instead of everyone sharing whatever was baked into David's original
// template file.
const updateProfileStmt = db.prepare(`
  UPDATE users SET display_name = @display_name, employee_number = @employee_number, department = @department, email = @email
  WHERE id = @id
`);

function updateProfile(data) {
  return updateProfileStmt.run(data);
}

const updatePasswordHashStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

// Used both for a user changing their own password (after verifying their
// current one) and for an admin resetting someone else's password (when
// they're locked out and can't provide the old one) - same underlying
// update either way, the two routes just differ in what they check first.
function updatePasswordHash(id, passwordHash) {
  return updatePasswordHashStmt.run(passwordHash, id);
}

const listAllUsersStmt = db.prepare('SELECT id, username, display_name, is_admin FROM users ORDER BY display_name ASC');

function listAllUsers() {
  return listAllUsersStmt.all();
}

// ---------- New-account approval ----------

const listPendingUsersStmt = db.prepare(
  'SELECT id, username, display_name, created_at FROM users WHERE is_approved = 0 ORDER BY created_at ASC',
);

function listPendingUsers() {
  return listPendingUsersStmt.all();
}

const approveUserStmt = db.prepare('UPDATE users SET is_approved = 1 WHERE id = ?');

function approveUser(id) {
  return approveUserStmt.run(id);
}

// Denying a pending registration just deletes it outright - there's no
// "rejected" state to track, and the guard (is_approved = 0) means this can
// never accidentally delete an already-approved account even if a stale
// admin-dashboard link gets clicked twice.
const denyUserStmt = db.prepare('DELETE FROM users WHERE id = ? AND is_approved = 0');

function denyUser(id) {
  return denyUserStmt.run(id);
}

// ---------- Reports ----------

const insertReportStmt = db.prepare(`
  INSERT INTO reports (user_id, name) VALUES (@user_id, @name)
`);

function createReport({ user_id, name }) {
  const info = insertReportStmt.run({ user_id, name });
  return getReportById(info.lastInsertRowid);
}

const getReportByIdStmt = db.prepare('SELECT * FROM reports WHERE id = ?');

function getReportById(id) {
  return getReportByIdStmt.get(id);
}

const listReportsForUserStmt = db.prepare(`
  SELECT r.*,
    (SELECT COUNT(*) FROM receipts WHERE receipts.report_id = r.id) AS receipt_count,
    (SELECT COALESCE(SUM(total), 0) FROM receipts WHERE receipts.report_id = r.id) AS total_amount
  FROM reports r
  WHERE r.user_id = ?
  ORDER BY r.created_at DESC
`);

function listReportsForUser(userId) {
  return listReportsForUserStmt.all(userId);
}

// Home-page ("your reports") at-a-glance totals: how much is sitting in
// the inbox not yet on any report, and how much is on reports already
// sent to your boss but not yet paid back.
const unassignedReceiptsTotalStmt = db.prepare(`
  SELECT COALESCE(SUM(total), 0) AS total FROM receipts WHERE user_id = ? AND report_id IS NULL
`);

function getUnassignedReceiptsTotal(userId) {
  return unassignedReceiptsTotalStmt.get(userId).total;
}

const submittedReceiptsTotalStmt = db.prepare(`
  SELECT COALESCE(SUM(re.total), 0) AS total
  FROM receipts re
  JOIN reports rp ON rp.id = re.report_id
  WHERE rp.user_id = ? AND rp.status = 'submitted'
`);

function getSubmittedReceiptsTotal(userId) {
  return submittedReceiptsTotalStmt.get(userId).total;
}

const renameReportStmt = db.prepare(`UPDATE reports SET name = ? WHERE id = ? AND status = 'draft'`);

function renameReport(id, name) {
  return renameReportStmt.run(name, id);
}

const submitReportStmt = db.prepare(`
  UPDATE reports SET status = 'submitted', submitted_at = datetime('now')
  WHERE id = ? AND status = 'draft'
`);

function submitReport(id) {
  return submitReportStmt.run(id);
}

const reopenReportStmt = db.prepare(`
  UPDATE reports SET status = 'draft', submitted_at = NULL, paid_at = NULL WHERE id = ?
`);

function reopenReport(id) {
  return reopenReportStmt.run(id);
}

const markReportPaidStmt = db.prepare(`
  UPDATE reports SET status = 'paid', paid_at = datetime('now')
  WHERE id = ? AND status = 'submitted'
`);

function markReportPaid(id) {
  return markReportPaidStmt.run(id);
}

const deleteReportStmt = db.prepare(`DELETE FROM reports WHERE id = ?`);

function deleteReport(id) {
  return deleteReportStmt.run(id);
}

// ---------- Receipts ----------
// Receipts belong to a user directly and sit unassigned (report_id IS NULL)
// in the user's personal "inbox" until checked off to join a specific report.

const DEFAULT_DESCRIPTION = 'Project Lunch: ';

const insertReceiptStmt = db.prepare(`
  INSERT INTO receipts (user_id, report_id, filename, original_name, receipt_date, total, project_name, gl_code, notes, description, ocr_raw_text, ocr_status)
  VALUES (@user_id, @report_id, @filename, @original_name, @receipt_date, @total, @project_name, @gl_code, @notes, @description, @ocr_raw_text, @ocr_status)
`);

function createReceipt(data) {
  const info = insertReceiptStmt.run({ report_id: null, ocr_status: 'done', gl_code: '', description: DEFAULT_DESCRIPTION, ...data });
  return getReceiptById(info.lastInsertRowid);
}

const getReceiptByIdStmt = db.prepare('SELECT * FROM receipts WHERE id = ?');

function getReceiptById(id) {
  return getReceiptByIdStmt.get(id);
}

const listReceiptsForReportStmt = db.prepare(`
  SELECT * FROM receipts WHERE report_id = ? ORDER BY receipt_date ASC, created_at ASC
`);

function listReceiptsForReport(reportId) {
  return listReceiptsForReportStmt.all(reportId);
}

const listUnassignedReceiptsForUserStmt = db.prepare(`
  SELECT * FROM receipts WHERE user_id = ? AND report_id IS NULL ORDER BY receipt_date DESC, created_at DESC
`);

function listUnassignedReceiptsForUser(userId) {
  return listUnassignedReceiptsForUserStmt.all(userId);
}

const updateReceiptStmt = db.prepare(`
  UPDATE receipts SET receipt_date = @receipt_date, total = @total, project_name = @project_name, gl_code = @gl_code, notes = @notes, description = @description
  WHERE id = @id
`);

function updateReceipt(data) {
  return updateReceiptStmt.run(data);
}

// Applied by the background OCR job once it finishes. Only fills in
// receipt_date/total if they're still at their untouched defaults, so we
// don't clobber a value the user already typed in manually while the scan
// was still running.
const completeOcrScanStmt = db.prepare(`
  UPDATE receipts SET
    receipt_date = CASE WHEN receipt_date IS NULL THEN @receipt_date ELSE receipt_date END,
    total = CASE WHEN total = 0 THEN @total ELSE total END,
    ocr_raw_text = @ocr_raw_text,
    ocr_status = 'done'
  WHERE id = @id AND ocr_status = 'pending'
`);

function completeOcrScan({ id, receipt_date, total, ocr_raw_text }) {
  return completeOcrScanStmt.run({ id, receipt_date, total: total || 0, ocr_raw_text: ocr_raw_text || null });
}

const markOcrDoneStmt = db.prepare(`UPDATE receipts SET ocr_status = 'done' WHERE id = ? AND ocr_status = 'pending'`);

function markOcrDone(id) {
  return markOcrDoneStmt.run(id);
}

// Attach a batch of the user's own currently-unassigned receipts to a report.
// Scoped to user_id + report_id IS NULL so nobody can attach someone else's
// receipt (or one already claimed by another report) by guessing an id.
function attachReceiptsToReport(receiptIds, reportId, userId) {
  const stmt = db.prepare(`
    UPDATE receipts SET report_id = ?
    WHERE id = ? AND user_id = ? AND report_id IS NULL
  `);
  const runAll = db.transaction((ids) => {
    for (const id of ids) stmt.run(reportId, id, userId);
  });
  return runAll(receiptIds);
}

const detachReceiptStmt = db.prepare(`
  UPDATE receipts SET report_id = NULL WHERE id = ? AND report_id = ?
`);

function detachReceiptFromReport(receiptId, reportId) {
  return detachReceiptStmt.run(receiptId, reportId);
}

const deleteReceiptStmt = db.prepare(`DELETE FROM receipts WHERE id = ?`);

function deleteReceipt(id) {
  return deleteReceiptStmt.run(id);
}

// ---------- Activity log (for the admin usage dashboard) ----------

const insertActivityStmt = db.prepare(`
  INSERT INTO activity_log (user_id, action, detail) VALUES (?, ?, ?)
`);

function logActivity(userId, action, detail) {
  return insertActivityStmt.run(userId, action, detail || null);
}

const perUserStatsStmt = db.prepare(`
  SELECT
    u.id, u.username, u.display_name, u.is_admin, u.created_at AS joined_at,
    u.employee_number, u.department, u.email,
    COUNT(CASE WHEN a.action = 'login' THEN 1 END) AS logins,
    COUNT(CASE WHEN a.action = 'register' THEN 1 END) AS registrations,
    COUNT(CASE WHEN a.action = 'receipt_upload' THEN 1 END) AS uploads,
    COUNT(CASE WHEN a.action = 'receipt_attach' THEN 1 END) AS attaches,
    COUNT(CASE WHEN a.action = 'report_created' THEN 1 END) AS reports_created,
    COUNT(CASE WHEN a.action = 'report_submitted' THEN 1 END) AS reports_submitted,
    COUNT(CASE WHEN a.action = 'report_paid' THEN 1 END) AS reports_paid,
    COUNT(CASE WHEN a.action = 'report_exported' THEN 1 END) AS exports,
    MAX(a.created_at) AS last_active
  FROM users u
  LEFT JOIN activity_log a ON a.user_id = u.id
  GROUP BY u.id
  ORDER BY last_active DESC, u.created_at ASC
`);

function getPerUserActivityStats() {
  return perUserStatsStmt.all();
}

const recentActivityStmt = db.prepare(`
  SELECT a.*, u.display_name, u.username
  FROM activity_log a
  LEFT JOIN users u ON u.id = a.user_id
  ORDER BY a.created_at DESC
  LIMIT ?
`);

function listRecentActivity(limit) {
  return recentActivityStmt.all(limit || 100);
}

const activityCountsStmt = db.prepare(`
  SELECT action, COUNT(*) AS n FROM activity_log GROUP BY action
`);

function getActivityActionCounts() {
  return activityCountsStmt.all();
}

// ---------- Admin: receipts-over-time chart ----------

const receiptCountsByDayStmt = db.prepare(`
  SELECT date(created_at) AS bucket, COUNT(*) AS n
  FROM receipts
  WHERE created_at >= datetime('now', ?)
  GROUP BY bucket
`);

const receiptCountsByMonthStmt = db.prepare(`
  SELECT strftime('%Y-%m', created_at) AS bucket, COUNT(*) AS n
  FROM receipts
  WHERE created_at >= datetime('now', ?)
  GROUP BY bucket
`);

// Returns sparse {bucket, n} rows for receipts created in the last
// `rangeDays` days, bucketed by day or by month - GROUP BY only ever
// returns buckets that actually have rows, so the caller fills in the
// zero-count gaps (e.g. days with no uploads) itself.
function getReceiptCountsSince(rangeDays, granularity) {
  const modifier = `-${rangeDays} days`;
  const stmt = granularity === 'month' ? receiptCountsByMonthStmt : receiptCountsByDayStmt;
  return stmt.all(modifier);
}

const totalsStmt = {
  users: db.prepare('SELECT COUNT(*) AS n FROM users'),
  reports: db.prepare(`
    SELECT COUNT(*) AS n,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid
    FROM reports
  `),
  receipts: db.prepare('SELECT COUNT(*) AS n FROM receipts'),
};

function getOverallTotals() {
  const users = totalsStmt.users.get().n;
  const reportRow = totalsStmt.reports.get();
  const receipts = totalsStmt.receipts.get().n;
  return {
    users,
    reports: reportRow.n,
    reportsSubmitted: reportRow.submitted || 0,
    reportsPaid: reportRow.paid || 0,
    receipts,
  };
}

// ---------- Site-wide broadcast banner ----------

const getBroadcastMessageStmt = db.prepare('SELECT message FROM broadcast_message WHERE id = 1');

function getBroadcastMessage() {
  const row = getBroadcastMessageStmt.get();
  return row ? row.message : '';
}

const setBroadcastMessageStmt = db.prepare(
  "UPDATE broadcast_message SET message = ?, updated_at = datetime('now') WHERE id = 1",
);

function setBroadcastMessage(message) {
  return setBroadcastMessageStmt.run(message);
}

module.exports = {
  insertUser,
  findUserByUsername,
  getUserById,
  countUsers,
  updateDisplayName,
  updateProfile,
  updatePasswordHash,
  listAllUsers,
  listPendingUsers,
  approveUser,
  denyUser,
  createReport,
  getReportById,
  listReportsForUser,
  getUnassignedReceiptsTotal,
  getSubmittedReceiptsTotal,
  renameReport,
  submitReport,
  reopenReport,
  markReportPaid,
  deleteReport,
  createReceipt,
  getReceiptById,
  listReceiptsForReport,
  listUnassignedReceiptsForUser,
  attachReceiptsToReport,
  detachReceiptFromReport,
  updateReceipt,
  completeOcrScan,
  markOcrDone,
  deleteReceipt,
  logActivity,
  getPerUserActivityStats,
  listRecentActivity,
  getActivityActionCounts,
  getOverallTotals,
  getBroadcastMessage,
  setBroadcastMessage,
  getReceiptCountsSince,
};
