import './pdfjs-compat';

// A dynamic import ensures the compatibility shim runs before the Safari-safe
// PDF.js worker bundle starts.
void import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
