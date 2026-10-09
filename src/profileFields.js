// Optional-but-recommended profile fields, shared by the topbar badge, the
// account-page banner, and the admin dashboard's per-user tooltip so all
// three stay in sync with a single definition of what "incomplete" means.
// Email intentionally isn't in this list - it's no longer editable from the
// account page (see views/account.ejs), so flagging it as "missing" would be
// a dead end nobody could resolve.
const OPTIONAL_FIELDS = [
  { key: 'employee_number', label: 'Employee #', hint: 'for your exported spreadsheet' },
  { key: 'department', label: 'Department', hint: 'for your exported spreadsheet' },
];

function getMissingProfileFields(user) {
  return OPTIONAL_FIELDS.filter((field) => !user[field.key] || !String(user[field.key]).trim());
}

module.exports = { getMissingProfileFields };
