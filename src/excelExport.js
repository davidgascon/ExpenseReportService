const path = require('path');
const ExcelJS = require('exceljs');

// Fills MacDonald-Miller's own "General" tab reimbursement form — the exact
// file David uses at work (templates/Expense_Report_General.xlsx) — rather
// than generating an approximation of it. Per his explicit direction:
//   - every receipt's total goes in the Local Entertainment column,
//     regardless of what it actually was
//   - the GL/Job Cost Code column is the receipt's own gl_code field
//   - only the General tab matters; the other three MMFS tabs are unused
//
// Why .xlsx and not the original .xls: David's original file is legacy
// binary Excel 97-2003 format. The only pure-JS library that can *write*
// that format (the "xlsx"/SheetJS package) was tested against this exact
// file and silently drops real data on write (dollar amounts and GL codes
// vanished in a round-trip test) — unacceptable for a financial document.
// exceljs, which only supports the modern .xlsx container, preserves every
// value, formula, and style correctly. The bundled template
// (templates/Expense_Report_General.xlsx) is David's original .xls
// converted once via LibreOffice — visually and structurally identical,
// just in a container format that can actually be round-tripped without
// losing data. Opens identically in Excel.
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'Expense_Report_General.xlsx');
const SHEET_NAME = 'General';

// Data rows in the template run from row 10 through row 35 (26 rows) —
// every one of them already has a per-row TOTAL formula baked in
// (`=IF(SUM(F<row>:K<row>)>0,SUM(F<row>:K<row>),"")`), including the blank
// sample rows, so we never need to write that formula ourselves.
const FIRST_DATA_ROW = 10;
const LAST_DATA_ROW = 35;
const MAX_RECEIPTS = LAST_DATA_ROW - FIRST_DATA_ROW + 1;
const TOTALS_ROW = 36;

const COL = {
  DATE: 1, // A
  DESCRIPTION: 2, // B (merged B:E per row)
  EDUCATION: 6, // F
  LOCAL_ENTERTAINMENT: 7, // G — every receipt's total lands here
  VEHICLE: 8, // H
  MISC: 9, // I
  OUT_OF_TOWN_1: 10, // J
  OUT_OF_TOWN_2: 11, // K
  GL_CODE: 12, // L
  TOTAL: 13, // M — formula, cached result only
};

// The template has a few stray columns past M (a blank spacer column N, and
// O/P which held duplicate totals and informal personal notes from David's
// own original file - never part of the official form). Per explicit
// request, the exported sheet should only show columns A through M -
// deleted outright at the end of buildFilledWorkbook rather than just
// clearing their values, so they're gone from both the raw .xlsx and the
// PDF render, not just blank.
const LAST_VISIBLE_COL = 13; // M
const FIRST_COL_TO_DELETE = LAST_VISIBLE_COL + 1;
const TEMPLATE_TOTAL_COLS = 16; // P — the template's actual rightmost column

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

function descriptionFor(r) {
  // The Description column now comes straight from the receipt's own
  // editable `description` field (defaults to "Project Lunch: " but the
  // person can change it to anything) rather than being assembled from
  // notes/attendees.
  return r.description || '';
}

// Re-sets a formula cell's cached display value while leaving its formula
// text untouched, so the file shows correct totals immediately even in a
// viewer that doesn't recalculate on open (and stays a live formula for
// David if he opens it in Excel and edits a number by hand afterward).
function setFormulaResult(cell, result) {
  const existingFormula = typeof cell.value === 'object' && cell.value && cell.value.formula
    ? cell.value.formula
    : cell.formula;
  if (existingFormula) {
    cell.value = { formula: existingFormula, result };
  } else {
    cell.value = result;
  }
}

function clearDataRow(ws, row) {
  [COL.DATE, COL.DESCRIPTION, COL.EDUCATION, COL.LOCAL_ENTERTAINMENT, COL.VEHICLE, COL.MISC,
    COL.OUT_OF_TOWN_1, COL.OUT_OF_TOWN_2, COL.GL_CODE]
    .forEach((col) => { ws.getRow(row).getCell(col).value = null; });
}

