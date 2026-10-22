import { PDFDocument } from 'pdf-lib';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsP: Promise<PdfJs> | null = null;
// pdfjs-dist is ESM only. tsx/vitest handle import() natively; the bundled CJS build runs on Node 22 (require of ESM).
function pdfjs(): Promise<PdfJs> {
  pdfjsP ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsP;
}

/** Extract per-page text (text layer only). Used by the mock LLM and for injection scanning. */
export async function pdfPages(buf: Buffer): Promise<string[]> {
  const lib = await pdfjs();
  const data = new Uint8Array(buf.length);
  data.set(buf);
  const doc = await lib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      let lastY: number | undefined;
      let text = '';
      for (const it of tc.items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform?.[5];
        if (lastY !== undefined && y !== undefined && Math.abs(lastY - y) > 2) text += '\n';
        text += it.str;
        if (y !== undefined) lastY = y;
      }
      pages.push(text);
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

export async function pdfPageCount(buf: Buffer): Promise<number> {
  const d = await PDFDocument.load(buf, { ignoreEncryption: true });
  return d.getPageCount();
}

/** Copy a page range (1-based, inclusive) into a new PDF. */
export async function extractPages(buf: Buffer, start: number, end: number): Promise<Buffer> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}
