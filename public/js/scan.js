function showLoadingOverlay(message) {
  var overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = '<div class="loading-box"><span class="spinner spinner-lg" aria-hidden="true"></span><p>' + message + '</p></div>';
  document.body.appendChild(overlay);
}

document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('scanForm');
  var submitBtn = document.getElementById('scanSubmitBtn');
  if (form) {
    form.addEventListener('submit', function () {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading…';
      }
      showLoadingOverlay('Uploading receipt and starting the scan…');
    });
  }

  // Picking file(s) is already the deliberate action here (there's nothing
  // else to fill in first) — submit right away instead of making the user
  // also click "Scan Receipt(s)" as a separate step. Clicking the button
  // programmatically (rather than form.submit()) keeps the browser's native
  // required-field validation and the submit listener above both in play.
  var fileInput = document.getElementById('receipt');
  if (fileInput && submitBtn) {
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files.length > 0) {
        submitBtn.click();
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
