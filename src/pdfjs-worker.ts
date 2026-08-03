import './pdfjs-compat';

// A dynamic import ensures the compatibility shim runs before PDF.js starts.
void import('pdfjs-dist/build/pdf.worker.min.mjs');
