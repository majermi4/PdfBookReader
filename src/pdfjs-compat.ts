type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
};

type PromiseWithResolversConstructor = PromiseConstructor & {
  withResolvers?: <T>() => PromiseWithResolvers<T>;
};

type ReadableStreamWithAsyncIterator = ReadableStream<unknown> & {
  [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>;
};

// PDF.js 6 uses this recent API in both the page and worker bundles. Safari on
// older iPads does not provide it yet, even though the rest of the reader works.
const promiseConstructor = Promise as PromiseWithResolversConstructor;

if (typeof promiseConstructor.withResolvers !== 'function') {
  promiseConstructor.withResolvers = <T>() => {
    let reject!: (reason?: unknown) => void;
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, reject, resolve };
  };
}

// PDF.js reads text-content streams with `for await...of`. WebKit only added
// ReadableStream async iteration in Safari/iPadOS 26.4, so earlier iPads can
// paint a PDF page and then fail exactly when its selectable text is requested.
if (typeof ReadableStream !== 'undefined') {
  const readableStreamPrototype = ReadableStream.prototype as ReadableStreamWithAsyncIterator;
  if (typeof readableStreamPrototype[Symbol.asyncIterator] !== 'function') {
    Object.defineProperty(readableStreamPrototype, Symbol.asyncIterator, {
      configurable: true,
      writable: true,
      async *value(this: ReadableStream<unknown>) {
        const reader = this.getReader();
        let completed = false;
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) {
              completed = true;
              return;
            }
            yield result.value;
          }
        } finally {
          try {
            if (!completed) await reader.cancel();
          } finally {
            reader.releaseLock();
          }
        }
      },
    });
  }
}
