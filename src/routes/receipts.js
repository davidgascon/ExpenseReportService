const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
// sharp's native binary has been unreliable to install in some Docker
// environments (a bug in sharp's own error-reporting code turns a failed
// native-binding load into an opaque "Cannot read properties of undefined
// (reading 'endsWith')" crash). Since this only powers a nice-to-have
// (auto-rotating photos that carry an EXIF orientation tag), it must never
// be allowed to take the whole app down — load it defensively and just
// skip orientation normalization if it's unavailable, rather than crash
// the server on every startup.
let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  console.error(
    'WARNING: the "sharp" image library failed to load — receipts will be saved exactly as uploaded, without automatic EXIF orientation correction. Everything else (upload, reports, exports) is unaffected. Original error:',
    err.message,
  );
}
const models = require('../db/models');
const mailer = require('../mailer');
const { UPLOAD_ROOT } = require('../config');
const { EXPENSE_CATEGORIES, DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORY_KEYS } = require('../expenseCategories');
const { sniff, EXT_FOR_TYPE, CONTENT_TYPE_FOR_TYPE } = require('../fileSniff');
const convertHeic = require('heic-convert');

const router = express.Router();

// This is only a UI hint (the accept="" attribute / a fast rejection for
// obviously-wrong files) — it is NOT the security boundary. A browser's
// declared mimetype is just a label the uploader's OS/browser attaches and
// is trivial to get wrong (iPhones are inconsistent about what they report
// for HEIC) or spoof outright, so it is never trusted for the actual accept/
// reject decision. That decision is made purely from the file's real bytes
// after it hits disk — see the magic-byte sniff in the /scan handler below.
// WEBP is intentionally not accepted at all: the PDF export feature embeds
// images directly, and the PDF library used for that only supports JPEG/PNG.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf']);

