// Shared full-screen "please wait" overlay, used by the upload flow
// (scan.js) and report exports (reportExport.js) - one definition so both
// look and behave identically.
function showLoadingOverlay(message) {
  hideLoadingOverlay(); // never stack two of these
  var overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.id = 'loadingOverlay';
  overlay.innerHTML = '<div class="loading-box"><span class="spinner spinner-lg" aria-hidden="true"></span><p>' + message + '</p></div>';
  document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
  var overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.remove();
}
