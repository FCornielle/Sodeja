/**
 * Print-oriented CSS for the report document (render.ts embeds this as an
 * inline `<style>` tag before handing the HTML to Playwright). Deliberately
 * plain — no external stylesheet, no web font, no CDN asset: Playwright
 * renders offline, and a missing external resource would either hang or
 * silently degrade the PDF (`page.setContent`'s `waitUntil: "load"` would
 * wait on it).
 */
export const REPORT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Arial, sans-serif;
    color: #1a1a1a;
    font-size: 11px;
    line-height: 1.45;
    margin: 0;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 12px 0 4px; }
  p { margin: 4px 0; }
  .banner {
    background: #1a1a1a;
    color: #fff;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: bold;
    text-align: center;
    margin-bottom: 12px;
  }
  .disclaimer-block {
    border: 2px solid #1a1a1a;
    padding: 10px 12px;
    margin-bottom: 16px;
    background: #f7f7f5;
  }
  .disclaimer-block h2 { border: none; margin-top: 0; }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; }
  .meta-table td { padding: 2px 6px 2px 0; vertical-align: top; }
  .meta-table td.label { color: #555; white-space: nowrap; width: 1%; }
  table.data { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 10px; }
  table.data th, table.data td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
  table.data th { background: #eee; }
  .missing { color: #7a5a00; background: #fff6e0; border: 1px solid #e0c66b; padding: 6px 8px; font-size: 10px; }
  .provenance { font-size: 9px; color: #555; text-transform: uppercase; }
  .range { white-space: nowrap; }
  .section { page-break-inside: avoid; }
  .citation { font-size: 9px; color: #555; }
  .footer-note { font-size: 9px; color: #777; margin-top: 20px; border-top: 1px solid #ccc; padding-top: 6px; }
`;
