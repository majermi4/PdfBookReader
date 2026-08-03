import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { cacheDrivePdf, readCachedDrivePdf } from './drive-cache';
import {
  downloadGoogleDrivePdf,
  googleDriveConfig,
  isDriveFolder,
  isGoogleDriveConfigured,
  listFolderPdfs,
  pickGoogleDriveItems,
  requestGoogleDriveAccess,
  type DrivePickerItem,
} from './google-drive';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Book = {
  id: string;
  source: 'demo' | 'drive';
  title: string;
  subtitle: string;
  driveFileId?: string;
  pageCount?: number;
};

const demoBook: Book = {
  id: 'quiet-reader-demo',
  source: 'demo',
  subtitle: 'Quiet Reader · Demo PDF',
  title: 'A Short Guide to Quiet Reading',
  pageCount: 7,
};

const booksKey = 'quiet-reader:books';
const readingKey = (bookId: string, name: string) => `quiet-reader:${bookId}:${name}`;

type PageNote = {
  id: string;
  page: number;
  text: string;
  createdAt: number;
  selectedText?: string;
};

type ContentsItem = {
  title: string;
  page: number;
  level: number;
};

type PdfOutlineItem = {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineItem[];
};

type PdfSearchResult = {
  page: number;
  excerpt: string;
};

type HighlightBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function isExpectedPdfCancellation(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === 'RenderingCancelledException'
    || error.message.includes('Transport destroyed');
}

function readStoredPage(bookId: string, name: string, fallback: number) {
  const stored = Number(window.localStorage.getItem(readingKey(bookId, name)));
  return Number.isInteger(stored) && stored > 0 ? stored : fallback;
}

function bookmarkProgress(bookmark: number, pageCount?: number) {
  if (!pageCount) return 0;
  return Math.min(100, Math.max(0, (bookmark / pageCount) * 100));
}

function readStoredNotes(bookId: string): PageNote[] {
  try {
    const stored = window.localStorage.getItem(readingKey(bookId, 'notes'));
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((note): note is PageNote => (
      typeof note?.id === 'string'
      && Number.isInteger(note?.page)
      && typeof note?.text === 'string'
      && typeof note?.createdAt === 'number'
      && (note.selectedText === undefined || typeof note.selectedText === 'string')
    )) : [];
  } catch {
    return [];
  }
}

function readStoredBooks(): Book[] {
  try {
    const stored = window.localStorage.getItem(booksKey);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [demoBook];
    const driveBooks = parsed.filter((book): book is Book => (
      typeof book?.id === 'string'
      && book.source === 'drive'
      && typeof book.driveFileId === 'string'
      && typeof book.title === 'string'
      && typeof book.subtitle === 'string'
      && (book.pageCount === undefined || (Number.isInteger(book.pageCount) && book.pageCount > 0))
    ));
    return [demoBook, ...driveBooks];
  } catch {
    return [demoBook];
  }
}

async function resolveOutlinePage(document: pdfjs.PDFDocumentProxy, destination: string | unknown[] | null) {
  const resolvedDestination = typeof destination === 'string'
    ? await document.getDestination(destination)
    : destination;
  if (!Array.isArray(resolvedDestination) || !resolvedDestination[0]) return null;
  try {
    return (await document.getPageIndex(resolvedDestination[0] as never)) + 1;
  } catch {
    return null;
  }
}

async function buildContents(
  document: pdfjs.PDFDocumentProxy,
  outline: PdfOutlineItem[],
  level = 0,
): Promise<ContentsItem[]> {
  const contents: ContentsItem[] = [];
  for (const item of outline) {
    const page = await resolveOutlinePage(document, item.dest);
    if (page && item.title) contents.push({ title: item.title, page, level });
    if (item.items?.length) contents.push(...await buildContents(document, item.items, level + 1));
  }
  return contents;
}

