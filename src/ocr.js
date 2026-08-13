const path = require('path');
const { createWorker } = require('tesseract.js');
const { DATA_DIR } = require('./config');

// The English language model ships as an npm dependency (@tesseract.js-data/eng)
// so OCR works fully offline and never depends on reaching a CDN at runtime.
const engData = require('@tesseract.js-data/eng');

let workerPromise = null;

// Lazily create a single shared Tesseract worker and reuse it across requests.
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      langPath: engData.langPath,
      gzip: engData.gzip,
      cachePath: path.join(DATA_DIR, 'tesseract-cache'),
    }).catch((err) => {
      workerPromise = null; // allow retry on next call
      throw err;
    });
  }
  return workerPromise;
}

async function extractText(imagePath) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagePath);
  return data.text || '';
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(year, month, day) {
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function guessDate(text) {
  // Numeric formats: 03/14/2026, 3-14-26, 2026-03-14
  const isoMatch = text.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const iso = toIsoDate(Number(y), Number(m), Number(d));
    if (iso) return iso;
  }

  const usMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    const iso = toIsoDate(Number(y), Number(m), Number(d));
    if (iso) return iso;
  }

  // Month-name formats: "March 14, 2026" or "Mar 14 2026"
  const monthNames = Object.keys(MONTHS).join('|');
  const nameRe = new RegExp(`\\b(${monthNames})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i');
  const nameMatch = text.match(nameRe);
  if (nameMatch) {
    const [, mon, d, y] = nameMatch;
    const month = MONTHS[mon.toLowerCase()];
    const iso = toIsoDate(Number(y), month, Number(d));
    if (iso) return iso;
  }

  return null;
}

function guessTotal(text) {
  const lines = text.split(/\r?\n/);
  const priorityKeywords = [/grand\s*total/i, /total\s*due/i, /amount\s*due/i, /balance\s*due/i, /\btotal\b/i];
  const moneyRe = /\$?\s?(\d{1,5}(?:,\d{3})*\.\d{2})/;

  for (const keywordRe of priorityKeywords) {
    for (const line of lines) {
      if (keywordRe.test(line) && !/sub\s*total/i.test(line)) {
        const m = line.match(moneyRe);
        if (m) return parseFloat(m[1].replace(/,/g, ''));
      }
    }
  }

  // Fallback: largest dollar-looking amount anywhere in the text.
  const all = [...text.matchAll(new RegExp(moneyRe, 'g'))].map((m) => parseFloat(m[1].replace(/,/g, '')));
  if (all.length) return Math.max(...all);
  return null;
}

async function scanReceipt(imagePath) {
  const text = await extractText(imagePath);
  return {
    rawText: text,
    suggestedDate: guessDate(text),
    suggestedTotal: guessTotal(text),
  };
}

async function shutdown() {
  if (workerPromise) {
    const worker = await workerPromise.catch(() => null);
    if (worker) await worker.terminate();
  }
}

module.exports = { scanReceipt, shutdown };
