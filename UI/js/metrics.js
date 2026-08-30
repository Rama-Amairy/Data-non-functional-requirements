/* The measurement log the comparison dashboard reads.
 *
 * Events always go to IndexedDB whatever storage backend was chosen for the
 * answers, because they are the measuring instrument and not part of the
 * mechanism under test: holding them in memory during a baseline run would
 * lose exactly the results we set out to compare.
 *
 * BroadcastChannel delivers each event to the dashboard tab immediately, and
 * IndexedDB keeps it across a page reload.
 */

import { openIDB } from './store.js';
import { profileName } from './config.js';

let dbPromise = null;

function eventsDb() {
  if (!dbPromise) dbPromise = openIDB().catch(() => null);
  return dbPromise;
}

let bus = null;
try { bus = new BroadcastChannel('exam-metrics'); } catch (_) { /* older browser */ }

export function logEvent(type, payload = {}) {
  const event = { t: Date.now(), type, payload, profile: profileName() };

  if (bus) { try { bus.postMessage(event); } catch (_) { /* ignore */ } }

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

/* Receives dashboard messages (live config updates). BroadcastChannel does not
   deliver a message back to its sender, so the exam page never receives its own
   events. */
export function onBusMessage(handler) {
  if (!bus) return;
  bus.addEventListener('message', (event) => handler(event.data));
}

export function postBus(message) {
  if (bus) { try { bus.postMessage(message); } catch (_) { /* ignore */ } }
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
