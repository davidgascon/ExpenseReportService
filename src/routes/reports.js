const express = require('express');
const models = require('../db/models');
const { buildReportPdf } = require('../pdfExport');
const { buildFilledWorkbook, buildReportExcelBuffer } = require('../excelExport');
const { convertXlsxBufferToPdf } = require('../xlsxToPdf');
const { userUploadDir } = require('./receipts');

const router = express.Router();

function todayLabel() {
  const now = new Date();
  return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Ensure the requested report belongs to the logged-in user; attach it to req.
function loadOwnedReport(req, res, next) {
  const report = models.getReportById(Number(req.params.id));
  if (!report || report.user_id !== req.user.id) {
    return res.status(404).render('error', { message: 'Report not found.' });
  }
  req.report = report;
  next();
}

function requireDraft(req, res, next) {
  if (req.report.status !== 'draft') {
    return res.status(400).render('error', { message: 'This report has been submitted and can no longer be edited. Reopen it first.' });
  }
  next();
}

router.get('/', (req, res) => {
  const reports = models.listReportsForUser(req.user.id);
  const unassignedTotal = models.getUnassignedReceiptsTotal(req.user.id);
  const submittedTotal = models.getSubmittedReceiptsTotal(req.user.id);
  res.render('dashboard', { reports, unassignedTotal, submittedTotal });
});

router.post('/', (req, res) => {
  let name = (req.body.name || '').trim();
  if (!name) name = todayLabel();
  const report = models.createReport({ user_id: req.user.id, name });
  models.logActivity(req.user.id, 'report_created', report.name);
  res.redirect(`/reports/${report.id}`);
});

router.get('/:id', loadOwnedReport, (req, res) => {
  const receipts = models.listReceiptsForReport(req.report.id);
  const total = receipts.reduce((sum, r) => sum + r.total, 0);
  const inboxReceipts = req.report.status === 'draft' ? models.listUnassignedReceiptsForUser(req.user.id) : [];
  res.render('report', { report: req.report, receipts, total, inboxReceipts, error: null });
});

router.post('/:id/rename', loadOwnedReport, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name && req.report.status === 'draft') {
    models.renameReport(req.report.id, name);
  }
  res.redirect(`/reports/${req.report.id}`);
});

router.post('/:id/submit', loadOwnedReport, (req, res) => {
  models.submitReport(req.report.id);
  models.logActivity(req.user.id, 'report_submitted', req.report.name);
  res.redirect(`/reports/${req.report.id}`);
});

router.post('/:id/reopen', loadOwnedReport, (req, res) => {
  models.reopenReport(req.report.id);
  res.redirect(`/reports/${req.report.id}`);
});

router.post('/:id/mark-paid', loadOwnedReport, (req, res) => {
  models.markReportPaid(req.report.id);
  models.logActivity(req.user.id, 'report_paid', req.report.name);
  res.redirect(`/reports/${req.report.id}`);
});

router.post('/:id/delete', loadOwnedReport, (req, res) => {
  // Receipts are NOT deleted — the foreign key is ON DELETE SET NULL, so they
  // just fall back into the user's inbox, unassigned.
  models.deleteReport(req.report.id);
  res.redirect('/');
});

// Check off receipts from the personal inbox to include in this report.
router.post('/:id/receipts/attach', loadOwnedReport, requireDraft, (req, res) => {
  let ids = req.body.receipt_ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(Number).filter((n) => Number.isInteger(n));
  if (ids.length) {
    models.attachReceiptsToReport(ids, req.report.id, req.user.id);
    models.logActivity(req.user.id, 'receipt_attach', `${ids.length} receipt(s) -> ${req.report.name}`);
  }
  res.redirect(`/reports/${req.report.id}`);
});

// Move a receipt back out of the report into the inbox (doesn't delete it).
router.post('/:id/receipts/:receiptId/detach', loadOwnedReport, requireDraft, (req, res) => {
  models.detachReceiptFromReport(Number(req.params.receiptId), req.report.id);
  res.redirect(`/reports/${req.report.id}`);
});

// Export PDF: the filled MMFS spreadsheet (rendered to PDF via LibreOffice)
// first, then one page per receipt — per explicit request, this replaced an
// earlier custom-drawn summary page.
router.get('/:id/export', loadOwnedReport, async (req, res, next) => {
  try {
    const receipts = models.listReceiptsForReport(req.report.id);
    const workbook = await buildFilledWorkbook(req.report, receipts, req.user);
    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    const excelPdfBytes = await convertXlsxBufferToPdf(xlsxBuffer);
    const pdfBytes = await buildReportPdf(req.report, receipts, userUploadDir, excelPdfBytes);
    const safeName = req.report.name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'expense-report';
    models.logActivity(req.user.id, 'report_exported', req.report.name);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).render('error', { message: err.message });
    }
    next(err);
  }
});

// MMFS's own "General" tab Excel format — see src/excelExport.js for the
// column mapping and why this fills David's actual template file rather
// than generating an approximation of it.
router.get('/:id/export-excel', loadOwnedReport, async (req, res, next) => {
  try {
    const receipts = models.listReceiptsForReport(req.report.id);
    const buffer = await buildReportExcelBuffer(req.report, receipts, req.user);
    const safeName = req.report.name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'expense-report';
    models.logActivity(req.user.id, 'report_exported', `${req.report.name} (excel)`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).render('error', { message: err.message });
    }
    next(err);
  }
});

module.exports = { router, loadOwnedReport };
