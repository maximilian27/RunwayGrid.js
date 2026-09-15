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
 * consistent across every page of the site. The `data-theme` attribute itself is already applied
 * synchronously by the blocking inline script in the <head> (before this module even loads), so
 * the `applyTheme(currentTheme())` call here is just a no-op safety net, not what avoids flicker.
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

/**
 * A tiny, dependency-free syntax highlighter used to give the "Code" tab (and the static
 * snippets on the landing page) an IDE-like look. It's a single regex-based tokenizer, not a
 * real parser, so it favors "looks right for this codebase's HTML + JS" over full correctness.
 * @param {string} source
 * @returns {string} HTML-safe markup with `<span class="cm-*">` wrapped tokens.
 */
const CODE_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'new', 'this', 'class', 'extends',
  'import', 'from', 'as', 'export', 'default', 'for', 'while', 'of', 'in', 'typeof', 'await',
  'async', 'static', 'get', 'set', 'try', 'catch', 'finally', 'throw', 'null', 'true', 'false',
  'undefined', 'break', 'continue', 'switch', 'case', 'do', 'instanceof', 'void', 'delete', 'yield',
  'super',
]);

const CODE_TOKEN_RE = /(?<comment><!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(?<string>`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(?<tagopen><\/?[A-Za-z][\w-]*)|(?<tagclose>\/?>)|(?<word>[A-Za-z_$][\w$-]*)|(?<number>\b\d+(?:\.\d+)?\b)/g;

function wrapToken(cls, text) {
  const escaped = escapeHtml(text);
  if (!cls) return escaped;
  // Split multi-line tokens (block comments, template literals) per physical line so every
  // `<span>` opens and closes within the same line - safe to split the highlighted result on
  // "\n" afterwards (e.g. to add a line-number gutter) without ever cutting a tag in half.
  return escaped.split('\n').map((line) => `<span class="${cls}">${line}</span>`).join('\n');
}

export function highlightCode(source) {
  let result = '';
  let lastIndex = 0;
  let inTag = false;

  for (const match of source.matchAll(CODE_TOKEN_RE)) {
    const start = match.index;
    if (start > lastIndex) {
      result += escapeHtml(source.slice(lastIndex, start));
    }

    const groups = match.groups;
    const text = match[0];
    let cls = null;

    if (groups.comment !== undefined) {
      cls = 'cm-comment';
    } else if (groups.string !== undefined) {
      cls = 'cm-string';
    } else if (groups.tagopen !== undefined) {
      cls = 'cm-tag';
      inTag = true;
    } else if (groups.tagclose !== undefined) {
      if (inTag) {
        cls = 'cm-tag';
        inTag = false;
      }
    } else if (groups.word !== undefined) {
      if (CODE_KEYWORDS.has(text)) {
        cls = 'cm-keyword';
      } else if (inTag && /^\s*=/.test(source.slice(start + text.length))) {
        // An identifier immediately followed by "=" while inside a tag is an attribute name
        // (e.g. `row-size=`), as opposed to a JS assignment target outside of a tag.
        cls = 'cm-attr';
      }
    } else if (groups.number !== undefined) {
      cls = 'cm-number';
    }

    result += wrapToken(cls, text);
    lastIndex = start + text.length;
  }

  if (lastIndex < source.length) {
    result += escapeHtml(source.slice(lastIndex));
  }
  return result;
}

/**
 * Strips the common leading indentation shared by every non-blank line, so markup/script pulled
 * out of a more deeply-nested DOM position (e.g. inside `.tab-panel`) doesn't render over-indented.
 * @param {string} text
 * @returns {string}
 */
function dedent(text) {
  const lines = text.replace(/^[ \t]*\n/, '').replace(/\s+$/, '').split('\n');
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    minIndent = Math.min(minIndent, line.match(/^[ \t]*/)[0].length);
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;
  return lines.map((line) => line.slice(minIndent)).join('\n');
}

/**
 * The example's script source, registered by `registerExampleScript()` - see there for why this
 * can't just be read back out of a `<script>` element in the DOM.
 * @type {string | null}
 */
let exampleScriptSource = null;

/**
 * Called by each example page with the *raw, unbundled* text of its own script file (imported
 * via Vite's `?raw` suffix), so the Code tab can display genuine source. This indirection exists
 * because the live inline/external `<script type="module">` in the DOM is not a reliable source
 * of truth: Vite always extracts and bundles `type="module"` scripts referenced from an HTML
 * entry (inlining becomes a hashed, minified chunk in `vite build`, and a `?html-proxy` module in
 * `vite dev`) - so reading `scriptEl.textContent` at runtime returns empty/transformed content,
 * not the authored source.
 * @param {string} source
 */
export function registerExampleScript(source) {
  exampleScriptSource = source;
}

/**
 * Builds the "source" shown in an example's Code tab: the live preview markup (the actual
 * `<runway-grid>` + controls currently in the DOM, so it never drifts from what's really
 * rendered) followed by the example's own script, as registered via `registerExampleScript()`.
 * @param {Element} tabsEl
 * @returns {string}
 */
function buildExampleSource(tabsEl) {
  const previewPanel = tabsEl.querySelector('.tab-panel[data-tab="preview"]');

  const parts = [];
  if (previewPanel) {
    parts.push(dedent(previewPanel.innerHTML));
  }
  if (exampleScriptSource) {
    parts.push(`<script type="module">\n${dedent(exampleScriptSource)}\n</script>`);
  }
  return parts.join('\n\n');
}

/**
 * Renders (once, lazily - on first switch to the Code tab) a line-numbered, syntax-highlighted
 * view of `buildExampleSource()` into the tab's `.code-block`.
 * @param {Element} tabsEl
 */
function renderCodeTab(tabsEl) {
  const codeBlock = tabsEl.querySelector('.code-block');
  if (!codeBlock || codeBlock.dataset.rendered === 'true') return;

  const highlighted = highlightCode(buildExampleSource(tabsEl));
  codeBlock.innerHTML = highlighted.split('\n').map((line, i) => (
      `<span class="code-line"><span class="code-line-num">${i + 1}</span>` +
      `<span class="code-line-content">${line.length ? line : ' '}</span></span>`
  )).join('\n');
  codeBlock.dataset.rendered = 'true';
}

/**
 * Wires up every `.example-tabs` block on the page: switching between the "Preview" and "Code"
 * tab buttons, lazily rendering the Code tab's content on first view, and a "Copy" button that
 * copies the plain-text source to the clipboard.
 */
export function initCodeTabs() {
  document.querySelectorAll('.example-tabs').forEach((tabsEl) => {
    const buttons = Array.from(tabsEl.querySelectorAll(':scope > .tab-bar > .tab-btn'));
    const panels = Array.from(tabsEl.querySelectorAll(':scope > .tab-panel'));

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.tab === btn.dataset.tab));

        if (btn.dataset.tab === 'code') {
          renderCodeTab(tabsEl);
        }
      });
    });

    const copyBtn = tabsEl.querySelector('.copy-btn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', () => {
      const codeBlock = tabsEl.querySelector('.code-block');
      if (!codeBlock || !navigator.clipboard) return;
      navigator.clipboard.writeText(codeBlock.textContent).then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = original; }, 1200);
      }).catch(() => { /* clipboard access denied - nothing sensible to do here */ });
    });
  });
}

/**
 * Syntax-highlights every static `<pre><code>` snippet on the page (e.g. the landing page's
 * install/usage/styling examples) that isn't already handled by `initCodeTabs()`.
 */
export function initStaticCodeBlocks() {
  document.querySelectorAll('pre > code:not(.code-block)').forEach((codeEl) => {
    if (codeEl.dataset.rendered === 'true') return;
    codeEl.innerHTML = highlightCode(codeEl.textContent);
    codeEl.dataset.rendered = 'true';
  });
}

initThemeToggle();
highlightActiveNavLink();
initCodeTabs();
initStaticCodeBlocks();
