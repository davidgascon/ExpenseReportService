const path = require('path');
const ExcelJS = require('exceljs');
const { DEFAULT_EXPENSE_CATEGORY } = require('./expenseCategories');

// Fills MacDonald-Miller's own "General" tab reimbursement form - the exact
// file the company sends out (templates/Expense_Report_General.xlsx) - rather
// than generating an approximation of it. Per David's explicit direction:
//   - each receipt's total goes in whichever of the five expense columns
//     its expense_category picks (see src/expenseCategories.js)
//   - the GL / Job# & Dept# cells are the receipt's own gl_code field, split
//     into the form's separate Job Number and Cost Code cells
//   - only the General tab matters; the "Misc. Codes" reference tab is dropped
//
// Why .xlsx and not the original .xls: the company's file is legacy binary
// Excel 97-2003 format. The only pure-JS library that can *write* that format
// (the "xlsx"/SheetJS package) was tested against an earlier version of this
// form and silently dropped real data on write (dollar amounts and GL codes
// vanished in a round-trip test) - unacceptable for a financial document.
// exceljs, which only supports the modern .xlsx container, preserves every
// value, formula, and style correctly. The bundled template
// (templates/Expense_Report_General.xlsx) is the company's .xls converted
// once via LibreOffice - visually and structurally identical, just in a
// container format that can actually be round-tripped without losing data.
// The original is kept alongside it as templates/Expense_Report.xls for
// provenance; no code reads it.
//
// LAYOUT HISTORY: this targets the October 2026 redesign of the form. It
// differs from the version before it in ways that matter here:
//   - Description (merged B:E) became four separate columns: WHAT (B),
//     CUSTOMER NAME(S) (C), COMPANY(IES) (D), WHERE (E)
//   - GL / JOB# & DEPT# became two cells: Job Number (L) and Cost Code (M)
//   - TOTAL moved from column M to column N
//   - the header's Department moved from K3 to L3 and the Employee Name value
//     from the old B2:C3 merge to B3
//   - the "Approved By (Please Print)" line is gone (signature space only)
//   - row 10 ships as a yellow, taller "example" row; it's the first real
//     data row, so it's restyled to match the rest below
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'Expense_Report_General.xlsx');
const SHEET_NAME = 'General';

// Data rows in the template run from row 10 through row 35 (26 rows) - every
// one of them already has a per-row TOTAL formula baked in
// (`=(SUM(F<row>:K<row>))`), so we never need to write that formula ourselves.
const FIRST_DATA_ROW = 10;
const LAST_DATA_ROW = 35;
const MAX_RECEIPTS = LAST_DATA_ROW - FIRST_DATA_ROW + 1;
const TOTALS_ROW = 36;
// Row 11 is a plain, unstyled-by-example data row - used as the style source
// for row 10 (see normalizeFirstRow).
const STYLE_SOURCE_ROW = 11;
const DEFAULT_ROW_HEIGHT = 12.75;

const COL = {
  DATE: 1, // A
  WHAT: 2, // B
  CUSTOMERS: 3, // C
  COMPANIES: 4, // D
  WHERE: 5, // E
  EDUCATION: 6, // F
  LOCAL_ENTERTAINMENT: 7, // G
  VEHICLE: 8, // H
  MISC: 9, // I
  OUT_OF_TOWN_1: 10, // J
  OUT_OF_TOWN_2: 11, // K
  JOB_NUMBER: 12, // L
  COST_CODE: 13, // M
  TOTAL: 14, // N - formula, cached result only
};

// Maps each expense_category key (see src/expenseCategories.js) to the
// column its total lands in. OUT_OF_TOWN_2 (column K) is deliberately never
// targeted - the template's header merges J:K under one "Out of Town" label,
// and the totals-row merges J36:K36 into a single cell that only ever shows
// column J's sum.
const COLUMN_FOR_CATEGORY = {
  local_entertainment: COL.LOCAL_ENTERTAINMENT,
  education: COL.EDUCATION,
  vehicle: COL.VEHICLE,
  misc: COL.MISC,
  out_of_town: COL.OUT_OF_TOWN_1,
};

