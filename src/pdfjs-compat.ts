type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
};

type PromiseWithResolversConstructor = PromiseConstructor & {
  withResolvers?: <T>() => PromiseWithResolvers<T>;
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
