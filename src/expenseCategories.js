// The MMFS reimbursement form (see excelExport.js) has five expense
// columns. Every receipt used to hardcode "Local Entertainment" regardless
// of what it actually was - this is now a per-receipt choice (a radio
// button on the receipt-edit page). `key` is what's stored on the receipt
// row; excelExport.js maps each key to the column its total lands in.
const EXPENSE_CATEGORIES = [
  { key: 'local_entertainment', label: 'Local Entertainment', hint: 'lunches, games, coffee, etc.' },
  { key: 'education', label: 'Education', hint: '' },
  { key: 'vehicle', label: 'Vehicle', hint: 'parking, repairs, towing' },
  { key: 'misc', label: 'Misc', hint: 'office supplies, material, etc.' },
  { key: 'out_of_town', label: 'Out of Town', hint: 'lodging, meals, transportation' },
];

const DEFAULT_EXPENSE_CATEGORY = 'local_entertainment';
const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key);

module.exports = { EXPENSE_CATEGORIES, DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORY_KEYS };
