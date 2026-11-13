import type { Collection, Item, Store, SyncStatus } from './store';

/** Speichert alles im Browser (localStorage). Für Betrieb ohne Cloud oder zum Ausprobieren. */
export class LocalStore implements Store {
  readonly mode = 'local' as const;
  private listeners = new Map<Collection, Set<(items: any[]) => void>>();
  private channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fk-local') : null;

  constructor(private prefix = 'fk.local.') {
    this.channel?.addEventListener('message', (e) => this.emit(e.data as Collection));
  }

  private read<T>(col: Collection): Record<string, T> {
    try {
      return JSON.parse(localStorage.getItem(this.prefix + col) || '{}');
    } catch {
      return {};
    }
  }

  private write(col: Collection, data: Record<string, unknown>) {
    localStorage.setItem(this.prefix + col, JSON.stringify(data));
    this.emit(col);
    this.channel?.postMessage(col);
  }

  private emit(col: Collection) {
    const items = Object.values(this.read(col));
    this.listeners.get(col)?.forEach((cb) => cb(items));
  }

  all<T>(col: Collection): T[] {
    return Object.values(this.read<T>(col));
  }

  subscribe<T extends Item>(col: Collection, cb: (items: T[]) => void) {
    if (!this.listeners.has(col)) this.listeners.set(col, new Set());
    this.listeners.get(col)!.add(cb);
    cb(Object.values(this.read<T>(col)));
    return () => this.listeners.get(col)!.delete(cb);
  }

  put<T extends Item>(col: Collection, item: T) {
    const data = this.read(col);
    data[item.id] = JSON.parse(JSON.stringify({ ...item, updatedAt: Date.now() }));
    this.write(col, data);
  }

  remove(col: Collection, id: string) {
    const data = this.read(col);
    delete data[id];
    this.write(col, data);
  }

  onStatus(cb: (s: SyncStatus) => void) {
    cb('local');
    return () => {};
  }
}