function columnForCategory(category) {
  return COLUMN_FOR_CATEGORY[category] || COLUMN_FOR_CATEGORY[DEFAULT_EXPENSE_CATEGORY];
}

// The template's actual rightmost visible column is N (TOTAL); it also carries
// two empty, styled columns past that (O, P) that are outside its own print
// area. Dropped outright at the end of buildFilledWorkbook rather than just
// cleared, so they're gone from both the raw .xlsx and the PDF render.
const LAST_VISIBLE_COL = 14; // N

function usDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function periodCoveredLabel(receipts) {
  const dates = receipts.map((r) => r.receipt_date).filter(Boolean).sort();
  if (dates.length === 0) return '';
  const first = usDateLabel(dates[0]);
  const last = usDateLabel(dates[dates.length - 1]);
  return first === last ? first : `${first}-${last}`;
}

// The form has two cells where the app has one GL code: "Job Number" and
// "Cost Code". Splits at the first dash - 86259049-000-95-90 becomes Job
// Number 86259049 and Cost Code 000-95-90. A code with no dash at all (or one
// that starts with a dash) goes entirely in Job Number, with Cost Code left
// blank, rather than guessing at a split that isn't there.
function splitGlCode(glCode) {
  const code = (glCode || '').trim();
  if (!code) return { jobNumber: '', costCode: '' };
  const dash = code.indexOf('-');
  if (dash <= 0) return { jobNumber: code, costCode: '' };
  return { jobNumber: code.slice(0, dash), costCode: code.slice(dash + 1) };
}

// Re-sets a formula cell's cached display value while leaving its formula
// text untouched, so the file shows correct totals immediately even in a
// viewer that doesn't recalculate on open (and stays a live formula if
// someone opens it in Excel and edits a number by hand afterward).
//
// A cell that's part of an Excel "shared formula" group (filling a formula
// down/across a range, rather than typing it into every cell individually)
// exposes it differently depending on whether the cell is the group's
// master or one of its slaves: the master has `.formula` like a normal
// formula cell, but a slave only has `.sharedFormula` (pointing back at the
// master's address) - it never has `.formula` itself. Missing that case
// meant a filled-down formula silently got stripped from every slave cell
// on export, replaced with a plain number.
function setFormulaResult(cell, result) {
  const value = cell.value;
  if (value && typeof value === 'object' && value.formula) {
    cell.value = { formula: value.formula, result };
  } else if (value && typeof value === 'object' && value.sharedFormula) {
    cell.value = { sharedFormula: value.sharedFormula, result };
  } else if (cell.formula) {
    cell.value = { formula: cell.formula, result };
  } else {
    cell.value = result;
  }
}

function clearDataRow(ws, row) {
  [COL.DATE, COL.WHAT, COL.CUSTOMERS, COL.COMPANIES, COL.WHERE, COL.EDUCATION, COL.LOCAL_ENTERTAINMENT,
    COL.VEHICLE, COL.MISC, COL.OUT_OF_TOWN_1, COL.OUT_OF_TOWN_2, COL.JOB_NUMBER, COL.COST_CODE]
    .forEach((col) => { ws.getRow(row).getCell(col).value = null; });
}

// Row 10 ships from the company as a yellow, taller worked example ("example:
// Lunch, Dinner, etc." / "Names of people you bought lunch for" / "Venue")
// with its own sample amounts. It's still a real data row - the first of 26
// - so it's restyled here to look exactly like every row below it instead of
// printing the first receipt on a highlighted example row. The sample text
// itself is wiped by clearDataRow like any other row.
function normalizeFirstRow(ws) {
  const source = ws.getRow(STYLE_SOURCE_ROW);
  const target = ws.getRow(FIRST_DATA_ROW);
  for (let col = 1; col <= LAST_VISIBLE_COL; col++) {
    target.getCell(col).style = structuredClone(source.getCell(col).style);
  }
  target.height = source.height || DEFAULT_ROW_HEIGHT;
}

