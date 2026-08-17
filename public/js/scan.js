function showLoadingOverlay(message) {
  var overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = '<div class="loading-box"><span class="spinner spinner-lg" aria-hidden="true"></span><p>' + message + '</p></div>';
  document.body.appendChild(overlay);
}

document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('scanForm');
  var fileInput = document.getElementById('receipt');
  var chooseBtn = document.getElementById('chooseFilesBtn');

  if (form) {
    form.addEventListener('submit', function () {
      if (chooseBtn) {
        chooseBtn.disabled = true;
        chooseBtn.textContent = 'Uploading…';
      }
      showLoadingOverlay('Uploading receipt and starting the scan…');
    });
  }

  // The visible "Choose Files" button just opens the native file picker
  // (the real <input type=file> is visually hidden - native file inputs
  // can't be restyled consistently across browsers, so a real button
  // triggering it gives one clean, on-brand control instead).
  if (chooseBtn && fileInput) {
    chooseBtn.addEventListener('click', function () {
      fileInput.click();
    });
  }

  // Picking file(s) is already the deliberate action here (there's nothing
  // else to fill in first) - submit right away instead of requiring a
  // separate click on a submit button. requestSubmit() (not submit())
  // still fires the 'submit' listener above, so the loading overlay and
  // native required-field validation both still run.
  if (fileInput && form) {
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files.length > 0) {
        if (form.requestSubmit) {
          form.requestSubmit();
        } else {
          form.submit();
        }
      }
    });
  }

  // If something in the inbox is still being scanned, quietly refresh the
  // page every 10s so it flips from "Scanning…" to real data without the
  // user having to hit refresh themselves.
  var table = document.getElementById('receiptTable');
  if (table && table.getAttribute('data-has-pending') === 'true') {
    setTimeout(function () {
      window.location.reload();
    }, 10000);
  }
});
