// Legacy build: Node-compatible. pdfjs-dist 4 ships only ES modules, so it is
// loaded with a real dynamic import (TypeScript would turn `import()` into
// `require()` under CommonJS). Loaded lazily so the API boots fast.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PdfJs>;
let pdfjs: Promise<PdfJs> | undefined;

function load(): Promise<PdfJs> {
  pdfjs ??= importEsm('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

const MAX_PAGES = 10;

/**
 * Extracts text with pdf.js. Eval is disabled (no font program compilation), so
 * a hostile PDF cannot execute code through the font path; fonts are not loaded.
 */
export async function pdfjsText(buffer: Buffer): Promise<string> {
  const lib = await load();
  const document = await lib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  try {
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(document.numPages, MAX_PAGES); number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      pages.push(text);
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    await document.destroy();
  }
}
