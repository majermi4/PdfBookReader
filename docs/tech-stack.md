# Quiet Reader — technology stack

## Decision summary

Build Quiet Reader as a responsive, installable web app (PWA) with no custom application backend in version one. The browser talks directly to Google services after the user signs in. Google Drive remains the source of PDFs; its private application-data folder stores synchronised reader state.

This is the smallest stack that supports MacBook, iPhone, and iPad without maintaining three native applications.

## Architecture at a glance

```text
Browser PWA
  ├─ React user interface
  ├─ PDF.js renderer and text layer
  ├─ IndexedDB: local state and recent PDF cache
  ├─ Service worker: application shell/offline support
  └─ Google Drive API
       ├─ User-selected PDF files
       └─ appDataFolder: private reading-state sync record
```

The static PWA is hosted on a CDN. No server stores the user's PDFs, highlights, or notes.

## Chosen stack

| Area | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | Safer data models for bookmarks, annotations, and sync. |
| UI | React | Mature responsive UI tooling and a good fit for the Google Drive picker. |
| Build | Vite | Small, fast static web-app build with uncomplicated deployment. |
| PDF reader | PDF.js | Renders PDFs and exposes a text layer needed for selection and highlights. |
| Local database | IndexedDB through Dexie | Durable browser storage with a much simpler query API than raw IndexedDB. |
| Offline app shell | `vite-plugin-pwa` / Workbox | Installs the app and makes its own interface available offline. |
| PDF cache | Cache Storage, managed by the app | Stores recently opened PDFs on a best-effort basis. |
| Identity and file selection | Google Identity Services + Google Picker | Familiar sign-in and deliberate file selection from Google Drive. |
| Sync | Google Drive API `appDataFolder` | Private per-user storage without introducing a separate backend. |
| Unit tests | Vitest + React Testing Library | Fast checks for reading-state and interface behaviour. |
| End-to-end tests | Playwright | Verifies the critical flows across desktop and mobile-sized viewports. |

## Google Drive integration

### User-selected PDFs

Use the Google Picker rather than a custom Drive browser. The picker is a familiar Drive file-open interface and returns the specific selected item to the web app. The default permission is the narrow `drive.file` scope, so the app only receives access to files the user has chosen. Google explicitly recommends this pairing for a safer, more focused experience. [Google Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview), [Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

Store every selected PDF by immutable Drive file ID, not by filename. The library keeps only those IDs and their cached display metadata.

### Selected folders

The picker should offer a deliberate "choose folder" mode. Quiet Reader then lists only PDF children of that chosen folder; it never scans the rest of Drive. Folder selection and enumeration must be proven in an early technical spike with the narrow scope before broadening permissions. If the current Picker/Drive permission model cannot enumerate children of a selected folder with `drive.file`, the product choice is:

1. Prefer explicit multi-file selection, preserving the narrow scope; or
2. Request a read-only scope only after a clear user explanation.

Do not silently request broad Drive access just to support folders.

### Sync record

Use Drive's private `appDataFolder` with the `drive.appdata` scope for a small JSON state record. It is created for the app, hidden from the Drive interface, and accessible only by Quiet Reader. It is suitable for configuration-style data, not for user-visible PDFs. [Google Drive app data folder](https://developers.google.com/workspace/drive/api/guides/appdata)

The record contains:

- selected PDF and selected-folder identifiers;
- per-book last viewed page and its update timestamp;
- per-book manual main bookmark and its update timestamp;
- highlights and notes, each with a UUID, PDF file ID, page, text/selection anchor, creation time, and update time.

On startup and after local changes, the app reads, merges, and writes this record. Merge fields independently by latest update timestamp so changing a bookmark on one device does not discard a note created on another. A later version may replace this single record with append-only change files if conflict volume grows.

`appDataFolder` is not a backup guarantee: its data can be removed when a user disconnects the app or deletes app data. Local IndexedDB remains the first copy while the app is installed. [Google Drive app data folder](https://developers.google.com/workspace/drive/api/guides/appdata)

## Browser data model

### IndexedDB tables

- `books`: Drive file ID, title, page count, thumbnail metadata, last-opened timestamp.
- `readingState`: Drive file ID, last viewed page, manual bookmark page, independent timestamps.
- `annotations`: annotation UUID, Drive file ID, page, selected text, PDF selection geometry, color, note, timestamps.
- `syncQueue`: local changes waiting to be merged/uploaded.
- `cacheIndex`: cached PDF size, last access time, and eviction priority.

### Caching rules

- Save reading state immediately to IndexedDB before attempting network sync.
- Cache a PDF only after the user has opened it.
- Evict least-recently-used cached PDFs when storage pressure occurs; never evict reading state merely to make room for a PDF.
- Treat offline PDFs as best effort because browser storage quotas vary, especially on mobile devices.
- Never pre-download a selected folder in the background.

## Reader implementation

PDF.js renders one visible page plus a small adjacent-page buffer. This keeps initial opening and page turns responsive on phones and limits memory use on large PDFs.

The reader has two states:

- **Immersive:** the PDF fills the reading area; chrome is hidden.
- **Controls shown:** tap/click the page or the visible controls handle to reveal Library, main bookmark, paging, Highlight, and Add note. Tapping/clicking the page again hides chrome.

Text selection takes precedence over chrome hiding. A selection gesture must open annotation actions rather than accidentally hide the controls.

## Security and privacy

- Restrict the OAuth client to the deployed production origin and local development origin.
- Request only `openid`, `email`, `profile`, `drive.file`, and `drive.appdata` as needed; request Drive access when the user first chooses a book, not on the welcome screen.
- Do not store Google access tokens in local storage. Use Google's supported browser token flow and keep tokens in memory where possible.
- Do not send PDFs or annotations to an application-controlled server in version one.
- Keep the static hosting provider free of user content and analytics by default.

## Deployment

Deploy the static Vite build to a CDN-backed static host such as Cloudflare Pages, Netlify, or Vercel. Configure one production HTTPS origin in Google Cloud for the OAuth client and Picker API key. The build produces static HTML, JavaScript, CSS, and the service worker.

## What is intentionally not included

- A custom backend, user database, or paid sync service.
- Native Swift/Kotlin code or app-store packaging in version one.
- Server-side PDF processing, OCR, or search indexing.
- Full Drive indexing, automatic imports, background folder scans, and generic file management.
- Collaborative annotations or sharing.

## Delivery sequence

1. Scaffold the Vite/React PWA and implement the local Library and Reader with sample PDFs.
2. Add IndexedDB persistence for last viewed page, manual bookmark, highlights, and notes.
3. Integrate Google sign-in and picker for individual PDF selection.
4. Add the private Drive sync record and test two-device merge behaviour.
5. Run the folder-selection technical spike and decide whether narrow-scope folder import is viable.
6. Add offline PDF caching, accessibility checks, and end-to-end tests.

## When to revisit this decision

Introduce a small backend only if the app needs capabilities the browser/Drive approach handles poorly: real-time collaboration, reliable large-scale conflict resolution, server-side search/OCR, analytics, subscriptions, or durable background sync while the app is closed.