function userUploadDir(userId) {
  const dir = path.join(UPLOAD_ROOT, String(userId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      cb(null, userUploadDir(req.user.id));
    } catch (err) {
      cb(err);
    }
  },
  // Deliberately ignores the uploaded file's own name/extension entirely -
  // it's attacker-controlled input (someone could name a file
  // "receipt.jpg" whose actual bytes are an HTML/script payload) and is
  // never used to decide anything. Every file lands under a random name
  // with a neutral, inert extension; the real extension is only assigned
  // once the content has been verified by magic bytes, below.
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.upload`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Reads just the first bytes of a file - enough for every signature fileSniff
// checks for - without loading potentially-large PDFs fully into memory just
// to identify them.
function readFileHeader(filePath, length = 1024) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.slice(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

// Authoritative type/safety check for an uploaded file, run AFTER multer
// writes it to disk under its neutral random name. Converts HEIC (the
// default format modern iPhones save Camera Roll photos in) to JPEG, since
// browsers other than Safari can't display HEIC at all - without this,
// iPhone photos exported normally ("Share" > "Save Original") would
// silently fail to preview anywhere but Safari. Returns the sniffed/final
// type ('jpeg' | 'png' | 'pdf') and renames the file to the matching real
// extension, or throws if the content isn't one of the types this app
// supports at all, regardless of what filename/mimetype it arrived with.
async function verifyAndFinalizeUpload(filePath) {
  const header = readFileHeader(filePath);
  const detected = sniff(header);

  if (!detected) {
    throw new Error('This doesn\'t look like a JPEG, PNG, HEIC, or PDF file - it was rejected for safety.');
  }

  let finalType = detected;

  if (detected === 'heic') {
    let converted;
    try {
      const original = fs.readFileSync(filePath);
      converted = await convertHeic({ buffer: original, format: 'JPEG', quality: 0.9 });
    } catch (err) {
      throw new Error('This HEIC photo could not be converted - try re-exporting it as JPEG from your phone and uploading that instead.');
    }
    fs.writeFileSync(filePath, converted);
    finalType = 'jpeg';
  }

  const finalPath = filePath.replace(/\.upload$/, EXT_FOR_TYPE[finalType]);
  fs.renameSync(filePath, finalPath);
  return { type: finalType, filePath: finalPath, filename: path.basename(finalPath) };
}

// Phone photos often carry an EXIF "orientation" tag rather than storing
// pixels right-side-up; most viewers respect it, but pdf-lib (used for the
// export feature) draws raw pixel data and ignores it, so receipts could
// come out sideways/upside-down in the exported PDF. Baking the rotation
// into the actual pixels once at upload time fixes that everywhere (the
// "View file" link and the PDF export) instead of just one of them.
//
// This also happens to be where EXIF/metadata gets stripped: sharp only
// keeps a source image's metadata (EXIF, GPS location tags, etc.) if
// .withMetadata() is called, which this never does - so re-encoding through
// sharp here doubles as scrubbing anything a phone silently embedded in the
// original photo, for every image that passes through this function.
async function normalizeImageOrientation(filePath) {
  if (!sharp) return; // sharp unavailable in this environment — skip, not fatal
  const rotated = await sharp(filePath).rotate().toBuffer();
  fs.writeFileSync(filePath, rotated);
}

// Egg: a 1-in-20 chance of a different empty-state line instead of the
// standard one, when the inbox happens to be empty.
const RARE_EMPTY_STATE_MESSAGE = 'Nothing here. Somewhere, a filing cabinet weeps with joy.';

function renderInbox(req, res, extra) {
  const receipts = models.listUnassignedReceiptsForUser(req.user.id);
  const emptyStateMessage = Math.random() < 0.05 ? RARE_EMPTY_STATE_MESSAGE : 'Nothing in your inbox right now.';
  res.render('inbox', { receipts, error: null, success: null, emptyStateMessage, ...extra });
}

router.get('/', (req, res) => {
  const success = req.query.saved ? 'Saved — the receipt is in your inbox.' : null;
  renderInbox(req, res, { success });
});

// Upload one or more receipts at once: save each and create its row
// immediately (so the browser isn't stuck waiting), then send the user
// straight to filling in its details - there's no more OCR to guess the
// date/total, so that's the very next thing they need to do anyway. A
// single upload goes straight to that receipt's edit page; more than one
// chains through them via ?queue= (see the /:id/edit handlers below). The
// field name stays "receipt" (singular) even though the input now accepts
// multiple files — multer collects them all into req.files either way.
router.post('/scan', (req, res) => {
  upload.array('receipt', 20)(req, res, async (err) => {
    if (err) {
      return renderInbox(req, res, { error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return renderInbox(req, res, { error: 'Please choose at least one receipt file.' });
    }

    // Files that fail the real content check (see verifyAndFinalizeUpload)
    // are deleted and skipped rather than aborting the whole batch — the
    // rest of a multi-file upload should still go through, with a clear
    // message about which one(s) got rejected and why.
    const rejections = [];
    const uploadedForEmail = [];
    const createdIds = [];

    for (const file of req.files) {
      const uploadedPath = path.join(userUploadDir(req.user.id), file.filename);

      let verified;
      try {
        verified = await verifyAndFinalizeUpload(uploadedPath);
      } catch (verifyErr) {
        rejections.push(`${file.originalname}: ${verifyErr.message}`);
        fs.unlink(uploadedPath, () => {});
        continue;
      }

      const isImage = verified.type === 'jpeg' || verified.type === 'png';

      if (isImage) {
        try {
          await normalizeImageOrientation(verified.filePath);
        } catch (orientErr) {
          console.error('Failed to normalize image orientation:', orientErr.message);
          // Non-fatal — keep going with the file as originally uploaded.
        }
      }

      const receipt = models.createReceipt({
        user_id: req.user.id,
        filename: verified.filename,
        original_name: file.originalname,
        receipt_date: null,
        total: 0,
        project_name: '',
        gl_code: '',
        notes: '',
      });

      models.logActivity(req.user.id, 'receipt_upload', file.originalname);

      uploadedForEmail.push({ originalname: file.originalname, path: verified.filePath });
      createdIds.push(receipt.id);
    }

    // Fire-and-forget, same as everything else in this handler that doesn't
    // need to hold up the response — email sending happens at upload time,
    // not after some later background step.
    if (uploadedForEmail.length) {
      mailer.sendReceiptConfirmation(req.user, uploadedForEmail);
    }

    if (rejections.length) {
      return renderInbox(req, res, {
        error: `${rejections.length} file(s) couldn't be uploaded: ${rejections.join(' | ')}`,
      });
    }

    // No OCR to guess the date/total anymore, so every new receipt needs
    // them filled in by hand right away — send the user straight there
    // instead of back to the inbox. One receipt edits directly; more than
    // one chains through each in turn via ?queue= (see /:id/edit below).
    const [firstId, ...restIds] = createdIds;
    if (restIds.length === 0) {
      return res.redirect(`/receipts/${firstId}/edit`);
    }
    res.redirect(`/receipts/${firstId}/edit?queue=${restIds.join(',')}&total=${createdIds.length}`);
  });
});

