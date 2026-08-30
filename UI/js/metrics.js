/* سجلّ القياس الذي تقرأه لوحة المقارنة.
 *
 * الأحداث تُكتب دائماً في IndexedDB مهما كان محرّك التخزين المختار للإجابات،
 * لأنها أداة قياس لا جزء من الآلية الخاضعة للتجربة: لو خزّنّاها في الذاكرة
 * أثناء جولة خط الأساس لضاعت النتائج التي نريد مقارنتها بالضبط.
 *
 * BroadcastChannel يوصل الحدث إلى تبويب اللوحة فوراً، وIndexedDB يُبقيه بعد
 * تحديث الصفحة.
 */

import { openIDB } from './store.js';
import { profileName } from './config.js';

let dbPromise = null;

function eventsDb() {
  if (!dbPromise) dbPromise = openIDB().catch(() => null);
  return dbPromise;
}

let bus = null;
try { bus = new BroadcastChannel('exam-metrics'); } catch (_) { /* متصفّح قديم */ }

export function logEvent(type, payload = {}) {
  const event = { t: Date.now(), type, payload, profile: profileName() };

  if (bus) { try { bus.postMessage(event); } catch (_) { /* تجاهل */ } }

  return eventsDb().then((db) => {
    if (!db) return event;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('events', 'readwrite');
        tx.objectStore('events').add(event);
        tx.oncomplete = () => resolve(event);
        tx.onerror    = () => resolve(event);
      } catch (_) { resolve(event); }
    });
  }).catch(() => event);
}

/* استقبال رسائل اللوحة (تحديث الإعدادات حيّاً). BroadcastChannel لا يسلّم
   الرسالة إلى مرسِلها، فصفحة الاختبار لا تستقبل أحداثها الخاصة. */
export function onBusMessage(handler) {
  if (!bus) return;
  bus.addEventListener('message', (event) => handler(event.data));
}

export function postBus(message) {
  if (bus) { try { bus.postMessage(message); } catch (_) { /* تجاهل */ } }
}

export async function readEvents() {
  const db = await eventsDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('events', 'readonly');
      const request = tx.objectStore('events').getAll();
      request.onsuccess = () => resolve(request.result || []);
      tx.onerror = () => resolve([]);
    } catch (_) { resolve([]); }
  });
}

export async function clearEvents() {
  const db = await eventsDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('events', 'readwrite');
      tx.objectStore('events').clear();
      tx.oncomplete = resolve;
      tx.onerror    = resolve;
    } catch (_) { resolve(); }
  });
}
