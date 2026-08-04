import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const iteratorKey = Symbol.asyncIterator;
const removedIterator = Reflect.deleteProperty(ReadableStream.prototype, iteratorKey);
if (!removedIterator || typeof ReadableStream.prototype[iteratorKey] === 'function') {
  throw new Error('Unable to simulate WebKit without ReadableStream async iteration.');
}

await import('../src/pdfjs-compat.ts?compat-smoke');
if (typeof ReadableStream.prototype[iteratorKey] !== 'function') {
  throw new Error('The PDF.js compatibility shim did not install a stream iterator.');
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
);

const pdfPath = resolve(
  process.env.PDF_COMPAT_FILE ?? new URL('../public/demo/quiet-reader-demo.pdf', import.meta.url).pathname,
);
const requestedPage = Number(process.env.PDF_COMPAT_PAGE ?? 1);
const pdfData = Uint8Array.from(await readFile(pdfPath));
const loadingTask = pdfjs.getDocument({
  data: pdfData,
  standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
});
const document = await loadingTask.promise;

try {
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > document.numPages) {
    throw new Error(`Requested page ${requestedPage} is outside this ${document.numPages}-page PDF.`);
  }
  const textContent = await (await document.getPage(requestedPage)).getTextContent();
  const extractedText = textContent.items
    .map((item) => 'str' in item && typeof item.str === 'string' ? item.str : '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!textContent.items.length || !extractedText) {
    throw new Error(`PDF page ${requestedPage} returned no selectable text.`);
  }
  console.log(
    `PDF compatibility check passed: page ${requestedPage}, ${textContent.items.length} text items.`,
  );
} finally {
  await loadingTask.destroy();
}
