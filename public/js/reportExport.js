// Export buttons (PDF/Excel) normally just navigate to a download URL, which
// gives no feedback while the server builds the file (LibreOffice rendering
// the PDF export can take several seconds). Instead, fetch the file as a
// blob so the loading overlay stays up for the exact duration of the
// request, then trigger the save via a synthetic link - same end result for
// the user, with real visual feedback in between. Falls back to a normal
// navigation if fetch fails for any reason (still an <a href>, never a
// dead end) - except when the user cancelled it themselves (Escape), where
// falling back to a download would defeat the cancel.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.js-export-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var url = btn.getAttribute('href');
      var controller = new AbortController();
      var cancelled = false;

      showLoadingOverlay('Preparing your export… (press Esc to cancel)', function () {
        cancelled = true;
        controller.abort();
      });

      fetch(url, { signal: controller.signal })
        .then(function (resp) {
          if (!resp.ok) throw new Error('Export failed');
          var disposition = resp.headers.get('Content-Disposition') || '';
          var match = disposition.match(/filename="([^"]+)"/);
          var filename = match ? match[1] : 'export';
          return resp.blob().then(function (blob) {
            return { blob: blob, filename: filename };
          });
        })
        .then(function (result) {
          var blobUrl = URL.createObjectURL(result.blob);
          var link = document.createElement('a');
          link.href = blobUrl;
          link.download = result.filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
        })
        .catch(function () {
          if (!cancelled) window.location.href = url; // fall back to a normal download
        })
        .finally(function () {
          if (!cancelled) hideLoadingOverlay();
        });
    });
  });
});
