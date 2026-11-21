import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

describe('Nachrüstungen für alte WebViews', () => {
  it('ergänzt fehlende Funktionen (in einer Umgebung ohne sie)', () => {
    const ts = readFileSync(new URL('../../polyfills.ts', import.meta.url), 'utf8');
    const js = transformSync(ts, { loader: 'ts', format: 'cjs' }).code;
    const out = runInNewContext(`
      delete Object.hasOwn; delete Array.prototype.at; delete String.prototype.at;
      delete String.prototype.replaceAll; delete Promise.allSettled;
      var exports = {}, module = { exports };
      ${js}
      ({ own: Object.hasOwn({ a: 1 }, 'a'), inherited: Object.hasOwn(Object.create({ a: 1 }), 'a'),
         at: [1, 2, 3].at(-1), sat: 'abc'.at(0), ra: 'a-b-c'.replaceAll('-', '+'),
         settled: Promise.allSettled([Promise.resolve(1), Promise.reject(new Error('x'))]) })`);
    expect([out.own, out.inherited, out.at, out.sat, out.ra]).toEqual([true, false, 3, 'a', 'a+b+c']);
    return out.settled.then((r: { status: string }[]) => expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected']));
  });
});
