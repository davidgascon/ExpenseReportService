document.addEventListener('DOMContentLoaded', function () {
  var projectSelect = document.getElementById('project_id');
  var newProjectFields = document.getElementById('newProjectFields');
  var newProjectNumber = document.getElementById('new_project_number');
  var glCode = document.getElementById('gl_code');

  function updateNewProjectFieldsVisibility() {
    if (!newProjectFields) return;
    newProjectFields.classList.toggle('visible', projectSelect.value === 'new');
  }

  function fillDefaultGlCode(number) {
    if (number && glCode) {
      glCode.value = number + '-000-95-90';
    }
  }

  if (projectSelect) {
    projectSelect.addEventListener('change', function () {
      updateNewProjectFieldsVisibility();

      // Auto-fill the GL code from the selected project's number - a
      // default the person can still freely overwrite afterward. Only
      // fires for a real project selection, not "No project" (and "Add a
      // new project…" is handled below instead, once its number is typed).
      var option = projectSelect.options[projectSelect.selectedIndex];
      fillDefaultGlCode(option && option.getAttribute('data-number'));
    });
    updateNewProjectFieldsVisibility();
  }

  // Same auto-fill, but for a brand-new project being added inline - there's
  // no <option data-number> to read yet, just whatever's typed so far.
  if (newProjectNumber) {
    newProjectNumber.addEventListener('input', function () {
      fillDefaultGlCode(newProjectNumber.value.trim());
    });
  }

  var glInfoBtn = document.getElementById('glInfoBtn');
  var glInfoBox = document.getElementById('glInfoBox');
  if (glInfoBtn && glInfoBox) {
    glInfoBtn.addEventListener('click', function () {
      glInfoBox.classList.toggle('visible');
    });
  }
});
