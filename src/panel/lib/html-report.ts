import type { DevtoolsDump } from './dump';

/**
 * Builds a self-contained HTML file: the report viewer bundle (built next to the panel
 * as report/report.js + report.css) with the exported session inlined.
 */
export async function buildHtmlReport(dump: DevtoolsDump, title: string): Promise<string> {
  const base = new URL('../report/', location.href);
  const get = async (name: string) => {
    const r = await fetch(new URL(name, base));
    if (!r.ok) throw new Error('Report viewer not found (only available in the built extension)');
    return r.text();
  };
  const [js, css] = await Promise.all([get('report.js'), get('report.css')]);
  const json = JSON.stringify(dump).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title><style>${css}</style></head><body><div id="app"></div>`,
    `<script>window.__WRD_DUMP__=${json};</script>`,
    `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`,
    '</body></html>'
  ].join('');
}
