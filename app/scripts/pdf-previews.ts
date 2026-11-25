import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type Args = {
  pdfPath: string;
  outDir: string;
  prefix: string;
};

function parseArgs(argv: string[]): Args {
  const pdfPath = argv[2];
  if (!pdfPath) throw new Error("Usage: tsx scripts/pdf-previews.ts <pdfPath> [outDir] [prefix]");
  return {
    pdfPath,
    outDir: argv[3] ?? "/opt/cursor/artifacts",
    prefix: argv[4] ?? "preview",
  };
}

async function main() {
  const { pdfPath, outDir, prefix } = parseArgs(process.argv);
  await mkdir(outDir, { recursive: true });
  const playwright = await import("playwright");

  const browser = await playwright.chromium.launch({
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--allow-file-access-from-files",
      "--disable-web-security",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1120, height: 840 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    const bytes = await readFile(resolve(pdfPath));
    const dataUrl = `data:application/pdf;base64,${bytes.toString("base64")}`;
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>html,body{margin:0;padding:0;} iframe{width:100vw;height:100vh;border:0;}</style></head>
        <body><iframe src="${dataUrl}" title="PDF preview"></iframe></body></html>`,
      { waitUntil: "load" },
    );

    // The built-in PDF viewer is an internal extension; give it a moment to render pages.
    await page.waitForTimeout(1200);

    // Try to make the full page height include all pages (viewer renders a long scroller).
    const full = join(outDir, `${prefix}-full.png`);
    await page.screenshot({ path: full, fullPage: true });

    // Also capture a couple representative viewport shots after scrolling.
    const view1 = join(outDir, `${prefix}-top.png`);
    await page.screenshot({ path: view1, fullPage: false });

    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(300);
    const view2 = join(outDir, `${prefix}-mid.png`);
    await page.screenshot({ path: view2, fullPage: false });

    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(300);
    const view3 = join(outDir, `${prefix}-lower.png`);
    await page.screenshot({ path: view3, fullPage: false });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, pdfPath, outDir, files: [full, view1, view2, view3] }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

