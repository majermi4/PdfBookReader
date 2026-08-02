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

## Not implemented yet

- Google Drive sign-in and deliberate PDF/folder selection.
- Cross-device sync.
- Text selection, highlights, notes, and the notes list.
- Offline PDF caching and PWA installation support.
