function showLoadingOverlay(message) {
  var overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = '<div class="loading-box"><span class="spinner spinner-lg" aria-hidden="true"></span><p>' + message + '</p></div>';
  document.body.appendChild(overlay);
}

document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('scanForm');
  if (form) {
    form.addEventListener('submit', function () {
      var btn = document.getElementById('scanSubmitBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Uploading…';
      }
      showLoadingOverlay('Uploading receipt and starting the scan…');
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
