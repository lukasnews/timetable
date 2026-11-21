/* Kleine Nachrüstungen für ältere Android-WebViews/iPads (vor Chrome 93 / Safari 15.4).
   Firebase nutzt z. B. Object.hasOwn – ohne diese Zeilen würde die Synchronisation dort abbrechen. */
/* eslint-disable no-extend-native */
const O = Object as unknown as Record<string, unknown>;
if (!O.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', { configurable: true, writable: true,
    value: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k) });
}
function at(this: { length: number; [i: number]: unknown }, n: number) {
  n = Math.trunc(n) || 0;
  if (n < 0) n += this.length;
  return n < 0 || n >= this.length ? undefined : this[n];
}
for (const C of [Array, String] as unknown as { prototype: Record<string, unknown> }[]) {
  if (!C.prototype.at) Object.defineProperty(C.prototype, 'at', { configurable: true, writable: true, value: at });
}
const SP = String.prototype as unknown as Record<string, unknown>;
if (!SP.replaceAll) {
  Object.defineProperty(String.prototype, 'replaceAll', { configurable: true, writable: true,
    value(this: string, search: string | RegExp, repl: string) {
      if (search instanceof RegExp) return this.replace(search, repl);
      return this.split(search).join(repl);
    } });
}
const P = Promise as unknown as Record<string, unknown>;
if (!P.allSettled) {
  P.allSettled = (list: Iterable<unknown>) => Promise.all([...list].map((p) => Promise.resolve(p).then(
    (value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }))));
}
export {};
