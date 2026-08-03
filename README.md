# Quiet Reader

The first functional reader slice for the Quiet Reader product concept.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Select the supplied sample book in the Library.

## What works now

- Real PDF.js canvas rendering of the supplied 422-page sample book.
- Full-viewport reader without the Library navigation frame.
- Continuous vertical scrolling; the reader renders only the nearby PDF pages to stay responsive with a long book.
- An on-demand control tray, including a full-width mode and zoom from 70% to 200%.
- Automatic last-viewed page saved in browser local storage.
- One manual main bookmark saved separately in browser local storage.
- Google Drive App Data sync for selected Drive books, reading position, bookmark, and notes.

When its Google Drive configuration is supplied, the app requests Google login when it opens. The same grant is reused for Google Drive sync and the book picker, so choosing a book does not require separate consent.

## Google Drive

The first Drive phase is implemented: users can explicitly choose a PDF or folder through Google Picker, and the selected books appear in the local library. Configure the required browser-visible values using [the Google Drive setup guide](docs/google-drive-setup.md).
