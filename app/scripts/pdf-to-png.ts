import { mkdir, writeFile, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

type Args = {
  pdfPath: string;
  outDir: string;
  maxPages: number;
  scale: number;
};

function parseArgs(argv: string[]): Args {
  const pdfPath = argv[2];
  if (!pdfPath) throw new Error("Usage: tsx scripts/pdf-to-png.ts <pdfPath> [outDir] [maxPages] [scale]");
  return {
    pdfPath,
    outDir: argv[3] ?? "/opt/cursor/artifacts",
    maxPages: Number(argv[4] ?? "12") || 12,
    scale: Number(argv[5] ?? "2") || 2,
  };
}

async function main() {
  const { pdfPath, outDir, maxPages, scale } = parseArgs(process.argv);
  await mkdir(outDir, { recursive: true });

  // pdfjs in node needs a few globals; @napi-rs/canvas supplies ImageData.
  (globalThis as unknown as { ImageData?: unknown }).ImageData = (await import("@napi-rs/canvas")).ImageData;

  const bytes = await readFile(resolve(pdfPath));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const count = Math.min(doc.numPages, maxPages);
  const base = basename(pdfPath).replace(/\\.pdf$/i, "");
  const written: string[] = [];

  for (let pageNum = 1; pageNum <= count; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx as never, viewport }).promise;
    const png = canvas.toBuffer("image/png");
    const outPath = join(outDir, `${base}-p${String(pageNum).padStart(2, "0")}.png`);
    await writeFile(outPath, png);
    written.push(outPath);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, pdfPath: resolve(pdfPath), outDir: resolve(outDir), pages: count, files: written }, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

