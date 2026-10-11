(() => {
  'use strict';

  const storageKey = 'ringtone-theme';
  const validPreference = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  let systemTheme;

  try {
    preference = validPreference(localStorage.getItem(storageKey));
  } catch {
    // Theme switching still works when browser storage is unavailable.
  }

  try {
    systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    // Older browsers default to light until the visitor chooses a theme.
  }

  function applyTheme() {
    const theme = preference === 'system' ? (systemTheme?.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === 'dark' ? '#141519' : '#f5f6f8';
    document.querySelectorAll('[data-theme-picker]').forEach(picker => {
      picker.value = preference;
    });
  }

  function bindPickers() {
    document.querySelectorAll('[data-theme-picker]').forEach(picker => {
      picker.addEventListener('change', () => {
        preference = validPreference(picker.value);
        try {
          localStorage.setItem(storageKey, preference);
        } catch {
          // Keep the selected theme for this page even without persistence.
        }
        applyTheme();
      });
    });
    applyTheme();
  }

  applyTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPickers, { once: true });
  } else {
    bindPickers();
  }

  const followSystem = () => {
    if (preference === 'system') applyTheme();
  };
  if (systemTheme?.addEventListener) systemTheme.addEventListener('change', followSystem);
  else if (systemTheme?.addListener) systemTheme.addListener(followSystem);

  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = validPreference(event.newValue);
    applyTheme();
  });
})();
