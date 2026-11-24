import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  deleteField,
  updateDoc,
  arrayUnion,
  arrayRemove,
  type Firestore,
  getDocsFromServer,
} from 'firebase/firestore';
import type { CloudConfig, Collection, Item, Store, SyncStatus } from './store';

/**
 * Firestore mit lokalem Offline-Cache: Lesen und Schreiben funktioniert auch ohne Netz,
 * Änderungen werden automatisch hochgeladen, sobald wieder Verbindung besteht.
 * Kein Login für die Familie: Das Gerät meldet sich unsichtbar anonym an,
 * der Zugriff erfolgt über die geheime Familien-ID.
 */
export class FirebaseStore implements Store {
  readonly mode = 'cloud' as const;
  private app: FirebaseApp;
  private db: Firestore;
  private statusCbs = new Set<(s: SyncStatus) => void>();
  private pending = new Set<Collection>();
  private error = false;
  private authed = false;
  private authReady: Promise<void>;
  /** Sammlungen, deren letzter Stand nur aus dem Gerätespeicher kommt (Server nicht erreichbar) */
  private fromCache = new Set<Collection>();
  private serverSeen = false;
  private readonly started = Date.now();

  constructor(private cfg: CloudConfig) {
    this.app = initializeApp(cfg.firebase, 'fk-' + cfg.familyId);
    this.db = initializeFirestore(this.app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    const auth = getAuth(this.app);
    let resolveAuth: () => void;
    this.authReady = new Promise((r) => (resolveAuth = r));
    onAuthStateChanged(auth, (u) => {
      this.authed = !!u;
      if (u) resolveAuth();
      if (!u) signInAnonymously(auth).catch((e) => {
        console.warn('Anonyme Anmeldung fehlgeschlagen', e);
        this.emitStatus();
      });
      this.emitStatus();
    });
    window.addEventListener('online', () => this.emitStatus());
    window.addEventListener('offline', () => this.emitStatus());
    // Nach der Anlaufzeit prüfen, ob der Server erreicht wurde (sonst „offline“ anzeigen)
    setTimeout(() => this.emitStatus(), 9000);
  }

  private col(c: Collection) {
    return collection(this.db, 'families', this.cfg.familyId, c);
  }

  private status(): SyncStatus {
    if (this.error) return 'error';
    if (!navigator.onLine) return 'offline';
    // navigator.onLine meldet in der Android-App (WebView) Netzverlust nicht zuverlässig –
    // darum zusätzlich: liefert Firestore nur Daten aus dem Gerätespeicher, ist der Server nicht erreichbar
    if (this.fromCache.size) return !this.serverSeen && Date.now() - this.started < 8000 ? 'pending' : 'offline';
    if (this.pending.size || !this.authed) return 'pending';
    return 'synced';
  }

  private emitStatus() {
    const s = this.status();
    this.statusCbs.forEach((cb) => cb(s));
  }

  subscribe<T extends Item>(c: Collection, cb: (items: T[]) => void) {
    let stopped = false;
    let unsub = () => {};
    let retry: number | undefined;
    const start = () => {
      if (stopped) return;
      unsub = this.listen(c, cb, () => {
        // Bei Fehler (z. B. Anmeldung noch nicht fertig) nach kurzer Pause neu verbinden
        retry = window.setTimeout(start, 5000);
      });
    };
    this.authReady.then(start);
    return () => {
      stopped = true;
      clearTimeout(retry);
      unsub();
    };
  }

  private listen<T extends Item>(c: Collection, cb: (items: T[]) => void, onError: () => void) {
    return onSnapshot(
      this.col(c),
      { includeMetadataChanges: true },
      (snap) => {
        this.error = false;
        if (snap.metadata.hasPendingWrites) this.pending.add(c);
        else this.pending.delete(c);
        if (snap.metadata.fromCache) this.fromCache.add(c);
        else { this.fromCache.delete(c); this.serverSeen = true; }
        this.emitStatus();
        cb(snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })));
      },
      (err) => {
        console.error('Sync-Fehler', c, err);
        this.error = true;
        this.emitStatus();
        onError();
      },
    );
  }

  put<T extends Item>(c: Collection, item: T) {
    const clean = JSON.parse(JSON.stringify({ ...item, updatedAt: Date.now() }));
    setDoc(doc(this.col(c), item.id), clean).catch((e) => console.error('Speichern fehlgeschlagen', e));
  }

  patch(c: Collection, id: string, fields: Record<string, unknown>) {
    const data: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, v] of Object.entries(fields)) data[k] = v === undefined ? deleteField() : JSON.parse(JSON.stringify(v));
    // nur die genannten Felder ersetzen (keine tiefe Zusammenführung, keine anderen Felder überschreiben)
    setDoc(doc(this.col(c), id), data, { mergeFields: Object.keys(data) }).catch((e) => console.error('Speichern fehlgeschlagen', e));
  }

  update(c: Collection, id: string, fields: Record<string, unknown>, lists: { add?: Record<string, unknown[]>; remove?: Record<string, unknown[]> } = {}) {
    const data: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, v] of Object.entries(fields)) data[k] = v === undefined ? deleteField() : JSON.parse(JSON.stringify(v));
    const ref = doc(this.col(c), id);
    // Firestore erlaubt pro Feld nur eine Listen-Operation je Schreibvorgang: Entfernen und Hinzufügen nacheinander
    const rem = Object.entries(lists.remove ?? {}).filter(([, v]) => v.length);
    const add = Object.entries(lists.add ?? {}).filter(([, v]) => v.length);
    for (const [k, v] of add) if (!rem.some(([r]) => r === k)) data[k] = arrayUnion(...v);
    const first = updateDoc(ref, data);
    const later = add.filter(([k]) => rem.some(([r]) => r === k));
    const chain = rem.length
      ? first.then(() => updateDoc(ref, Object.fromEntries(rem.map(([k, v]) => [k, arrayRemove(...v)]))))
        .then(() => (later.length ? updateDoc(ref, Object.fromEntries(later.map(([k, v]) => [k, arrayUnion(...v)]))) : undefined))
      : first;
    chain.catch((e) => console.warn('Ändern übersprungen (Eintrag gelöscht?)', e));
  }

  /** Mehrere Einträge hochladen und warten, bis der Server sie bestätigt hat */
  async upload(items: { col: Collection; item: Item }[]): Promise<void> {
    await this.authReady;
    await Promise.all(items.map(({ col, item }) =>
      setDoc(doc(this.col(col), item.id), JSON.parse(JSON.stringify({ ...item, updatedAt: Date.now() })))));
  }

  async fetchAll<T extends Item>(c: Collection): Promise<T[]> {
    await this.authReady;
    const snap = await getDocsFromServer(this.col(c));
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
  }

  /** Familienkalender endgültig löschen: alle Dokumente aller Sammlungen, wartet auf den Server */
  async wipe(): Promise<number> {
    await this.authReady;
    let n = 0;
    for (const c of ['events', 'timetables', 'backups', 'persons', 'meta'] as Collection[]) {
      const snap = await getDocsFromServer(this.col(c));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      n += snap.size;
    }
    return n;
  }

  remove(c: Collection, id: string) {
    deleteDoc(doc(this.col(c), id)).catch((e) => console.error('Löschen fehlgeschlagen', e));
  }

  onStatus(cb: (s: SyncStatus) => void) {
    this.statusCbs.add(cb);
    cb(this.status());
    return () => this.statusCbs.delete(cb);
  }
}
