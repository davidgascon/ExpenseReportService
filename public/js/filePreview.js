// Turns "View file" links into an in-page preview instead of a new tab:
// clicking one slides a panel in from the right half of the window showing
// the receipt, and shrinks the main page to the left half (see the
// body.file-preview-active rule in style.css) so both are visible at once
// without overlapping. Images render as an <img> (fit-to-panel, not
// full-resolution/"zoomed in" the way an iframe would show them); PDFs still
// use an <iframe>, which renders them fine at a sane zoom by default. Falls
// back to the link's normal target="_blank" behavior if JS fails for any
// reason, since the href/target attributes are left in place.
(function () {
  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = 'filePreviewPanel';
    panel.className = 'file-preview-panel';
    panel.innerHTML =
      '<div class="file-preview-header">' +
        '<span class="file-preview-title"></span>' +
        '<span>' +
          '<a class="file-preview-newtab" target="_blank" rel="noopener">Open in new tab</a>' +
          '<button type="button" class="file-preview-close" aria-label="Close preview">&times;</button>' +
        '</span>' +
      '</div>' +
      '<div class="file-preview-body"></div>';
    document.body.appendChild(panel);

    panel.querySelector('.file-preview-close').addEventListener('click', closePanel);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });

    return panel;
  }

  function getPanel() {
    return document.getElementById('filePreviewPanel') || buildPanel();
  }

  function openPanel(url, title, fileType) {
    var panel = getPanel();
    panel.querySelector('.file-preview-title').textContent = title || 'Receipt';
    panel.querySelector('.file-preview-newtab').setAttribute('href', url);

    var body = panel.querySelector('.file-preview-body');
    body.innerHTML = '';
    if (fileType === 'image') {
      var img = document.createElement('img');
      img.className = 'file-preview-image';
      img.src = url;
      img.alt = title || 'Receipt';
      body.appendChild(img);
    } else {
      var iframe = document.createElement('iframe');
      iframe.className = 'file-preview-frame';
      iframe.title = 'Receipt preview';
      iframe.src = url;
      body.appendChild(iframe);
    }

    panel.classList.add('open');
    document.body.classList.add('file-preview-active');
  }

  function closePanel() {
    var panel = document.getElementById('filePreviewPanel');
    if (!panel) return;
    panel.classList.remove('open');
    document.body.classList.remove('file-preview-active');
    // Clear the preview content once the slide-out finishes so a PDF/image
    // isn't still loading silently in the background.
    setTimeout(function () {
      if (!panel.classList.contains('open')) {
        panel.querySelector('.file-preview-body').innerHTML = '';
      }
    }, 250);
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('.js-view-file') : null;
    if (!link) return;
    e.preventDefault();
    openPanel(link.getAttribute('href'), link.getAttribute('data-file-name'), link.getAttribute('data-file-type'));
  });
})();