// Every data row ships at a fixed one-line height (12.75pt) with wrapped text,
// so a long description would simply be clipped. Sizes each row to the number
// of lines its wordiest cell needs instead. The characters-per-line figures
// are conservative estimates for 9pt text in each column's width (column
// widths come from the template itself, so this stays in step if the company
// resizes them) - slightly generous is fine, clipped text is not.
const ROW_LINE_HEIGHT = 11.5;
const MAX_ROW_HEIGHT = 70;

function estimatedLines(text, columnWidth) {
  const value = String(text || '');
  if (!value) return 1;
  const charsPerLine = Math.max(4, Math.floor((columnWidth || 10) * 1.1));
  return value.split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / charsPerLine)), 0);
}

function fitRowHeight(ws, rowNumber, textByColumn) {
  let lines = 1;
  Object.entries(textByColumn).forEach(([col, text]) => {
    lines = Math.max(lines, estimatedLines(text, ws.getColumn(Number(col)).width));
  });
  ws.getRow(rowNumber).height = lines <= 1
    ? DEFAULT_ROW_HEIGHT
    : Math.min(MAX_ROW_HEIGHT, lines * ROW_LINE_HEIGHT + 2);
}

/**
 * Fills the General tab template for one report and returns a workbook
 * containing only that sheet (the company's "Misc. Codes" reference tab is
 * dropped - there's nothing useful in it for any export).
 * @param {object} report
 * @param {object[]} receipts
 * @param {object} user - report owner; supplies the Employee Name, Employee #,
 *   and Department header fields (editable per-user on the Account page, not
 *   baked into the template)
 * @returns {Promise<ExcelJS.Workbook>}
 */