/**
 * Fills the General tab template for one report and returns a workbook
 * containing only that sheet (the other three unused MMFS tabs are
 * dropped — David only ever fills out General).
 * @param {object} report
 * @param {object[]} receipts
 * @param {object} user - report owner; supplies the Employee Name, Employee #,
 *   and Department header fields (employee_number/department are editable
 *   per-user on the Account page, not baked into the template anymore)
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

  // Header fields. Employee # and Department are now editable per-user (see
  // the Account page) rather than left as whatever David's original
  // template happened to contain.
  ws.getCell('B2').value = user.display_name;
  ws.getCell('D3').value = user.employee_number || '';
  ws.getCell('E3').value = new Date();
  ws.getCell('F3').value = periodCoveredLabel(receipts);
  ws.getCell('K3').value = user.department || '';

  // The template's own header text has a stray hyphen baked into the cell
  // ("EDUCA-TION" across the merged F6:F9 block) — fix it to read correctly
  // on every export.
  ws.getCell('F6').value = 'EDUCATION';

  const sorted = [...receipts].sort((a, b) => (a.receipt_date || '').localeCompare(b.receipt_date || ''));

  for (let i = 0; i < MAX_RECEIPTS; i++) {
    const row = FIRST_DATA_ROW + i;
    clearDataRow(ws, row);

    const r = sorted[i];
    const rowRef = ws.getRow(row);

    if (!r) {
      // Rows past the last real receipt still carry a cached TOTAL formula
      // result from David's original personal sample data (e.g. "28.98" on
      // an otherwise-blank row). clearDataRow() wipes the input columns but
      // deliberately leaves TOTAL alone (it's a formula, not raw input) —
      // so it must be reset here explicitly, or a PDF/viewer that trusts
      // the cached value instead of recalculating will show a stale total
      // on a row with no receipt at all.
      setFormulaResult(rowRef.getCell(COL.TOTAL), '');
      continue;
    }

    if (r.receipt_date) rowRef.getCell(COL.DATE).value = new Date(`${r.receipt_date}T00:00:00Z`);
    rowRef.getCell(COL.DESCRIPTION).value = descriptionFor(r);
    rowRef.getCell(COL.LOCAL_ENTERTAINMENT).value = Number(r.total || 0);
    if (r.gl_code) rowRef.getCell(COL.GL_CODE).value = r.gl_code;
    setFormulaResult(rowRef.getCell(COL.TOTAL), Number(r.total || 0));
  }

  // Totals row: every category column except Local Entertainment sums to
  // zero (shown as "" per the template's own IF formula), since every
  // receipt goes into Local Entertainment by design.
  const grandTotal = sorted.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const totalsRow = ws.getRow(TOTALS_ROW);
  setFormulaResult(totalsRow.getCell(COL.EDUCATION), '');
  setFormulaResult(totalsRow.getCell(COL.LOCAL_ENTERTAINMENT), grandTotal || '');
  setFormulaResult(totalsRow.getCell(COL.VEHICLE), '');
  setFormulaResult(totalsRow.getCell(COL.MISC), '');
  setFormulaResult(totalsRow.getCell(COL.OUT_OF_TOWN_1), '');
  setFormulaResult(totalsRow.getCell(COL.TOTAL), grandTotal || 0);

  // Drop every column past M entirely (a blank spacer plus two stray
  // personal-data columns from David's original file - see the comment by
  // LAST_VISIBLE_COL above). Deleting rather than clearing means they're
  // gone from the sheet's actual dimensions, not just blank-looking.
  ws.spliceColumns(FIRST_COL_TO_DELETE, TEMPLATE_TOTAL_COLS - LAST_VISIBLE_COL);

  // Guarantee it prints/exports as a single page regardless of whatever
  // page setup survived the original .xls -> .xlsx conversion.
  ws.pageSetup = { ...ws.pageSetup, fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

  // Drop the other three MMFS tabs (CSP & NC Sales / SSP Sales / Maintenance
  // Sales) and the instructions/misc-codes sheets — David only ever fills
  // out General, so there's nothing useful in them for any export.
  [...workbook.worksheets].forEach((sheet) => {
    if (sheet.name !== SHEET_NAME) workbook.removeWorksheet(sheet.id);
  });

  return workbook;
}

async function buildReportExcelBuffer(report, receipts, user) {
  const workbook = await buildFilledWorkbook(report, receipts, user);
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildReportExcelBuffer, buildFilledWorkbook };
