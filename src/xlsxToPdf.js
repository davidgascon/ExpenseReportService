const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Converts a filled-out .xlsx to PDF by shelling out to LibreOffice's
// headless mode (bundled in the Docker image via the libreoffice-calc
// package). There's no pure-JS way to render a real spreadsheet — with its
// actual cell styling, borders, and print layout — to a pixel/vector-
// accurate PDF; LibreOffice headless is the standard, fully-offline way to
// do this on a server.
//
// Each call gets its own throwaway profile directory
// (-env:UserInstallation) because concurrent `soffice` invocations sharing
// the default profile can collide on a lock file and fail outright — this
// keeps concurrent exports from different users safe.
async function convertXlsxBufferToPdf(xlsxBuffer) {
  const workDir = path.join(os.tmpdir(), `xlsx2pdf-${crypto.randomBytes(8).toString('hex')}`);
  const profileDir = path.join(workDir, 'profile');
  const inputPath = path.join(workDir, 'input.xlsx');
  const outputPath = path.join(workDir, 'input.pdf');

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(inputPath, xlsxBuffer);

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('soffice', [
        '--headless',
        '--norestore',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to', 'pdf',
        '--outdir', workDir,
        inputPath,
      ]);

      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Converting the spreadsheet to PDF timed out after 60 seconds.'));
      }, 60_000);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Could not start LibreOffice for the spreadsheet-to-PDF conversion: ${err.message}`));
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`LibreOffice exited with code ${code} while converting the spreadsheet to PDF. ${stderr.trim()}`));
          return;
        }
        resolve();
      });
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('LibreOffice reported success but no PDF was produced.');
    }
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { convertXlsxBufferToPdf };