router.get('/:id/file', (req, res) => {
  const receipt = models.getReceiptById(Number(req.params.id));
  if (!receipt || receipt.user_id !== req.user.id) {
    return res.status(404).render('error', { message: 'Receipt not found.' });
  }
  const filePath = path.join(userUploadDir(req.user.id), receipt.filename);

  // Content-Type is derived from the file's own (already-verified-at-upload)
  // extension via a fixed lookup, never guessed from the original upload's
  // claimed mimetype. X-Content-Type-Options blocks browsers from
  // second-guessing that and sniffing the body as something else (e.g.
  // HTML), which is the main defense against a stored-XSS-via-receipt-file
  // attack. Content-Disposition explicitly sets a safe filename so a
  // maliciously crafted original_name can't inject extra header directives.
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPE_FOR_TYPE[ext === '.jpg' ? 'jpeg' : ext.slice(1)] || 'application/octet-stream';
  const safeName = (receipt.original_name || 'receipt').replace(/[^\w.\- ]/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.sendFile(filePath);
});

function canEditReceipt(receipt) {
  if (!receipt.report_id) return true;
  const report = models.getReportById(receipt.report_id);
  return !report || report.status === 'draft';
}

router.get('/:id/edit', (req, res) => {
  const receipt = models.getReceiptById(Number(req.params.id));
  if (!receipt || receipt.user_id !== req.user.id) {
    return res.status(404).render('error', { message: 'Receipt not found.' });
  }
  if (!canEditReceipt(receipt)) {
    return res.status(400).render('error', { message: 'This receipt belongs to a submitted report and can no longer be edited. Reopen the report first.' });
  }
  // ?queue= carries the ids still waiting after this one, right after a
  // multi-file upload (see /scan above); ?total= is the fixed size of that
  // whole batch, used only to show "Receipt 2 of 4" - it doesn't shrink as
  // the queue does, so it rides along as its own param instead.
  const queue = (req.query.queue || '').trim();
  const queueTotal = Number(req.query.total) || 0;
  const queuePosition = queueTotal > 0 ? queueTotal - (queue ? queue.split(',').length : 0) : 0;
  res.render('receipt-edit', {
    receipt,
    error: null,
    returnTo: req.query.from === 'report' ? 'report' : 'inbox',
    expenseCategories: EXPENSE_CATEGORIES,
    queue,
    queuePosition,
    queueTotal,
  });
});

router.post('/:id/edit', (req, res) => {
  const receipt = models.getReceiptById(Number(req.params.id));
  if (!receipt || receipt.user_id !== req.user.id) {
    return res.status(404).render('error', { message: 'Receipt not found.' });
  }
  if (!canEditReceipt(receipt)) {
    return res.status(400).render('error', { message: 'This receipt belongs to a submitted report and can no longer be edited. Reopen the report first.' });
  }

  const { receipt_date, total, project_name, gl_code, notes, description, expense_category, queue, queue_total: queueTotal } = req.body;
  const parsedTotal = parseFloat(total);
  if (Number.isNaN(parsedTotal) || parsedTotal < 0) {
    const remaining = (queue || '').split(',').filter(Boolean);
    return res.status(400).render('receipt-edit', {
      receipt,
      error: 'Please enter a valid total amount.',
      returnTo: req.body.return_to === 'report' ? 'report' : 'inbox',
      expenseCategories: EXPENSE_CATEGORIES,
      queue: queue || '',
      queueTotal: Number(queueTotal) || 0,
      queuePosition: Number(queueTotal) > 0 ? Number(queueTotal) - remaining.length : 0,
    });
  }

  models.updateReceipt({
    id: receipt.id,
    receipt_date: receipt_date || null,
    total: parsedTotal,
    project_name: (project_name || '').trim(),
    gl_code: (gl_code || '').trim(),
    notes: (notes || '').trim(),
    description: (description || '').trim(),
    expense_category: EXPENSE_CATEGORY_KEYS.includes(expense_category) ? expense_category : DEFAULT_EXPENSE_CATEGORY,
  });

  // Mid-upload queue: move on to the next freshly-uploaded receipt instead
  // of leaving the app once this one's done.
  const remainingIds = (queue || '').split(',').filter(Boolean);
  if (remainingIds.length > 0) {
    const [nextId, ...restIds] = remainingIds;
    return res.redirect(`/receipts/${nextId}/edit?queue=${restIds.join(',')}&total=${queueTotal || remainingIds.length + 1}`);
  }

  if (req.body.return_to === 'report' && receipt.report_id) {
    return res.redirect(`/reports/${receipt.report_id}`);
  }
  // queueTotal is always some string here (the hidden field renders "0" for
  // an ordinary edit that was never part of an upload queue) - a numeric
  // check is needed so only the tail end of a real multi-file queue shows
  // the "Saved" banner, not every everyday edit.
  res.redirect(Number(queueTotal) > 0 ? '/receipts?saved=1' : '/receipts');
});

// Permanently delete a receipt. Only allowed while it's unassigned, or
// assigned to a report that's still a draft (submitted reports are locked).
router.post('/:id/delete', (req, res) => {
  const receipt = models.getReceiptById(Number(req.params.id));
  if (!receipt || receipt.user_id !== req.user.id) {
    return res.status(404).render('error', { message: 'Receipt not found.' });
  }
  if (!canEditReceipt(receipt)) {
    return res.status(400).render('error', { message: 'This receipt belongs to a submitted report and can no longer be deleted. Reopen the report first.' });
  }
  const filePath = path.join(userUploadDir(req.user.id), receipt.filename);
  models.deleteReceipt(receipt.id);
  fs.unlink(filePath, () => {});
  res.redirect(req.headers.referer && req.headers.referer.includes('/reports/') ? req.headers.referer : '/receipts');
});

module.exports = { router, userUploadDir, ALLOWED_MIME };