async function searchPdfText(
  document: pdfjs.PDFDocumentProxy,
  query: string,
  onProgress: (page: number) => void,
  isCurrent: () => boolean,
): Promise<PdfSearchResult[]> {
  const normalizedQuery = query.toLowerCase();
  const results: PdfSearchResult[] = [];

  for (let page = 1; page <= document.numPages; page += 1) {
    if (!isCurrent()) return [];
    const textContent = await (await document.getPage(page)).getTextContent();
    const text = textContent.items
      .map((item) => 'str' in item && typeof item.str === 'string' ? item.str : '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const matchIndex = text.toLowerCase().indexOf(normalizedQuery);
    if (matchIndex >= 0) {
      const start = Math.max(0, matchIndex - 55);
      const end = Math.min(text.length, matchIndex + query.length + 115);
      results.push({
        page,
        excerpt: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
      });
    }
    if (page === 1 || page % 12 === 0 || page === document.numPages) onProgress(page);
    if (page % 8 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  return results;
}

function PdfPage({
  document,
  pageNumber,
  renderWidth,
  searchQuery,
  onRenderError,
  onTextSelected,
}: {
  document: pdfjs.PDFDocumentProxy;
  pageNumber: number;
  renderWidth?: number;
  searchQuery: string;
  onRenderError: (message: string) => void;
  onTextSelected: (page: number, text: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeTaskRef = useRef<pdfjs.RenderTask | null>(null);
  const renderVersionRef = useRef(0);
  const [highlights, setHighlights] = useState<HighlightBox[]>([]);
  const [textLayer, setTextLayer] = useState<Array<{ fontSize: number; left: number; text: string; top: number; transform: string }>>([]);

  const render = useCallback(async () => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const renderVersion = ++renderVersionRef.current;
    activeTaskRef.current?.cancel();

    try {
      const page = await document.getPage(pageNumber);
      if (renderVersion !== renderVersionRef.current) return;
      const naturalViewport = page.getViewport({ scale: 1 });
      const scale = renderWidth
        ? renderWidth / naturalViewport.width
        : Math.min(
            Math.max(stage.clientWidth - 32, 1) / naturalViewport.width,
            Math.max(stage.clientHeight - 32, 1) / naturalViewport.height,
          );
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas rendering is unavailable in this browser.');

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, viewport.width, viewport.height);

      const task = page.render({ canvas, canvasContext: context, viewport });
      activeTaskRef.current = task;
      await task.promise;
      if (renderVersion !== renderVersionRef.current) return;

      const textContent = await page.getTextContent();
      if (renderVersion !== renderVersionRef.current) return;
      setTextLayer(textContent.items.flatMap((item) => {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str) return [];
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const fontSize = Math.hypot(transform[2], transform[3]);
        return [{
          fontSize,
          left: transform[4],
          text: item.str,
          top: transform[5] - fontSize,
          transform: `rotate(${Math.atan2(transform[1], transform[0])}rad)`,
        }];
      }));

      const query = searchQuery.trim().toLowerCase();
      if (!query) {
        setHighlights([]);
        return;
      }

      const boxes: HighlightBox[] = [];
      for (const item of textContent.items) {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str) continue;
        const itemText = item.str.toLowerCase();
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const itemWidth = Math.abs(item.width * viewport.scale);
        const itemHeight = Math.hypot(transform[2], transform[3]);
        let index = itemText.indexOf(query);
        while (index >= 0) {
          boxes.push({
            left: transform[4] + (itemWidth * index) / item.str.length,
            top: transform[5] - itemHeight,
            width: Math.max(4, (itemWidth * query.length) / item.str.length),
            height: itemHeight,
          });
          index = itemText.indexOf(query, index + query.length);
        }
      }
      setHighlights(boxes);
    } catch (error) {
      if (renderVersion !== renderVersionRef.current || isExpectedPdfCancellation(error)) return;
      onRenderError(error instanceof Error ? error.message : 'Unable to render this PDF page.');
    }
  }, [document, onRenderError, pageNumber, renderWidth, searchQuery]);

  const captureTextSelection = () => {
    window.setTimeout(() => {
      const text = window.getSelection()?.toString().replace(/\s+/g, ' ').trim();
      if (text) onTextSelected(pageNumber, text);
    }, 0);
  };

  useEffect(() => {
    void render();
    if (renderWidth) {
      return () => activeTaskRef.current?.cancel();
    }
    const observer = new ResizeObserver(() => void render());
    if (stageRef.current) observer.observe(stageRef.current);
    return () => {
      observer.disconnect();
      activeTaskRef.current?.cancel();
    };
  }, [render, renderWidth]);

  return (
    <div
      className={renderWidth ? 'continuous-pdf-page' : 'pdf-stage'}
      data-pdf-page={pageNumber}
      ref={stageRef}
      style={renderWidth ? { width: `${renderWidth}px` } : undefined}
    >
      <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
      {highlights.length > 0 && (
        <div className="pdf-highlights" aria-hidden="true">
          {highlights.map((highlight, index) => (
            <span
              key={`${highlight.left}-${highlight.top}-${index}`}
              style={{
                height: `${highlight.height}px`,
                left: `${highlight.left}px`,
                top: `${highlight.top}px`,
                width: `${highlight.width}px`,
              }}
            />
          ))}
        </div>
      )}
      <div className="pdf-text-layer" onMouseUp={captureTextSelection} onTouchEnd={captureTextSelection}>
        {textLayer.map((item, index) => (
          <span
            key={`${index}-${item.left}-${item.top}`}
            style={{
              fontSize: `${item.fontSize}px`,
              left: `${item.left}px`,
              top: `${item.top}px`,
              transform: item.transform,
            }}
          >
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContinuousPdf({
  document,
  pageCount,
  initialPage,
  jumpRequest,
  scrollRequest,
  fullWidth,
  zoom,
  searchQuery,
  onPageChange,
  onReaderClick,
  onRenderError,
  onTextSelected,
}: {
  document: pdfjs.PDFDocumentProxy;
  pageCount: number;
  initialPage: number;
  jumpRequest: { id: number; page: number };
  scrollRequest: { id: number; direction: -1 | 1 };
  fullWidth: boolean;
  zoom: number;
  searchQuery: string;
  onPageChange: (page: number) => void;
  onReaderClick: () => void;
  onRenderError: (message: string) => void;
  onTextSelected: (page: number, text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const lastJumpIdRef = useRef(0);
  const lastScrollRequestIdRef = useRef(0);
  const pendingPageAlignmentRef = useRef<{ behavior: ScrollBehavior; page: number } | null>(null);
  const pageAlignmentTimersRef = useRef<number[]>([]);
  const lastReportedPageRef = useRef(initialPage);
  const currentPageRef = useRef(initialPage);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageAspect, setPageAspect] = useState(661.464 / 504);
  const [currentPage, setCurrentPage] = useState(initialPage);

  useEffect(() => {
    let active = true;
    document.getPage(1).then((firstPage) => {
      if (!active) return;
      const viewport = firstPage.getViewport({ scale: 1 });
      setPageAspect(viewport.height / viewport.width);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [document]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const usableWidth = Math.max(containerWidth - (fullWidth ? 0 : 24), 280);
  const baseWidth = fullWidth ? usableWidth : Math.min(usableWidth, 860);
  const pageWidth = Math.round(baseWidth * zoom);
  const pageHeight = pageWidth * pageAspect;
  const pageUnit = pageHeight + 14;
  const firstRendered = Math.max(1, currentPage - 3);
  const lastRendered = Math.min(pageCount, currentPage + 3);

  const clearPageAlignmentTimers = useCallback(() => {
    pageAlignmentTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    pageAlignmentTimersRef.current = [];
  }, []);

  const alignRenderedPage = useCallback((page: number, behavior: ScrollBehavior) => {
    const scroll = scrollRef.current;
    if (!scroll) return false;
    const renderedPage = scroll.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
    if (!renderedPage) return false;
    const top = scroll.scrollTop
      + renderedPage.getBoundingClientRect().top
      - scroll.getBoundingClientRect().top;
    scroll.scrollTo({ top, behavior });
    return true;
  }, []);

  const scrollToPage = useCallback((page: number, behavior: ScrollBehavior) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    clearPageAlignmentTimers();
    pendingPageAlignmentRef.current = { behavior, page };
    if (!alignRenderedPage(page, behavior)) {
      scroll.scrollTo({ top: Math.max(0, page - 1) * pageUnit, behavior });
    }
    [160, 520].forEach((delay) => {
      const timer = window.setTimeout(() => {
        const pending = pendingPageAlignmentRef.current;
        if (!pending || pending.page !== page) return;
        alignRenderedPage(page, 'auto');
        if (delay === 520) pendingPageAlignmentRef.current = null;
      }, delay);
      pageAlignmentTimersRef.current.push(timer);
    });
  }, [alignRenderedPage, clearPageAlignmentTimers, pageUnit]);

  useEffect(() => () => clearPageAlignmentTimers(), [clearPageAlignmentTimers]);

  useEffect(() => {
    if (!restoredRef.current && containerWidth) {
      restoredRef.current = true;
      scrollToPage(initialPage, 'auto');
    }
  }, [containerWidth, initialPage, scrollToPage]);

  useEffect(() => {
    if (!restoredRef.current || !containerWidth) return;
    scrollToPage(currentPageRef.current, 'auto');
  }, [containerWidth, pageUnit, scrollToPage]);

  useEffect(() => {
    if (!containerWidth || jumpRequest.id === 0 || jumpRequest.id === lastJumpIdRef.current) return;
    lastJumpIdRef.current = jumpRequest.id;
    scrollToPage(jumpRequest.page, 'smooth');
  }, [containerWidth, jumpRequest, scrollToPage]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || scrollRequest.id === 0 || scrollRequest.id === lastScrollRequestIdRef.current) return;
    lastScrollRequestIdRef.current = scrollRequest.id;
    scroll.scrollBy({
      top: scrollRequest.direction * Math.max(180, Math.round(scroll.clientHeight * .45)),
      behavior: 'smooth',
    });
  }, [scrollRequest]);

  const onScroll = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const visiblePage = Math.min(
      pageCount,
      Math.max(1, Math.floor((scroll.scrollTop + pageUnit * .35) / pageUnit) + 1),
    );
    if (visiblePage !== lastReportedPageRef.current) {
      lastReportedPageRef.current = visiblePage;
      currentPageRef.current = visiblePage;
      setCurrentPage(visiblePage);
      onPageChange(visiblePage);
    }
  };

  return (
    <div
      className="reader-scroll"
      ref={scrollRef}
      onClick={onReaderClick}
      onScroll={onScroll}
    >
      <div
        className="continuous-content"
        style={{ width: `${Math.max(containerWidth, pageWidth + (fullWidth ? 0 : 24))}px` }}
      >
        <div className="continuous-spacer" style={{ height: `${(firstRendered - 1) * pageUnit}px` }} />
        {Array.from({ length: lastRendered - firstRendered + 1 }, (_, index) => {
          const pageNumber = firstRendered + index;
          return (
            <PdfPage
              document={document}
              key={pageNumber}
              onRenderError={onRenderError}
              onTextSelected={onTextSelected}
              pageNumber={pageNumber}
              renderWidth={pageWidth}
              searchQuery={searchQuery}
            />
          );
        })}
        <div className="continuous-spacer" style={{ height: `${(pageCount - lastRendered) * pageUnit}px` }} />
      </div>
    </div>
  );
}

function Library({
  books,
  driveMessage,
  drivePending,
  loadingBookId,
  loadingProgress,
  onAddFromDrive,
  onOpen,
}: {
  books: Book[];
  driveMessage: string | null;
  drivePending: boolean;
  loadingBookId: string | null;
  loadingProgress: number | null;
  onAddFromDrive: () => void;
  onOpen: (book: Book) => void;
}) {
  return (
    <main className="library-page">
      <header className="library-header">
        <span className="app-name">Quiet Reader</span>
      </header>
      <section className="library-content" aria-labelledby="library-title">
        <h1 id="library-title">My books</h1>
        <p>Choose individual PDFs or a folder from Google Drive. The included demo is safe to explore.</p>
        <button className="drive-button" type="button" disabled={drivePending} onClick={onAddFromDrive}>
          {drivePending ? 'Opening Google Drive…' : 'Add from Google Drive'}
        </button>
        {driveMessage && <p className="drive-message" role="status">{driveMessage}</p>}
        <div className="book-list">
          {books.map((book) => {
            const bookmark = readStoredPage(book.id, 'bookmark', 1);
            const lastPage = readStoredPage(book.id, 'last-page', 1);
            const progress = bookmarkProgress(bookmark, book.pageCount);
            const isLoading = loadingBookId === book.id;
            return (
              <button className="book-row" key={book.id} type="button" disabled={drivePending && !isLoading} onClick={() => onOpen(book)}>
                {book.source === 'demo' ? (
                  <img className="book-cover" src={`${import.meta.env.BASE_URL}icons/quiet-reader-180.png`} alt="" />
                ) : (
                  <span className="book-cover book-cover-drive" aria-hidden="true">PDF</span>
                )}
                <span className="book-details">
                  <span className="book-title">{book.title}</span>
                  <span className="book-meta">{book.subtitle}</span>
                </span>
                <span className="book-progress">
                  {isLoading ? (
                    <>
                      <strong>Opening book{loadingProgress === null ? '…' : ` · ${loadingProgress}%`}</strong>
                      <span className="book-loading-copy">Preparing your PDF</span>
                      <span className={`book-progress-meter${loadingProgress === null ? ' is-loading' : ''}`} aria-hidden="true">
                        <span style={{ width: loadingProgress === null ? undefined : `${loadingProgress}%` }} />
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>{book.pageCount ? `Main bookmark · ${bookmark} / ${book.pageCount}` : `Main bookmark · p. ${bookmark}`}</strong>
                      Last viewed · PDF page {lastPage}
                      <span className="book-progress-meter" aria-hidden="true">
                        <span style={{ width: `${progress}%` }} />
                      </span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<'library' | 'reader'>('library');
  const [books, setBooks] = useState<Book[]>(readStoredBooks);
  const [activeBook, setActiveBook] = useState<Book>(demoBook);
  const [drivePdfData, setDrivePdfData] = useState<Uint8Array | null>(null);
  const [driveMessage, setDriveMessage] = useState<string | null>(null);
  const [drivePending, setDrivePending] = useState(false);
  const [loadingBookId, setLoadingBookId] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(() => readStoredPage(demoBook.id, 'last-page', 1));
  const [bookmark, setBookmark] = useState(() => readStoredPage(demoBook.id, 'bookmark', 1));
  const [notes, setNotes] = useState<PageNote[]>(() => readStoredNotes(demoBook.id));
  const [controlsVisible, setControlsVisible] = useState(false);
  const [bookmarkMenuOpen, setBookmarkMenuOpen] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [contents, setContents] = useState<ContentsItem[]>([]);
  const [contentsReady, setContentsReady] = useState(false);
  const [tocSearchOpen, setTocSearchOpen] = useState(false);
  const [tocQuery, setTocQuery] = useState('');
  const [pdfSearchOpen, setPdfSearchOpen] = useState(false);
  const [pdfQuery, setPdfQuery] = useState('');
  const [pdfSearchResults, setPdfSearchResults] = useState<PdfSearchResult[]>([]);
  const [pdfSearching, setPdfSearching] = useState(false);
  const [pdfSearchProgress, setPdfSearchProgress] = useState(0);
  const pdfSearchJobRef = useRef(0);
  const [noteDraft, setNoteDraft] = useState('');
  const [selectedQuote, setSelectedQuote] = useState<{ page: number; text: string } | null>(null);
  const [fullWidth, setFullWidth] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [jumpRequest, setJumpRequest] = useState({ id: 0, page: 1 });
  const [scrollRequest, setScrollRequest] = useState<{ id: number; direction: -1 | 1 }>({ id: 0, direction: 1 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(booksKey, JSON.stringify(books.filter((book) => book.source === 'drive')));
  }, [books]);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    setPageCount(0);
    if (activeBook.source === 'drive' && !drivePdfData) return undefined;
    const task = activeBook.source === 'drive'
      ? pdfjs.getDocument({ data: drivePdfData! })
      : pdfjs.getDocument({ url: `${import.meta.env.BASE_URL}demo/quiet-reader-demo.pdf` });
    task.promise
      .then((loadedDocument) => {
        if (cancelled) return;
        setDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
        setBooks((current) => current.map((book) => (
          book.id === activeBook.id && book.pageCount !== loadedDocument.numPages
            ? { ...book, pageCount: loadedDocument.numPages }
            : book
        )));
        setPage((current) => Math.min(current, loadedDocument.numPages));
        setBookmark((current) => Math.min(current, loadedDocument.numPages));
      })
      .catch((loadError: unknown) => {
        if (!cancelled && !isExpectedPdfCancellation(loadError)) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to open this PDF.');
        }
      });

    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [activeBook, drivePdfData]);

  useEffect(() => {
    let cancelled = false;
    if (!document) return;
    setContentsReady(false);
    document.getOutline()
      .then((outline) => buildContents(document, (outline ?? []) as PdfOutlineItem[]))
      .then((items) => {
        if (!cancelled) {
          setContents(items);
          setContentsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContents([]);
          setContentsReady(true);
        }
      });
    return () => { cancelled = true; };
  }, [document]);

  useEffect(() => {
    const query = pdfQuery.trim();
    const job = ++pdfSearchJobRef.current;
    if (!document || query.length < 2) {
      setPdfSearching(false);
      setPdfSearchProgress(0);
      setPdfSearchResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setPdfSearching(true);
      setPdfSearchProgress(0);
      void searchPdfText(
        document,
        query,
        (progress) => {
          if (pdfSearchJobRef.current === job) setPdfSearchProgress(progress);
        },
        () => pdfSearchJobRef.current === job,
      ).then((results) => {
        if (pdfSearchJobRef.current === job) {
          setPdfSearchResults(results);
          setPdfSearching(false);
        }
      }).catch(() => {
        if (pdfSearchJobRef.current === job) {
          setPdfSearchResults([]);
          setPdfSearching(false);
        }
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [document, pdfQuery]);

  useEffect(() => {
    window.localStorage.setItem(readingKey(activeBook.id, 'last-page'), String(page));
  }, [activeBook.id, page]);

  useEffect(() => {
    window.localStorage.setItem(readingKey(activeBook.id, 'bookmark'), String(bookmark));
  }, [activeBook.id, bookmark]);

  useEffect(() => {
    window.localStorage.setItem(readingKey(activeBook.id, 'notes'), JSON.stringify(notes));
  }, [activeBook.id, notes]);

  const jumpToPage = useCallback((nextPage: number) => {
    if (!pageCount) return;
    const target = Math.max(1, Math.min(nextPage, pageCount));
    setJumpRequest((current) => ({ id: current.id + 1, page: target }));
  }, [pageCount]);

  const saveNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    setNotes((current) => [...current, {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      page: selectedQuote?.page ?? page,
      text,
      createdAt: Date.now(),
      ...(selectedQuote ? { selectedText: selectedQuote.text } : {}),
    }]);
    setNoteDraft('');
    setSelectedQuote(null);
    window.getSelection()?.removeAllRanges();
    setNoteEditorOpen(false);
  };

  const deleteNote = (id: string) => {
    setNotes((current) => current.filter((note) => note.id !== id));
  };

  const captureTextSelection = useCallback((selectedPage: number, text: string) => {
    setSelectedQuote({ page: selectedPage, text });
    setControlsVisible(true);
  }, []);

  const clearPdfSearch = () => {
    setPdfQuery('');
    setPdfSearchProgress(0);
    setPdfSearchResults([]);
  };

  const openReader = (book: Book, pdfData: Uint8Array | null = null) => {
    setActiveBook(book);
    setDrivePdfData(pdfData);
    setPage(readStoredPage(book.id, 'last-page', 1));
    setBookmark(readStoredPage(book.id, 'bookmark', 1));
    setNotes(readStoredNotes(book.id));
    setPdfQuery('');
    setPdfSearchResults([]);
    setSelectedQuote(null);
    setError(null);
    setScreen('reader');
  };

  const openBook = async (book: Book) => {
    if (drivePending) return;
    if (book.source === 'demo') {
      openReader(book);
      return;
    }
    try {
      setDrivePending(true);
      setLoadingBookId(book.id);
      setLoadingProgress(null);
      const cachedPdf = await readCachedDrivePdf(book.driveFileId!).catch(() => null);
      if (cachedPdf) {
        openReader(book, cachedPdf);
        return;
      }
      const accessToken = await requestGoogleDriveAccess(googleDriveConfig);
      const pdfData = await downloadGoogleDrivePdf(book.driveFileId!, accessToken, setLoadingProgress);
      void cacheDrivePdf(book.driveFileId!, pdfData).catch(() => undefined);
      openReader(book, pdfData);
    } catch (loadError) {
      setDriveMessage(loadError instanceof Error ? loadError.message : 'Unable to open this Drive PDF.');
    } finally {
      setDrivePending(false);
      setLoadingBookId(null);
      setLoadingProgress(null);
    }
  };

  const addPickedBooks = (items: DrivePickerItem[]) => {
    const newBooks = items.map((item) => ({
      driveFileId: item.id,
      id: `drive:${item.id}`,
      source: 'drive' as const,
      subtitle: 'Google Drive PDF',
      title: item.name.replace(/\.pdf$/i, ''),
    }));
    setBooks((current) => [
      ...current,
      ...newBooks.filter((book) => !current.some((existing) => existing.id === book.id)),
    ]);
    return newBooks[0] ?? null;
  };

  const addFromGoogleDrive = async () => {
    if (!isGoogleDriveConfigured) {
      setDriveMessage('Google Drive is ready in the app, but its public configuration has not been added yet. Follow the setup steps below.');
      return;
    }
    try {
      setDrivePending(true);
      setDriveMessage(null);
      const selection = await pickGoogleDriveItems(googleDriveConfig);
      if (!selection) return;
      const picked = selection.items[0];
      if (!picked) return;
      const pdfs = isDriveFolder(picked)
        ? await listFolderPdfs(picked.id, selection.accessToken)
        : [picked];
      if (!pdfs.length) {
        setDriveMessage('That folder does not contain any PDF files that Google Drive shared with Quiet Reader.');
        return;
      }
      const firstBook = addPickedBooks(pdfs);
      setDriveMessage(isDriveFolder(picked) ? `Added ${pdfs.length} PDFs from “${picked.name}”.` : `Added “${picked.name}”.`);
      if (firstBook) {
        setLoadingBookId(firstBook.id);
        setLoadingProgress(null);
        const pdfData = await downloadGoogleDrivePdf(firstBook.driveFileId!, selection.accessToken, setLoadingProgress);
        void cacheDrivePdf(firstBook.driveFileId!, pdfData).catch(() => undefined);
        openReader(firstBook, pdfData);
      }
    } catch (driveError) {
      setDriveMessage(driveError instanceof Error ? driveError.message : 'Unable to add from Google Drive.');
    } finally {
      setDrivePending(false);
      setLoadingBookId(null);
      setLoadingProgress(null);
    }
  };

  useEffect(() => {
    if (screen !== 'reader') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key === 'Escape') {
        setNoteEditorOpen(false);
        setViewSettingsOpen(false);
        setContentsOpen(false);
        setBookmarkMenuOpen(false);
        setTocSearchOpen(false);
        setTocQuery('');
        setPdfSearchOpen(false);
        setControlsVisible(false);
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        jumpToPage(page + (event.key === 'ArrowRight' ? 1 : -1));
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        setScrollRequest((current) => ({
          id: current.id + 1,
          direction: event.key === 'ArrowDown' ? 1 : -1,
        }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [jumpToPage, page, screen]);

  if (screen === 'library') {
    return <Library books={books} driveMessage={driveMessage} drivePending={drivePending} loadingBookId={loadingBookId} loadingProgress={loadingProgress} onAddFromDrive={addFromGoogleDrive} onOpen={openBook} />;
  }

  const notesOnPage = notes.filter((note) => note.page === page);
  const visibleContents = contents.filter((item) => item.title.toLowerCase().includes(tocQuery.trim().toLowerCase()));
  const currentProgress = bookmarkProgress(page, pageCount);

  return (
    <main className="reader-page">
      {pageCount > 0 && (
        <div
          aria-label={`Reading progress: page ${page} of ${pageCount}`}
          className="reader-bookmark-progress"
          role="progressbar"
          aria-valuemax={pageCount}
          aria-valuemin={1}
          aria-valuenow={page}
        >
          <span style={{ width: `${currentProgress}%` }} />
        </div>
      )}
      {document ? (
        <ContinuousPdf
          document={document}
          fullWidth={fullWidth}
          initialPage={page}
          jumpRequest={jumpRequest}
          scrollRequest={scrollRequest}
          onPageChange={setPage}
          onReaderClick={() => {
            if (window.getSelection()?.toString().trim()) return;
            if (controlsVisible) {
              setNoteEditorOpen(false);
              setBookmarkMenuOpen(false);
              setViewSettingsOpen(false);
              setContentsOpen(false);
              setTocSearchOpen(false);
              setTocQuery('');
              setPdfSearchOpen(false);
            }
            setControlsVisible((visible) => !visible);
          }}
          onRenderError={setError}
          onTextSelected={captureTextSelection}
          pageCount={pageCount}
          searchQuery={pdfQuery.trim().length >= 2 ? pdfQuery : ''}
          zoom={zoom}
        />
      ) : (
        <div className="reader-status">Opening your PDF…</div>
      )}

      {controlsVisible && (
        <>
          <header className="reader-toolbar">
            <button className="text-button" type="button" onClick={() => setScreen('library')}>
              ‹ Library
            </button>
            <span className="reader-title">{activeBook.title}</span>
            <div className="reader-actions">
              <button
                aria-expanded={bookmarkMenuOpen}
                aria-haspopup="menu"
                aria-label={`Go to bookmark on PDF page ${bookmark}`}
                className="bookmark-button reader-icon-button"
                title="Bookmark options"
                type="button"
                onClick={() => {
                  setNoteEditorOpen(false);
                  setViewSettingsOpen(false);
                  setContentsOpen(false);
                  setTocSearchOpen(false);
                  setTocQuery('');
                  setPdfSearchOpen(false);
                  setBookmarkMenuOpen((open) => !open);
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.75L6 21V4.75Z" />
                </svg>
              </button>
              <button
                aria-expanded={contentsOpen}
                aria-label="Open table of contents"
                className="contents-button reader-icon-button"
                title="Table of contents"
                type="button"
                onClick={() => {
                  setNoteEditorOpen(false);
                  setBookmarkMenuOpen(false);
                  setViewSettingsOpen(false);
                  setPdfSearchOpen(false);
                  if (contentsOpen) {
                    setTocSearchOpen(false);
                    setTocQuery('');
                    setContentsOpen(false);
                  } else {
                    setContentsOpen(true);
                  }
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M9 6h10M9 12h10M9 18h10M5 6h.01M5 12h.01M5 18h.01" />
                </svg>
              </button>
              <button
                aria-expanded={pdfSearchOpen}
                aria-label="Search this PDF"
                aria-pressed={Boolean(pdfQuery.trim())}
                className="reader-icon-button search-button"
                title="Search this PDF"
                type="button"
                onClick={() => {
                  setNoteEditorOpen(false);
                  setViewSettingsOpen(false);
                  setContentsOpen(false);
                  setBookmarkMenuOpen(false);
                  setTocSearchOpen(false);
                  setTocQuery('');
                  setPdfSearchOpen((open) => !open);
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="10.75" cy="10.75" r="5.75" />
                  <path d="m15 15 4.25 4.25" />
                </svg>
              </button>
            </div>
          </header>
          <footer className="reader-controls">
            <span className="page-indicator" aria-label={`PDF page ${page} of ${pageCount}`}>
              {page} / {pageCount}
            </span>
            <span className="control-divider" aria-hidden="true" />
            <button type="button" onClick={() => {
              setViewSettingsOpen(false);
              setContentsOpen(false);
              setBookmarkMenuOpen(false);
              setTocSearchOpen(false);
              setTocQuery('');
              setPdfSearchOpen(false);
              setNoteEditorOpen(true);
            }}>
              Note{selectedQuote ? ' · selection' : notesOnPage.length ? ` · ${notesOnPage.length}` : ''}
            </button>
            <button aria-expanded={viewSettingsOpen} type="button" onClick={() => {
              setNoteEditorOpen(false);
              setContentsOpen(false);
              setBookmarkMenuOpen(false);
              setTocSearchOpen(false);
              setTocQuery('');
              setPdfSearchOpen(false);
              setViewSettingsOpen((open) => !open);
            }}>View</button>
          </footer>
        </>
      )}

      {viewSettingsOpen && (
        <section className="display-settings" aria-label="Reading view settings">
          <button className="view-width" type="button" onClick={() => setFullWidth((enabled) => !enabled)}>
            {fullWidth ? 'Page width' : 'Full width'}
          </button>
          <div className="zoom-controls" aria-label="Zoom controls">
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.7, value - .15))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + .15))}>+</button>
          </div>
        </section>
      )}

      {bookmarkMenuOpen && (
        <section className="bookmark-menu" aria-label="Bookmark options" role="menu">
          <button type="button" role="menuitem" onClick={() => {
            jumpToPage(bookmark);
            setBookmarkMenuOpen(false);
            setControlsVisible(false);
          }}>
            Go to bookmark <small>p. {bookmark}</small>
          </button>
          <button type="button" role="menuitem" onClick={() => {
            setBookmark(page);
            setBookmarkMenuOpen(false);
          }}>
            Set bookmark here <small>p. {page}</small>
          </button>
        </section>
      )}

      {contentsOpen && (
        <aside className="contents-panel" aria-label="Table of contents">
          <header className="contents-header">
            <h2>Contents</h2>
            <div className="contents-header-actions">
              <button
                aria-label="Search table of contents"
                className={tocSearchOpen ? 'active' : undefined}
                title="Search contents"
                type="button"
                onClick={() => setTocSearchOpen((open) => !open)}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="10.75" cy="10.75" r="5.75" />
                  <path d="m15 15 4.25 4.25" />
                </svg>
              </button>
              <button aria-label="Close table of contents" type="button" onClick={() => {
                setTocSearchOpen(false);
                setTocQuery('');
                setContentsOpen(false);
              }}>×</button>
            </div>
          </header>
          {tocSearchOpen && (
            <div className="panel-search">
              <input
                aria-label="Search table of contents"
                autoFocus
                onChange={(event) => setTocQuery(event.target.value)}
                placeholder="Find a chapter"
                type="search"
                value={tocQuery}
              />
            </div>
          )}
          <div className="contents-list">
            {!contentsReady ? (
              <p>Loading contents…</p>
            ) : visibleContents.length ? visibleContents.map((item) => (
              <button
                key={`${item.page}-${item.level}-${item.title}`}
                onClick={() => {
                  jumpToPage(item.page);
                  setContentsOpen(false);
                  setTocSearchOpen(false);
                  setTocQuery('');
                  setControlsVisible(false);
                }}
                style={{ paddingLeft: `${14 + item.level * 14}px` }}
                type="button"
              >
                <span>{item.title}</span>
                <small>{item.page}</small>
              </button>
            )) : (
              <p>{contents.length ? 'No matching sections.' : 'This PDF has no table of contents.'}</p>
            )}
          </div>
        </aside>
      )}

      {pdfSearchOpen && (
        <aside className="pdf-search-panel" aria-label="Search this PDF">
          <header className="search-panel-header">
            <h2>Search PDF</h2>
            <div className="search-panel-actions">
              {pdfQuery.trim() && (
                <button className="clear-search" type="button" onClick={clearPdfSearch}>Clear</button>
              )}
              <button aria-label="Close PDF search" type="button" onClick={() => setPdfSearchOpen(false)}>×</button>
            </div>
          </header>
          <div className="panel-search">
            <input
              aria-label="Search PDF text"
              autoFocus
              onChange={(event) => setPdfQuery(event.target.value)}
              placeholder="Search this book"
              type="search"
              value={pdfQuery}
            />
          </div>
          <div className="pdf-search-results">
            {pdfQuery.trim().length < 2 ? (
              <p>Type at least two characters.</p>
            ) : pdfSearching ? (
              <p>Searching page {pdfSearchProgress || 1} of {pageCount}…</p>
            ) : pdfSearchResults.length ? pdfSearchResults.map((result) => (
              <button
                key={result.page}
                type="button"
                onClick={() => {
                  jumpToPage(result.page);
                  setPdfSearchOpen(false);
                  setControlsVisible(false);
                }}
              >
                <small>Page {result.page}</small>
                <span>{result.excerpt}</span>
              </button>
            )) : (
              <p>No results for “{pdfQuery.trim()}”.</p>
            )}
          </div>
        </aside>
      )}

      {noteEditorOpen && (
        <section className="note-editor" aria-label={`Add note on PDF page ${selectedQuote?.page ?? page}`}>
          <div className="note-editor-header">
            <span>Note on PDF page {selectedQuote?.page ?? page}</span>
            <button aria-label="Close note editor" type="button" onClick={() => setNoteEditorOpen(false)}>×</button>
          </div>
          {notesOnPage.length > 0 && (
            <div className="saved-notes" aria-label={`Notes on PDF page ${page}`}>
              {notesOnPage.map((note) => (
                <article className="saved-note" key={note.id}>
                  {note.selectedText && <blockquote>{note.selectedText}</blockquote>}
                  <p>{note.text}</p>
                  <button aria-label="Delete note" type="button" onClick={() => deleteNote(note.id)}>Delete</button>
                </article>
              ))}
            </div>
          )}
          {selectedQuote && (
            <div className="selected-quote">
              <div>
                <span>Linked text</span>
                <blockquote>{selectedQuote.text}</blockquote>
              </div>
              <button type="button" onClick={() => {
                setSelectedQuote(null);
                window.getSelection()?.removeAllRanges();
              }}>Remove</button>
            </div>
          )}
          <textarea
            aria-label="Note text"
            autoFocus
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Write a thought about this page…"
            value={noteDraft}
          />
          <div className="note-editor-actions">
            <button type="button" onClick={() => setNoteEditorOpen(false)}>Cancel</button>
            <button className="save-note" disabled={!noteDraft.trim()} type="button" onClick={saveNote}>Save note</button>
          </div>
        </section>
      )}

      {error && <div className="reader-error">{error}</div>}
    </main>
  );
}
