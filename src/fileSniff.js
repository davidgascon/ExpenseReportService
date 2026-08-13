// Verifies what an uploaded file actually IS, by inspecting its real bytes
// ("magic numbers") — never trusting the filename extension or the
// Content-Type/mimetype the browser claims, both of which are just labels
// the uploader supplies and can be wrong (a differently-named phone export)
// or deliberately spoofed (someone renaming an .html file to
// "receipt.jpg" to try to get it served back as if it were an image).
//
// Every uploaded file gets sniffed with this module right after multer
// writes it to disk, BEFORE its receipt row is created. The result is the
// only thing trusted for: (a) whether to accept the file at all, (b) what
// extension it's stored under, and (c) what Content-Type it's served back
// with later — see routes/receipts.js.

// HEIC/HEIF is a "ftyp" ISO-BMFF container, same family as MP4/MOV — the
// distinguishing part is the 4-byte "brand" at offset 8. This is the format
// modern iPhones save Camera Roll photos in by default (Settings > Camera >
// Formats > "High Efficiency"), so without this check every fresh iPhone
// photo would fail to upload at all, or get misdetected.
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // PDFs must start with "%PDF-", though a handful of real-world PDFs (some
  // scanner/printer output) prepend a few bytes of junk before it — scan a
  // small window rather than requiring byte 0 exactly.
  const head = buffer.slice(0, 1024).toString('latin1');
  if (head.includes('%PDF-')) {
    return 'pdf';
  }

  if (buffer.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('latin1').trim().toLowerCase();
    if (HEIC_BRANDS.has(brand)) return 'heic';
  }

  return null;
}

// Canonical extension for each sniffed type, used to name the file on disk
// regardless of whatever extension the original upload had.
const EXT_FOR_TYPE = { jpeg: '.jpg', png: '.png', pdf: '.pdf', heic: '.heic' };

// Content-Type for serving the file back — see GET /receipts/:id/file.
const CONTENT_TYPE_FOR_TYPE = { jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

module.exports = { sniff, EXT_FOR_TYPE, CONTENT_TYPE_FOR_TYPE };