async function buildFilledWorkbook(report, receipts, user) {
  if (receipts.length > MAX_RECEIPTS) {
    const err = new Error(
      `This report has ${receipts.length} receipts, but the MMFS template only has room for ${MAX_RECEIPTS} rows on the General tab. Split it into more than one report before exporting.`,
    );
    err.statusCode = 400;
    throw err;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  const ws = workbook.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Template is missing the expected "${SHEET_NAME}" sheet.`);

  // Header fields. Company (H3, "Portland") is left exactly as the template
  // ships it. Department (L3) ships pre-filled too ("Building Controls") -
  // someone who has set their own department on the Account page overrides
  // it; everyone else keeps the template's value rather than a blank.
  ws.getCell('B3').value = user.display_name;
  ws.getCell('D3').value = user.employee_number || '';
  ws.getCell('E3').value = new Date();
  ws.getCell('F3').value = periodCoveredLabel(receipts);
  if (user.department) ws.getCell('L3').value = user.department;

  // The template's own header text still has a stray hyphen baked into the
  // cell ("EDUCA-TION" across the merged F6:F9 block) - fix it to read
  // correctly on every export.
  ws.getCell('F6').value = 'EDUCATION';

  normalizeFirstRow(ws);

  const sorted = [...receipts].sort((a, b) => (a.receipt_date || '').localeCompare(b.receipt_date || ''));

  for (let i = 0; i < MAX_RECEIPTS; i++) {
    const row = FIRST_DATA_ROW + i;
    clearDataRow(ws, row);

    const r = sorted[i];
    const rowRef = ws.getRow(row);

    if (!r) {
      // Rows past the last real receipt still carry a cached TOTAL result from
      // the template's own worked example (row 10 caches "35.35"). The input
      // cells were just wiped, so reset TOTAL to what the template's own
      // formula yields for an empty row (0, shown as $0.00) - otherwise a
      // PDF/viewer that trusts the cached value instead of recalculating
      // would show a stale total on a row with no receipt at all.
      rowRef.height = DEFAULT_ROW_HEIGHT;
      setFormulaResult(rowRef.getCell(COL.TOTAL), 0);
      continue;
    }

    const { jobNumber, costCode } = splitGlCode(r.gl_code);
    const what = r.description || '';
    const customers = r.customer_names || '';
    const companies = r.company_names || '';
    const venue = r.venue || '';

    if (r.receipt_date) rowRef.getCell(COL.DATE).value = new Date(`${r.receipt_date}T00:00:00Z`);
    rowRef.getCell(COL.WHAT).value = what;
    rowRef.getCell(COL.CUSTOMERS).value = customers;
    rowRef.getCell(COL.COMPANIES).value = companies;
    rowRef.getCell(COL.WHERE).value = venue;
    rowRef.getCell(columnForCategory(r.expense_category)).value = Number(r.total || 0);
    if (jobNumber) rowRef.getCell(COL.JOB_NUMBER).value = jobNumber;
    if (costCode) rowRef.getCell(COL.COST_CODE).value = costCode;
    setFormulaResult(rowRef.getCell(COL.TOTAL), Number(r.total || 0));

    fitRowHeight(ws, row, {
      [COL.WHAT]: what,
      [COL.CUSTOMERS]: customers,
      [COL.COMPANIES]: companies,
      [COL.WHERE]: venue,
      [COL.JOB_NUMBER]: jobNumber,
      [COL.COST_CODE]: costCode,
    });
  }

  // Totals row: each category column sums just the receipts that landed in
  // it (shown as "" per the template's own IF formula when there's nothing
  // in that category).
  const categoryTotals = {};
  sorted.forEach((r) => {
    const col = columnForCategory(r.expense_category);
    categoryTotals[col] = (categoryTotals[col] || 0) + Number(r.total || 0);
  });
  const grandTotal = sorted.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const totalsRow = ws.getRow(TOTALS_ROW);
  [COL.EDUCATION, COL.LOCAL_ENTERTAINMENT, COL.VEHICLE, COL.MISC, COL.OUT_OF_TOWN_1].forEach((col) => {
    setFormulaResult(totalsRow.getCell(col), categoryTotals[col] || '');
  });

  // The template's own grand-total formula in N36 is `=(SUM(G36:L36))`, which
  // starts at column G and so leaves out column F (Education) - confirmed by
  // recalculating the unmodified template with an Education amount in it: the
  // grand total came out short by exactly that amount. A report whose
  // receipts include any Education expense would show a wrong grand total
  // the moment anything recalculated it (opening in Excel and editing a
  // number, for instance). Summing the per-row totals instead is correct
  // regardless of which columns are used, and is what "totals down and across
  // must balance" actually means.
  totalsRow.getCell(COL.TOTAL).value = {
    formula: `SUM(N${FIRST_DATA_ROW}:N${LAST_DATA_ROW})`,
    result: grandTotal,
  };

  // Drop every column past N entirely (two empty, styled columns outside the
  // template's own print area - see LAST_VISIBLE_COL above). Deleting rather
  // than clearing means they're gone from the sheet's actual dimensions, not
  // just blank-looking.
  if (ws.columnCount > LAST_VISIBLE_COL) {
    ws.spliceColumns(LAST_VISIBLE_COL + 1, ws.columnCount - LAST_VISIBLE_COL);
  }

  // Guarantee it prints/exports as a single page regardless of whatever
  // page setup survived the original .xls -> .xlsx conversion.
  ws.pageSetup = { ...ws.pageSetup, fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

  // Drop every sheet but General (the "Misc. Codes" reference tab).
  [...workbook.worksheets].forEach((sheet) => {
    if (sheet.name !== SHEET_NAME) workbook.removeWorksheet(sheet.id);
  });

  return workbook;
}

async function buildReportExcelBuffer(report, receipts, user) {
  const workbook = await buildFilledWorkbook(report, receipts, user);
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildReportExcelBuffer, buildFilledWorkbook, splitGlCode };
