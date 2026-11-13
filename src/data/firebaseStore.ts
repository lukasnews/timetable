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
  type Firestore,
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

  constructor(private cfg: CloudConfig) {
    this.app = initializeApp(cfg.firebase, 'fk-' + cfg.familyId);
    this.db = initializeFirestore(this.app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    const auth = getAuth(this.app);
    onAuthStateChanged(auth, (u) => {
      this.authed = !!u;
      if (!u) signInAnonymously(auth).catch((e) => {
        console.warn('Anonyme Anmeldung fehlgeschlagen', e);
        this.emitStatus();
      });
      this.emitStatus();
    });
    window.addEventListener('online', () => this.emitStatus());
    window.addEventListener('offline', () => this.emitStatus());
  }

  private col(c: Collection) {
    return collection(this.db, 'families', this.cfg.familyId, c);
  }

  private status(): SyncStatus {
    if (this.error) return 'error';
    if (!navigator.onLine) return 'offline';
    if (this.pending.size || !this.authed) return 'pending';
    return 'synced';
  }

  private emitStatus() {
    const s = this.status();
    this.statusCbs.forEach((cb) => cb(s));
  }

  subscribe<T extends Item>(c: Collection, cb: (items: T[]) => void) {
    return onSnapshot(
      this.col(c),
      { includeMetadataChanges: true },
      (snap) => {
        this.error = false;
        if (snap.metadata.hasPendingWrites) this.pending.add(c);
        else this.pending.delete(c);
        this.emitStatus();
        cb(snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })));
      },
      (err) => {
        console.error('Sync-Fehler', c, err);
        this.error = true;
        this.emitStatus();
      },
    );
  }

  put<T extends Item>(c: Collection, item: T) {
    const clean = JSON.parse(JSON.stringify({ ...item, updatedAt: Date.now() }));
    setDoc(doc(this.col(c), item.id), clean).catch((e) => console.error('Speichern fehlgeschlagen', e));
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
