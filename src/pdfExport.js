const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { compressForExport } = require('./imageCompress');

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const GRAY = rgb(0.35, 0.35, 0.35);
const LIGHT_GRAY = rgb(0.75, 0.75, 0.75);

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// Word-wrap text to a max width, returning an array of lines.
function wrapText(text, font, size, maxWidth) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function newPage(pdfDoc) {
  return pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
}

// Returns an array — a multi-page PDF receipt yields one embed per page
// (previously only page 0 was ever embedded, silently dropping the rest of
// the pages), while an image receipt always yields exactly one.
async function embedReceiptFile(pdfDoc, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const bytes = fs.readFileSync(filePath);
  if (ext === '.pdf') {
    const srcDoc = await PDFDocument.load(bytes);
    const embeddedPages = await pdfDoc.embedPdf(srcDoc, srcDoc.getPageIndices());
    return embeddedPages.map((embedded) => ({ kind: 'page', embedded, width: embedded.width, height: embedded.height }));
  }
  // Recompress before embedding - a report full of full-resolution phone
  // photos otherwise made for a huge PDF. This only affects the copy going
  // into this export; the original file on disk is untouched. Falls back
  // to embedding the original bytes unchanged if compression fails or
  // doesn't actually shrink this particular file - see imageCompress.js.
  const { buffer: compressedBytes, ext: compressedExt } = await compressForExport(bytes, ext);
  const image = compressedExt === '.png' ? await pdfDoc.embedPng(compressedBytes) : await pdfDoc.embedJpg(compressedBytes);
  return [{ kind: 'image', embedded: image, width: image.width, height: image.height }];
}

// Scales an embed to fit within the space above `bottomMargin` up to `topY`,
// centered horizontally, and draws it onto `page`.
function drawEmbedCentered(page, embed, topY, bottomMargin) {
  const availableWidth = PAGE_WIDTH - MARGIN * 2;
  const availableHeight = topY - bottomMargin;
  const scale = Math.min(availableWidth / embed.width, availableHeight / embed.height, 1);
  const w = embed.width * scale;
  const h = embed.height * scale;
  const x = MARGIN + (availableWidth - w) / 2;
  const y = topY - h;
  if (embed.kind === 'page') {
    page.drawPage(embed.embedded, { x, y, width: w, height: h });
  } else {
    page.drawImage(embed.embedded, { x, y, width: w, height: h });
  }
}

/**
 * Builds a PDF for a report: the filled-out MMFS spreadsheet (rendered to
 * PDF) first, followed by one page per receipt showing its details plus the
 * original image/PDF. Per explicit request, this replaced an earlier
 * custom-drawn summary page — the spreadsheet itself is now the summary.
 * @param {object} report - the report row
 * @param {object[]} receipts - receipts belonging to the report
 * @param {(userId: number) => string} uploadDirFor - resolves a user's upload directory
 * @param {Buffer} excelPdfBytes - the filled MMFS spreadsheet, already rendered to PDF
 * @returns {Promise<Uint8Array>}
 */
async function buildReportPdf(report, receipts, uploadDirFor, excelPdfBytes) {
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // ---------- Spreadsheet page(s) ----------
  const excelDoc = await PDFDocument.load(excelPdfBytes);
  const excelPageIndices = excelDoc.getPageIndices();
  const embeddedExcelPages = await pdfDoc.embedPdf(excelDoc, excelPageIndices);
  embeddedExcelPages.forEach((embeddedPage) => {
    const p = pdfDoc.addPage([embeddedPage.width, embeddedPage.height]);
    p.drawPage(embeddedPage);
  });

  // ---------- One page per receipt ----------
  for (const r of receipts) {
    const rPage = newPage(pdfDoc);
    let hy = PAGE_HEIGHT - MARGIN;

    rPage.drawText(report.name, { x: MARGIN, y: hy, size: 12, font: bold, color: GRAY });
    hy -= 20;
    // Per explicit request, the receipt's date is intentionally left off
    // this page - it's already shown per-row on the spreadsheet page above,
    // so repeating it here was redundant.
    rPage.drawText(money(r.total), { x: MARGIN, y: hy, size: 14, font: bold });
    hy -= 18;

    if (r.notes) {
      for (const line of wrapText(`Notes: ${r.notes}`, regular, 10, PAGE_WIDTH - MARGIN * 2)) {
        rPage.drawText(line, { x: MARGIN, y: hy, size: 10, font: regular });
        hy -= 13;
      }
    }
    hy -= 12;

    try {
      const filePath = path.join(uploadDirFor(r.user_id), r.filename);
      const [firstEmbed, ...restEmbeds] = await embedReceiptFile(pdfDoc, filePath);
      drawEmbedCentered(rPage, firstEmbed, hy, MARGIN);

      // A multi-page PDF receipt gets one full page per additional page,
      // right after this receipt's own page - previously only the first
      // page of the source PDF was ever included in the export.
      for (const embed of restEmbeds) {
        const extraPage = newPage(pdfDoc);
        drawEmbedCentered(extraPage, embed, PAGE_HEIGHT - MARGIN, MARGIN);
      }
    } catch (e) {
      rPage.drawText('(Could not load the original receipt file)', { x: MARGIN, y: hy - 20, size: 10, font: regular, color: GRAY });
    }
  }

  return pdfDoc.save();
}

module.exports = { buildReportPdf };
