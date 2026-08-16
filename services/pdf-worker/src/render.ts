import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { createLogger } from "@sodeja/observability";
import { REPORT_CSS } from "./styles.js";
import { ReportDocument } from "./template.js";
import type { ReportRenderInput } from "./types.js";

const logger = createLogger("pdf-worker:render");

/**
 * Races `fn` against a timer, same shape as `packages/providers/src/
 * resilience.ts`'s `withTimeout` (a bare `await` on Chromium would
 * reintroduce the exact hang class that helper exists to prevent) — but
 * implemented locally rather than imported: `withTimeout` is typed around
 * `ProviderError`/adapter names for THIRD-PARTY network providers
 * (map/POI/geocoding), and a local Chromium subprocess is not that kind of
 * dependency. Same defensive principle, applied where it is actually needed.
 */
async function withTimeout<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtmlDocument(input: ReportRenderInput): string {
  const body = renderToStaticMarkup(createElement(ReportDocument, { input }));
  return (
    `<!doctype html><html lang="es-DO"><head><meta charset="utf-8" />` +
    `<title>Resumen de análisis — ${escapeHtml(input.project.name)}</title>` +
    `<style>${REPORT_CSS}</style></head><body>${body}</body></html>`
  );
}

/**
 * A repeating footer, printed on EVERY page by Playwright's own
 * `displayHeaderFooter`/`footerTemplate` mechanism (Chromium's print
 * pipeline, not app CSS) — this is the "watermark on every export"
 * requirement (services/pdf-worker/README.md "Mandatory content on every
 * export"; risk L7). A CSS `position: fixed` element does not reliably
 * repeat across printed pages in Chromium's headless print-to-PDF, so this
 * is the correct mechanism, not a simplification.
 */
const WATERMARK_FOOTER_TEMPLATE =
  '<div style="font-size:8px;width:100%;text-align:center;color:#888;padding:0 10mm;">' +
  "SODEJA — RESUMEN DE ANÁLISIS, NO ES PLAN DE NEGOCIO — Página " +
  '<span class="pageNumber"></span> de <span class="totalPages"></span></div>';

/**
 * Renders `input` to a PDF buffer: React SSR (`renderToStaticMarkup`, no
 * Next.js server needed — services/pdf-worker/README.md) to a static HTML
 * string, then a headless Chromium instance (Playwright) prints it. Never
 * queries a database; `input` must already contain everything to render
 * (types.ts's `ReportRenderInput` doc comment).
 */
export async function renderReportPdf(input: ReportRenderInput): Promise<Buffer> {
  const html = buildHtmlDocument(input);
  const timeoutMs = Number(process.env.REPORT_RENDER_TIMEOUT_MS ?? 30_000);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await withTimeout("pdf-worker setContent", timeoutMs, () => page.setContent(html, { waitUntil: "load" }));
    const pdfBuffer = await withTimeout("pdf-worker page.pdf", timeoutMs, () =>
      page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: WATERMARK_FOOTER_TEMPLATE,
        margin: { top: "15mm", bottom: "20mm", left: "15mm", right: "15mm" },
      }),
    );
    return pdfBuffer;
  } finally {
    await browser.close().catch((error: unknown) => {
      logger.warn({ err: error }, "failed to close chromium cleanly after rendering a report");
    });
  }
}
