/* طبقة التخزين المحلي.
 *
 * المحرّك الافتراضي IndexedDB، ومعه مساران احتياطيان: localStorage (للتصفّح
 * الخاص أو عند حجب IndexedDB) وmemory (خط الأساس في تجربة المقارنة: لا نسخة
 * محلية إطلاقاً).
 *
 * نقطة جوهرية: عملية الكتابة لا تُحلّ إلا عند tx.oncomplete، أي عند التزام
 * المعاملة فعلاً على القرص — لا عند استدعاء put(). هذا ما يجعل رسالة
 * "محفوظ على الجهاز" صادقة لا مجرّد تفاؤل.
 */

import { CFG, ATTEMPT_ID } from './config.js';

const DB_NAME    = 'exam_platform';
const DB_VERSION = 1;
const LEGACY_KEY = `exam_platform_attempt_${ATTEMPT_ID}`;
const LS_PREFIX  = 'exam_store_';

/* تُستخدم من store.js ومن metrics.js معاً، فكل المخازن تُنشأ هنا دفعة واحدة. */
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
    tx.oncomplete = () => resolve(value);       // الالتزام الفعلي، لا مجرّد الطلب
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
      await this.migrateLegacy();
      return this.backend.name;
    }

    try {
      this.backend = idbBackend(await openIDB());
    } catch (error) {
      console.warn('تعذّر فتح IndexedDB — السقوط إلى localStorage:', error.message);
      this.backend = localBackend();
    }
    await this.migrateLegacy();
    return this.backend.name;
  },

  /* ترحيل لمرة واحدة من المفتاح القديم، حتى لا يخسر طالب في منتصف اختبار
     إجاباته عند نشر النسخة الجديدة. */
  async migrateLegacy() {
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); }
    catch (_) { return; }
    if (!legacy) return;

    try {
      for (const [questionId, old] of Object.entries(legacy.answers || {})) {
        if (!old || !old.value) continue;
        await this.put('answers', {
          question_id: Number(questionId),
          value: old.value,
          version: old.version || 1,
          sync: old.synced ? 'synced' : 'local',
          updated_at: legacy.savedAt || Date.now(),
        });
      }
      if (legacy.studentName) await this.put('meta', { key: 'studentName', value: legacy.studentName });
      if (legacy.deadline)    await this.put('meta', { key: 'deadline',    value: legacy.deadline });
      localStorage.removeItem(LEGACY_KEY);
      console.info('تم ترحيل النسخة المحلية القديمة إلى', this.backend.name);
    } catch (error) {
      console.warn('فشل الترحيل من النسخة القديمة:', error.message);
    }
  },

  put(store, record) { return this.backend.put(store, record); },
  get(store, key)    { return this.backend.get(store, key); },
  all(store)         { return this.backend.all(store); },
  del(store, key)    { return this.backend.del(store, key); },
  clear(store)       { return this.backend.clear(store); },

  /* تُستدعى بعد التسليم — سجلّ الأحداث يبقى لأن اللوحة تقرأه. */
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
