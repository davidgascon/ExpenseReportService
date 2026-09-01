// Shared full-screen "please wait" overlay, used by the upload flow
// (scan.js) and report exports (reportExport.js) - one definition so both
// look and behave identically.
//
// onCancel is optional: if given, pressing Escape while this overlay is
// showing calls it (letting the caller e.g. abort an in-flight fetch) and
// hides the overlay. Without it, Escape does nothing - the upload flow's
// overlay wraps a real form submission that can't be aborted from here, so
// showing an Escape hint there would be a broken promise.
var _loadingOverlayEscapeHandler = null;

function showLoadingOverlay(message, onCancel) {
  hideLoadingOverlay(); // never stack two of these
  var overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.id = 'loadingOverlay';
  overlay.innerHTML = '<div class="loading-box"><span class="spinner spinner-lg" aria-hidden="true"></span><p>' + message + '</p></div>';
  document.body.appendChild(overlay);

  if (onCancel) {
    _loadingOverlayEscapeHandler = function (e) {
      if (e.key === 'Escape') {
        onCancel();
        hideLoadingOverlay();
      }
    };
    document.addEventListener('keydown', _loadingOverlayEscapeHandler);
  }
}

function hideLoadingOverlay() {
  var overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.remove();
  if (_loadingOverlayEscapeHandler) {
    document.removeEventListener('keydown', _loadingOverlayEscapeHandler);
    _loadingOverlayEscapeHandler = null;
  }
}
