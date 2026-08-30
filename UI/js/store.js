/* The local storage layer.
 *
 * IndexedDB is the default backend, with two fallbacks behind it: localStorage
 * (for private browsing, or when IndexedDB is blocked) and memory (the baseline
 * of the comparison experiment: no local copy at all).
 *
 * The essential point: a write only resolves at tx.oncomplete, that is once the
 * transaction has actually committed to disk — not when put() is called. That
 * is what makes the "saved on this device" message truthful rather than merely
 * optimistic.
 */

import { CFG } from './config.js';

const DB_NAME    = 'exam_platform';
const DB_VERSION = 1;
const LS_PREFIX  = 'exam_store_';

/* Used by both store.js and metrics.js, so every object store is created here
   in one go. */
export function openIDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('answers')) {
        db.createObjectStore('answers', { keyPath: 'question_id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('events')) {
        db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB محجوبة من تبويب آخر'));
  });
}

function idbBackend(db) {
  const run = (store, mode, action) => new Promise((resolve, reject) => {
    let value;
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    if (request) request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => resolve(value);       // the actual commit, not just the request
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error || new Error('أُجهضت المعاملة'));
  });

  return {
    name: 'indexeddb',
    put:   (store, record) => run(store, 'readwrite', (o) => o.put(record)),
    get:   (store, key)    => run(store, 'readonly',  (o) => o.get(key)),
    all:   (store)         => run(store, 'readonly',  (o) => o.getAll()),
    del:   (store, key)    => run(store, 'readwrite', (o) => o.delete(key)),
    clear: (store)         => run(store, 'readwrite', (o) => o.clear()),
  };
}

function localBackend() {
  const read = (store) => {
    try { return JSON.parse(localStorage.getItem(LS_PREFIX + store) || '[]'); }
    catch (_) { return []; }
  };
  const write = (store, rows) => {
    localStorage.setItem(LS_PREFIX + store, JSON.stringify(rows));
  };
  const keyOf = (store, record) => (store === 'meta' ? record.key : record.question_id);

  return {
    name: 'localstorage',
    async put(store, record) {
      const rows = read(store).filter((r) => keyOf(store, r) !== keyOf(store, record));
      rows.push(record);
      write(store, rows);
    },
    async get(store, key) {
      return read(store).find((r) => (store === 'meta' ? r.key : r.question_id) === key);
    },
    async all(store)      { return read(store); },
    async del(store, key) {
      write(store, read(store).filter((r) => (store === 'meta' ? r.key : r.question_id) !== key));
    },
    async clear(store)    { localStorage.removeItem(LS_PREFIX + store); },
  };
}

function memoryBackend() {
  const tables = { answers: new Map(), meta: new Map(), events: new Map() };
  const keyOf = (store, record) => (store === 'meta' ? record.key : record.question_id);

  return {
    name: 'memory',
    async put(store, record) { tables[store].set(keyOf(store, record), record); },
    async get(store, key)    { return tables[store].get(key); },
    async all(store)         { return [...tables[store].values()]; },
    async del(store, key)    { tables[store].delete(key); },
    async clear(store)       { tables[store].clear(); },
  };
}

export const Store = {
  backend: null,

  async init() {
    if (CFG.storage === 'memory') {
      this.backend = memoryBackend();
      return this.backend.name;
    }
    if (CFG.storage === 'localstorage') {
      this.backend = localBackend();
      return this.backend.name;
    }

    try {
      this.backend = idbBackend(await openIDB());
    } catch (_) {
      /* IndexedDB is unavailable (private browsing, blocked, or held by another
         tab) — fall back so the student still keeps a local copy. */
      this.backend = localBackend();
    }
    return this.backend.name;
  },

  /* Binds the local store to one attempt.

     Two students share one browser profile, so the answers cached for the
     previous attempt must not leak into the next one: switching attempts wipes
     the local copy before a single answer is read. Reopening the *same*
     attempt keeps everything, which is the whole point of the local copy. */
  async openSession(attemptId) {
    const previous = await this.metaValue('attemptId', null);
    const sameAttempt = previous === attemptId;

    if (!sameAttempt) {
      await this.clear('answers');
      await this.clear('meta');
    }

    await this.setMeta('attemptId', attemptId);
    return sameAttempt;
  },

  put(store, record) { return this.backend.put(store, record); },
  get(store, key)    { return this.backend.get(store, key); },
  all(store)         { return this.backend.all(store); },
  del(store, key)    { return this.backend.del(store, key); },
  clear(store)       { return this.backend.clear(store); },

  /* Called after submission — the event log stays, because the dashboard
     reads it. */
  async clearSession() {
    await this.clear('answers');
    await this.clear('meta');
  },

  async metaValue(key, fallback = null) {
    const row = await this.get('meta', key);
    return row ? row.value : fallback;
  },

  setMeta(key, value) { return this.put('meta', { key, value }); },
};
