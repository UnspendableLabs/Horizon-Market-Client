/**
 * Returns a fetch callable without relying on `this` binding.
 * Native `globalThis.fetch` throws "Illegal invocation" when passed by reference.
 */
export function resolveFetch(
  impl?: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const fetchFn = impl ?? globalThis.fetch;
  return fetchFn.bind(globalThis);
}
