document.addEventListener('DOMContentLoaded', function () {
  var projectSelect = document.getElementById('project_id');
  var newProjectFields = document.getElementById('newProjectFields');
  var glCode = document.getElementById('gl_code');

  function updateNewProjectFieldsVisibility() {
    if (!newProjectFields) return;
    newProjectFields.classList.toggle('visible', projectSelect.value === 'new');
  }

  if (projectSelect) {
    projectSelect.addEventListener('change', function () {
      updateNewProjectFieldsVisibility();

      // Auto-fill the GL code from the selected project's number - a
      // default the person can still freely overwrite afterward. Only
      // fires for a real project selection, not "No project" or "Add a
      // new project…" (a brand-new project's number isn't known yet).
      var option = projectSelect.options[projectSelect.selectedIndex];
      var number = option && option.getAttribute('data-number');
      if (number && glCode) {
        glCode.value = number + '-000-95-90';
      }
    });
    updateNewProjectFieldsVisibility();
  }

  var glInfoBtn = document.getElementById('glInfoBtn');
  var glInfoBox = document.getElementById('glInfoBox');
  if (glInfoBtn && glInfoBox) {
    glInfoBtn.addEventListener('click', function () {
      glInfoBox.classList.toggle('visible');
    });
  }
});
