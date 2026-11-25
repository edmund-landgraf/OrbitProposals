import { escapeHtml } from "./escape.js";

type PdfRenderOptions = {
  html: string;
  title: string;
  headerText?: string;
  footerText?: string;
};

export class PdfRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfRenderError";
  }
}

/** Footer shown on every page: optional text on the left, "Page N of M" on the right, aligned to the page margins. */
export function pdfFooterTemplate(footerText?: string): string {
  return `<div style="width:100%; padding:0 56px; box-sizing:border-box; font-family:ui-sans-serif, system-ui, sans-serif; font-size:9px; color:#5f6968; -webkit-print-color-adjust:exact;">`
    + `<div style="border-top:1px solid #d6cdc0; padding-top:6px; display:flex; justify-content:space-between; align-items:baseline;">`
    + `<span>${escapeHtml(footerText ?? "")}</span>`
    + `<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>`
    + `</div></div>`;
}

export async function renderPdf({ html, title, headerText, footerText }: PdfRenderOptions): Promise<Buffer> {
  let playwright: typeof import("playwright") | null = null;
  try {
    playwright = await import("playwright");
  } catch {
    playwright = null;
  }
  if (!playwright) throw new PdfRenderError("PDF rendering is unavailable because Playwright is not installed.");

  const browser = await playwright.chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    // Chromium prints its own title/URL header unless displayHeaderFooter is set with explicit templates,
    // so the header is always an empty element and the footer carries "Prepared by …" left and "Page N of M" right.
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerText ? `<div style="font-size:9px; color:#5f6968; width:100%; padding:0 56px;">${escapeHtml(headerText)}</div>` : "<div></div>",
      footerTemplate: pdfFooterTemplate(footerText),
      margin: { top: "56px", bottom: "64px", left: "56px", right: "56px" },
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
    });
    await context.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

