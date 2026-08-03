const databaseName = 'quiet-reader';
const databaseVersion = 1;
const storeName = 'drive-pdfs';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);
    request.onerror = () => reject(request.error ?? new Error('Unable to open on-device book storage.'));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readCachedDrivePdf(fileId: string) {
  const database = await openDatabase();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(fileId);
      request.onerror = () => reject(request.error ?? new Error('Unable to read the saved book.'));
      request.onsuccess = () => {
        const saved = request.result;
        resolve(saved instanceof ArrayBuffer ? new Uint8Array(saved) : null);
      };
    });
  } finally {
    database.close();
  }
}

export async function cacheDrivePdf(fileId: string, pdfData: Uint8Array) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(storeName, 'readwrite')
        .objectStore(storeName)
        .put(pdfData.slice().buffer, fileId);
      request.onerror = () => reject(request.error ?? new Error('Unable to save this book for offline reading.'));
      request.onsuccess = () => resolve();
    });
  } finally {
    database.close();
  }
}
