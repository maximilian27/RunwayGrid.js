// Shared helpers used across the demo/doc site pages.

/**
 * Escapes HTML special characters so a string can be safely interpolated into an
 * `innerHTML`-based template without risking XSS, no matter where the value came from.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

const THEME_STORAGE_KEY = 'runway-grid-demo-theme';

/**
 * Applies a manual theme override on top of the system (`prefers-color-scheme`) default that
 * `assets/theme.css` already applies on its own. Passing `'system'` clears the override.
 * @param {'system' | 'light' | 'dark'} theme
 */
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function currentTheme() {
  return /** @type {'system' | 'light' | 'dark'} */ (localStorage.getItem(THEME_STORAGE_KEY) || 'system');
}

function nextTheme(theme) {
  // Cycle: system (follows OS) -> light -> dark -> system -> ...
  if (theme === 'system') return 'light';
  if (theme === 'light') return 'dark';
  return 'system';
}

function themeLabel(theme) {
  if (theme === 'light') return '\u2600\ufe0f Light';
  if (theme === 'dark') return '\ud83c\udf19 Dark';
  return '\ud83d\udda5\ufe0f System';
}

/**
 * Wires up the `.theme-toggle` button (if present on the page) to cycle between following the
 * system color scheme and forcing light/dark, persisting the choice in localStorage so it's
 * consistent across every page of the site.
 */
export function initThemeToggle() {
  applyTheme(currentTheme());

  const button = document.querySelector('.theme-toggle');
  if (!button) return;

  const render = () => {
    button.textContent = themeLabel(currentTheme());
  };
  render();

  button.addEventListener('click', () => {
    const theme = nextTheme(currentTheme());
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyTheme(theme);
    render();
  });
}

/**
 * Marks the nav link matching the current page's filename as `.active`, so the shared header
 * (duplicated on every page) highlights where you are.
 */
export function highlightActiveNavLink() {
  const currentPath = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.site-nav a').forEach((link) => {
    const linkPath = link.getAttribute('href').split('/').pop();
    if (linkPath === currentPath) {
      link.classList.add('active');
    }
  });
}

initThemeToggle();
highlightActiveNavLink();
