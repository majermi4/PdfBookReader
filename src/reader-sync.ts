export type SyncedBook = {
  driveFileId: string;
  id: string;
  pageCount?: number;
  subtitle: string;
  title: string;
};

export type SyncedNote = {
  createdAt: number;
  id: string;
  page: number;
  selectedText?: string;
  text: string;
  updatedAt: number;
};

export type DeletedNote = {
  deletedAt: number;
  id: string;
};

export type SyncedReadingState = {
  bookmark: number;
  bookmarkUpdatedAt: number;
  deletedNotes: DeletedNote[];
  lastPage: number;
  lastPageUpdatedAt: number;
  notes: SyncedNote[];
};

export type ReaderSyncRecord = {
  books: SyncedBook[];
  reading: Record<string, SyncedReadingState>;
  schemaVersion: 1;
  updatedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseBook(value: unknown): SyncedBook | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.driveFileId !== 'string'
    || typeof value.title !== 'string'
    || typeof value.subtitle !== 'string') return null;
  if (value.pageCount !== undefined && !isPositiveInteger(value.pageCount)) return null;
  return {
    driveFileId: value.driveFileId,
    id: value.id,
    ...(value.pageCount ? { pageCount: value.pageCount } : {}),
    subtitle: value.subtitle,
    title: value.title,
  };
}

function parseNote(value: unknown): SyncedNote | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !isPositiveInteger(value.page)
    || typeof value.text !== 'string'
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || (value.selectedText !== undefined && typeof value.selectedText !== 'string')) return null;
  return {
    createdAt: value.createdAt,
    id: value.id,
    page: value.page,
    ...(value.selectedText === undefined ? {} : { selectedText: value.selectedText }),
    text: value.text,
    updatedAt: value.updatedAt,
  };
}

function parseDeletedNote(value: unknown): DeletedNote | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isTimestamp(value.deletedAt)) return null;
  return { deletedAt: value.deletedAt, id: value.id };
}

function parseReadingState(value: unknown): SyncedReadingState | null {
  if (!isRecord(value)
    || !isPositiveInteger(value.lastPage)
    || !isTimestamp(value.lastPageUpdatedAt)
    || !isPositiveInteger(value.bookmark)
    || !isTimestamp(value.bookmarkUpdatedAt)
    || !Array.isArray(value.notes)
    || !Array.isArray(value.deletedNotes)) return null;
  return {
    bookmark: value.bookmark,
    bookmarkUpdatedAt: value.bookmarkUpdatedAt,
    deletedNotes: value.deletedNotes.map(parseDeletedNote).filter((note): note is DeletedNote => Boolean(note)),
    lastPage: value.lastPage,
    lastPageUpdatedAt: value.lastPageUpdatedAt,
    notes: value.notes.map(parseNote).filter((note): note is SyncedNote => Boolean(note)),
  };
}

export function parseReaderSyncRecord(value: unknown): ReaderSyncRecord | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || !isTimestamp(value.updatedAt)
    || !Array.isArray(value.books)
    || !isRecord(value.reading)) return null;
  const rawReading = value.reading;
  const reading = Object.keys(rawReading).reduce<Record<string, SyncedReadingState>>((result, bookId) => {
    const parsed = parseReadingState(rawReading[bookId]);
    if (parsed) result[bookId] = parsed;
    return result;
  }, {});
  return {
    books: value.books.map(parseBook).filter((book): book is SyncedBook => Boolean(book)),
    reading,
    schemaVersion: 1,
    updatedAt: value.updatedAt,
  };
}

export function emptyReaderSyncRecord(): ReaderSyncRecord {
  return { books: [], reading: {}, schemaVersion: 1, updatedAt: 0 };
}

function latestValue<T>(local: T, localTimestamp: number, remote: T, remoteTimestamp: number) {
  return localTimestamp > remoteTimestamp ? { timestamp: localTimestamp, value: local } : { timestamp: remoteTimestamp, value: remote };
}

function mergeNotes(local: SyncedNote[], remote: SyncedNote[], deletions: DeletedNote[]) {
  const deletedAt = new Map(deletions.map((note) => [note.id, note.deletedAt]));
  const notes = new Map<string, SyncedNote>();
  for (const note of [...remote, ...local]) {
    const current = notes.get(note.id);
    if (!current || note.updatedAt > current.updatedAt) notes.set(note.id, note);
  }
  return [...notes.values()]
    .filter((note) => (deletedAt.get(note.id) ?? -1) < note.updatedAt)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function mergeDeletedNotes(local: DeletedNote[], remote: DeletedNote[]) {
  const tombstones = new Map<string, DeletedNote>();
  for (const note of [...remote, ...local]) {
    const current = tombstones.get(note.id);
    if (!current || note.deletedAt > current.deletedAt) tombstones.set(note.id, note);
  }
  return [...tombstones.values()].sort((a, b) => a.deletedAt - b.deletedAt || a.id.localeCompare(b.id));
}

function mergeReadingState(local: SyncedReadingState | undefined, remote: SyncedReadingState | undefined) {
  if (!local) return remote;
  if (!remote) return local;
  const lastPage = latestValue(local.lastPage, local.lastPageUpdatedAt, remote.lastPage, remote.lastPageUpdatedAt);
  const bookmark = latestValue(local.bookmark, local.bookmarkUpdatedAt, remote.bookmark, remote.bookmarkUpdatedAt);
  const deletedNotes = mergeDeletedNotes(local.deletedNotes, remote.deletedNotes);
  return {
    bookmark: bookmark.value,
    bookmarkUpdatedAt: bookmark.timestamp,
    deletedNotes,
    lastPage: lastPage.value,
    lastPageUpdatedAt: lastPage.timestamp,
    notes: mergeNotes(local.notes, remote.notes, deletedNotes),
  };
}

export function mergeReaderSyncRecords(local: ReaderSyncRecord, remote: ReaderSyncRecord): ReaderSyncRecord {
  const books = new Map<string, SyncedBook>();
  for (const book of [...remote.books, ...local.books]) books.set(book.id, book);
  const reading: Record<string, SyncedReadingState> = {};
  const bookIds = new Set([...Object.keys(remote.reading), ...Object.keys(local.reading)]);
  for (const bookId of bookIds) {
    const merged = mergeReadingState(local.reading[bookId], remote.reading[bookId]);
    if (merged) reading[bookId] = merged;
  }
  const latestReadingUpdate = Object.keys(reading).reduce((latest, bookId) => {
    const state = reading[bookId];
    return Math.max(
      latest,
      state.lastPageUpdatedAt,
      state.bookmarkUpdatedAt,
      ...state.notes.map((note) => note.updatedAt),
      ...state.deletedNotes.map((note) => note.deletedAt),
    );
  }, 0);
  return {
    books: [...books.values()].sort((a, b) => a.title.localeCompare(b.title)),
    reading,
    schemaVersion: 1,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt, latestReadingUpdate),
  };
}
