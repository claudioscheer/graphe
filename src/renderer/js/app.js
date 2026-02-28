/**
 * app.js — Entry point, initializes theme, settings, pane manager, navigation
 */

/** Settings dialog — theme + language controls */
const Settings = (() => {
  const html = document.documentElement;
  const overlay = document.getElementById('settings-overlay');
  const themeToggle = document.getElementById('settings-theme-toggle');
  const themeLabel = document.getElementById('settings-theme-label');
  const langSelect = document.getElementById('settings-lang-select');
  const closeBtn = document.getElementById('settings-close');

  function isDark() {
    return html.classList.contains('dark');
  }

  function applyTheme(dark) {
    if (dark) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    updateThemeLabel();
  }

  function updateThemeLabel() {
    themeLabel.setAttribute('data-i18n', isDark() ? 'dark' : 'light');
    themeLabel.textContent = I18n.t(isDark() ? 'dark' : 'light');
  }

  function open() {
    langSelect.value = I18n.getCurrentLang();
    updateThemeLabel();
    overlay.classList.remove('hidden');
  }

  function close() {
    overlay.classList.add('hidden');
  }

  // Theme toggle
  themeToggle.addEventListener('click', () => {
    const dark = html.classList.toggle('dark');
    localStorage.setItem('graphe-theme', dark ? 'dark' : 'light');
    updateThemeLabel();
  });

  // Language change
  langSelect.addEventListener('change', () => {
    I18n.setLang(langSelect.value);
    PaneManager.render();
    // Update dialog's own labels
    updateThemeLabel();
  });

  // Close button + backdrop click
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Load saved theme
  const saved = localStorage.getItem('graphe-theme');
  if (saved) {
    applyTheme(saved === 'dark');
  } else {
    applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  return { open, close };
})();

// Expose on window so other modules can call Settings.open()
window.Settings = Settings;

// Listen for settings open from native menu
window.api.onOpenSettings(() => Settings.open());

(async function () {
  // ---- Language ----
  I18n.updateAll();

  // ---- Init ----
  const modules = await window.api.getModules();

  if (modules.length === 0) {
    document.getElementById('pane-root').innerHTML =
      '<div class="flex items-center justify-center h-full text-gray-500 text-lg">' +
      I18n.t('noModules') + '</div>';
    return;
  }

  Navigation.init();
  PaneManager.init(modules);
})();
