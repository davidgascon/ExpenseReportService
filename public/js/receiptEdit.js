document.addEventListener('DOMContentLoaded', function () {
  var projectSelect = document.getElementById('project_id');
  var newProjectFields = document.getElementById('newProjectFields');
  var newProjectNumber = document.getElementById('new_project_number');
  var newProjectGlCode = document.getElementById('new_project_gl_code');
  var glCode = document.getElementById('gl_code');

  function updateNewProjectFieldsVisibility() {
    if (!newProjectFields) return;
    newProjectFields.classList.toggle('visible', projectSelect.value === 'new');
  }

  // `override`, when given, is used verbatim (a direct GL code shortcut that
  // isn't a real project number - see the project's own gl_code_override).
  // Otherwise falls back to the usual "<number>-000-95-90" derived default.
  function fillDefaultGlCode(number, override) {
    if (override && glCode) {
      glCode.value = override;
    } else if (number && glCode) {
      glCode.value = number + '-000-95-90';
    }
  }

  if (projectSelect) {
    projectSelect.addEventListener('change', function () {
      updateNewProjectFieldsVisibility();

      // Auto-fill the GL code from the selected project's number - a
      // default the person can still freely overwrite afterward. Only
      // fires for a real project selection, not "No project" (and "Add a
      // new entry…" is handled below instead, once its fields are typed).
      var option = projectSelect.options[projectSelect.selectedIndex];
      fillDefaultGlCode(option && option.getAttribute('data-number'), option && option.getAttribute('data-gl-override'));
    });
    updateNewProjectFieldsVisibility();
  }

  // Same auto-fill, but for a brand-new project/GL-code entry being added
  // inline - there's no <option data-number> to read yet, just whatever's
  // typed so far in either field. The explicit GL code override field always
  // wins when it has a value, regardless of which field was just edited.
  if (newProjectNumber || newProjectGlCode) {
    var recomputeNewEntryGlCode = function () {
      var override = newProjectGlCode ? newProjectGlCode.value.trim() : '';
      var number = newProjectNumber ? newProjectNumber.value.trim() : '';
      fillDefaultGlCode(number, override);
    };
    if (newProjectNumber) newProjectNumber.addEventListener('input', recomputeNewEntryGlCode);
    if (newProjectGlCode) newProjectGlCode.addEventListener('input', recomputeNewEntryGlCode);
  }

  var glInfoBtn = document.getElementById('glInfoBtn');
  var glInfoBox = document.getElementById('glInfoBox');
  if (glInfoBtn && glInfoBox) {
    glInfoBtn.addEventListener('click', function () {
      glInfoBox.classList.toggle('visible');
    });
  }
});
