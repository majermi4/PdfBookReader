# Quiet Reader — product brief

## Purpose

Quiet Reader is a deliberately small, installable web app for reading personally chosen PDF books on MacBook, iPhone, and iPad. It should make returning to a book and capturing thoughts feel immediate, while keeping the reader itself calm and unobstructed.

## Primary user need

Readers want to open a PDF and continue exactly where they last viewed it, while keeping an independently controlled definition of actual reading progress. They want to mark passages and write short notes without turning the app into a general-purpose library or productivity product.

## Product principles

- The PDF is the focus. Reader controls disappear during reading.
- Last viewed page is remembered automatically; the main bookmark is never moved automatically.
- The user explicitly chooses every PDF or Drive folder to add. The app never scans or displays all of Google Drive.
- Highlights and notes are quick to create, easy to revisit, and stay tied to the page and selected text.
- No store, social feed, recommendations, reading goals, or unrelated features.

## Core concepts

### Last viewed page

The current page is saved automatically whenever it changes. Reopening a book always starts at this page.

### Main bookmark

Each book has one manual main bookmark. The user sets or replaces it intentionally. The reader displays a persistent `Go to bookmark` action when controls are shown; it never changes simply because the user reads further.

### Selected books

From Google Drive, the user may add a particular PDF file or choose a particular folder. Choosing a folder adds only PDF files in that folder. Each addition is a deliberate user action.

## Essential screens

### Library

- A calm list of the user's selected PDFs.
- Each row shows title, last opened date, last viewed page, and main bookmark page.
- One primary action: `Choose a PDF from Google Drive`.
- Adding a folder is available in the Drive picker, not as a competing library feature.

### Reader

- Opens at the last viewed page in an immersive, full-page PDF view.
- Chrome is hidden by default. A tap/click on the page reveals it; the small `Show controls` handle remains available for discoverability.
- Visible controls contain only: return to Library, book title, `Go to bookmark`, previous/next page, Highlight, and Add note.
- Tapping/clicking the page again hides controls and returns to full-page reading.
- Text selection remains the path to highlighting; showing and hiding chrome must not make selection frustrating.

### Notes and highlights

- A chronological, cross-book list of saved highlights and notes.
- Each item shows book, page, quoted text, and the user's note.
- `Open page` returns directly to the source location.

## User flows

### Add and open a book

1. User chooses a PDF file or folder in Google Drive.
2. The app adds only the selected PDF(s) to the Library.
3. User opens a book.
4. The app displays its last viewed page or page 1 for a new book.

### Set reading progress

1. User reaches a meaningful stopping point.
2. User reveals reader controls and sets the main bookmark at that page.
3. The app retains the previous bookmark until the user explicitly replaces it.

### Highlight and note

1. User selects text in the PDF.
2. The selection action offers Highlight and Add note.
3. The annotation is saved with the PDF identity, page, selection geometry/text, and optional note.

## Data and sync

- PDF source: Google Drive; the app reads only user-selected files/folders.
- Local data: IndexedDB stores library metadata, last viewed page, manual bookmark, highlights, notes, and offline cache metadata.
- Cross-device data: Google Drive-backed app data or a dedicated backend syncs reading state and annotations between devices.
- Offline: recently opened PDFs and all local reading state remain available where browser storage permits; changes queue for sync.

## Recommended implementation direction

- Installable responsive PWA for macOS, iOS, and iPadOS.
- React, TypeScript, and Vite for the application shell.
- PDF.js for PDF rendering, text selection, and annotation placement.
- Google Identity Services and Google Drive API for sign-in and the deliberate file/folder picker.
- IndexedDB for local persistence and caching.

## Initial scope

1. Google sign-in and explicit PDF/folder selection.
2. Library of selected books.
3. Full-page reader with automatic last-page saving and manual main bookmark.
4. Text highlight and short notes.
5. Notes/highlights list and page deep-links.
6. Sync and offline behavior.

## Explicit exclusions for version one

- Buying, downloading, or recommending books.
- EPUB and non-PDF formats.
- Social sharing, collaboration, public profiles, or reading statistics.
- Automatic progress/bookmark changes that redefine the user's main bookmark.

## Success criteria

- On any supported device, opening a book reliably returns to its last viewed page.
- The main bookmark is visibly distinct from the last viewed page and changes only through a user action.
- A reader can add a highlight or note in a few direct gestures without leaving the page.
- The reading screen is visually dominated by the PDF, with controls available in one simple gesture.
