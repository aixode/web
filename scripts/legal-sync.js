/*
 * Legal pages sync (runs on every Vercel build).
 * Fetches the Terms and Privacy Policy from Directus (main_setup.terms_content /
 * privacy_content) and writes them into terms.html and privacy.html between the
 * LEGAL:START / LEGAL:END markers. If Directus can't be reached or returns
 * something unexpected, the pages keep the text already in the repo.
 * Trigger: a Directus Flow calls the Vercel deploy hook when main_setup is saved.
 */
const fs = require('fs');
const path = require('path');

const API = 'https://directus-amh2dxcnfef2c4fc.norwayeast-01.azurewebsites.net/items/main_setup?fields=terms_content,privacy_content&limit=1';
const ROOT = path.join(__dirname, '..');
const PAGES = [
  { file: 'privacy.html', field: 'privacy_content' },
  { file: 'terms.html', field: 'terms_content' },
];

function clean(html) {
  // remove anything that could run code or embed other pages
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button)[\s\S]*?(<\/\1>|\/?>)/gi, '');
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
  html = html.replace(/\s(style|class|id)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  // match the website's markup
  html = html.replace(/<h3>/gi, '<h2>').replace(/<\/h3>/gi, '</h2>');
  html = html.replace(/<p>\s*<em>\s*(Last updated:[^<]*)<\/em>\s*<\/p>/i, '<p class="updated">$1</p>');
  html = html.replace(/<a href="https:\/\/www\.aixode\.com\/privacy#cookie-settings"[^>]*>Cookie settings<\/a>/gi,
    '<button type="button" class="cookie-link" data-open-cookies>Cookie settings</button>');
  html = html.replace(/href="https:\/\/(www\.)?aixode\.com\//gi, 'href="/');
  return html.trim();
}

async function load() {
  if (process.env.LEGAL_SYNC_FILE) return JSON.parse(fs.readFileSync(process.env.LEGAL_SYNC_FILE, 'utf8'));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    return Array.isArray(j.data) ? j.data[0] : j.data;
  } finally { clearTimeout(t); }
}

(async () => {
  let data;
  try { data = await load(); }
  catch (e) { console.log('[legal-sync] Directus not reachable (' + e.message + '). Keeping the text in the repo.'); return; }
  for (const { file, field } of PAGES) {
    const raw = data && data[field];
    if (typeof raw !== 'string' || raw.length < 300 || !/<h[23]/i.test(raw)) {
      console.log('[legal-sync] ' + field + ' missing or too short. Keeping ' + file + ' as is.');
      continue;
    }
    const p = path.join(ROOT, file);
    const page = fs.readFileSync(p, 'utf8');
    const a = page.indexOf('<!-- LEGAL:START -->'), b = page.indexOf('<!-- LEGAL:END -->');
    if (a < 0 || b < a) { console.log('[legal-sync] markers not found in ' + file); continue; }
    const out = page.slice(0, a) + '<!-- LEGAL:START -->\n' + clean(raw) + '\n      ' + page.slice(b);
    fs.writeFileSync(p, out);
    console.log('[legal-sync] updated ' + file + ' from Directus');
  }
})();
