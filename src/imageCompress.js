// Recompresses a receipt image before it's embedded into an exported PDF,
// so a report full of full-resolution phone photos doesn't produce a huge
// PDF. This never touches the original stored file - only the copy of the
// bytes that goes into the export - so "View file," OCR, and re-exporting
// later all still work from the untouched original.
//
// Two implementations, tried in this order:
//   1. sharp, when it's available - faster and higher quality per byte.
//   2. A pure-JS fallback (jpeg-js + pngjs, both pure JS/no native binary)
//      that decodes to raw pixels, downsamples with a box filter, and
//      re-encodes as JPEG. This exists specifically because sharp's native
//      binary is already known NOT to load on David's actual deployment
//      (see the build notes' "sharp won't load" incident) - without a
//      fallback that doesn't depend on a native addon, this feature would
//      silently do nothing on the one machine it's meant to help.
//
// Either path can fail for a given image (a corrupt file, an unsupported
// variant) - any failure just means the original bytes are embedded
// unchanged, exactly like before this feature existed. A compression bug
// should never be able to break an export.

let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  sharp = null; // handled the same way as everywhere else sharp is used
}
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

// Long-edge cap and JPEG quality chosen for "clearly smaller, but still
// looks good printed or viewed on screen" - a receipt is a photo of text
// and totals, not something that needs to be pixel-perfect at full phone-
// camera resolution (often 12MP+) once it's embedded on a letter-size PDF
// page days or months later.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 80;

async function compressWithSharp(buffer) {
  const resized = sharp(buffer).rotate().resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: 'inside',
    withoutEnlargement: true,
  });
  return resized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

// Box-filter downsample of a raw RGBA buffer - averages every source pixel
// that falls inside each destination pixel's footprint, rather than just
// picking one (nearest-neighbor), which would look noticeably worse on a
// photo being shrunk this much.
function downsampleRGBA(src, srcW, srcH, dstW, dstH) {
  if (dstW >= srcW && dstH >= srcH) return { data: src, width: srcW, height: srcH };
  const dst = Buffer.alloc(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor(dy * yRatio);
    const sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.floor((dy + 1) * yRatio)));
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * xRatio);
      const sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.floor((dx + 1) * xRatio)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const idx = (sy * srcW + sx) * 4;
          r += src[idx];
          g += src[idx + 1];
          b += src[idx + 2];
          a += src[idx + 3];
          count++;
        }
      }
      const dstIdx = (dy * dstW + dx) * 4;
      dst[dstIdx] = Math.round(r / count);
      dst[dstIdx + 1] = Math.round(g / count);
      dst[dstIdx + 2] = Math.round(b / count);
      dst[dstIdx + 3] = Math.round(a / count);
    }
  }
  return { data: dst, width: dstW, height: dstH };
}

function scaledDimensions(width, height, maxDimension) {
  if (width <= maxDimension && height <= maxDimension) return { width, height };
  const scale = maxDimension / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function compressWithPureJs(buffer, ext) {
  const raw = ext === '.png' ? PNG.sync.read(buffer) : jpeg.decode(buffer, { useTArray: true });
  const { width: dstW, height: dstH } = scaledDimensions(raw.width, raw.height, MAX_DIMENSION);
  const { data } = downsampleRGBA(raw.data, raw.width, raw.height, dstW, dstH);
  const encoded = jpeg.encode({ data, width: dstW, height: dstH }, JPEG_QUALITY);
  return Buffer.from(encoded.data);
}

// Returns { buffer, ext }. ext is always '.jpg' when compression actually
// ran and helped; otherwise the original buffer/ext are returned
// unchanged (compression made it bigger, or failed outright).
async function compressForExport(buffer, ext) {
  const normalizedExt = (ext || '').toLowerCase();
  if (normalizedExt !== '.jpg' && normalizedExt !== '.jpeg' && normalizedExt !== '.png') {
    return { buffer, ext: normalizedExt }; // not an image type this handles (e.g. .pdf) - leave alone
  }

  let compressed = null;
  try {
    compressed = sharp ? await compressWithSharp(buffer) : await compressWithPureJs(buffer, normalizedExt);
  } catch (err) {
    console.error('Image compression for export failed, embedding original file instead:', err.message);
    return { buffer, ext: normalizedExt };
  }

  if (!compressed || compressed.length >= buffer.length) {
    // Compression didn't actually help (already small/well-compressed, or
    // the encode overhead outweighed the savings on a tiny image) - embed
    // the original rather than swap in a same-size-or-bigger file.
    return { buffer, ext: normalizedExt };
  }
  return { buffer: compressed, ext: '.jpg' };
}

module.exports = { compressForExport };
