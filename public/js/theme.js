function applyThemeToggleLabel() {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  // Split into icon/label spans (rather than one textContent string) so
  // narrow screens can hide just the label via CSS and keep the icon -
  // see the theme-toggle-label mobile rule in style.css.
  var icon = btn.querySelector('.theme-toggle-icon');
  var label = btn.querySelector('.theme-toggle-label');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  if (label) label.textContent = isDark ? ' Light' : ' Dark';
}

function toggleTheme() {
  var html = document.documentElement;
  var isDark = html.getAttribute('data-theme') === 'dark';
  try {
    if (isDark) {
      html.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      html.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }
  } catch (e) { /* localStorage unavailable */ }
  applyThemeToggleLabel();
}

document.addEventListener('DOMContentLoaded', applyThemeToggleLabel);
