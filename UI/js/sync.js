/* Sync logic: the queue, exponential backoff, and the /health probe.
 *
 * The queue is the answers store itself: every record whose sync !== 'synced'
 * is waiting to be sent. No separate outbox store is needed because ordering
 * does not matter — the server arbitrates by version per question, so the last
 * write for a question is the only one that means anything.
 *
 * Resending is entirely safe because the server accepts an answer only when
 * incoming.version >= existing.version, so a duplicate or late batch spoils
 * nothing.
 */

import { API_BASE, CFG } from './config.js';
import { api, NetworkError } from './api.js';
import { Store } from './store.js';
import { setStatus } from './status.js';
import { state, answersChanged } from './state.js';
import { logEvent } from './metrics.js';

let lastSyncAt    = null;
let backoff       = CFG.retryBaseMs;
let attempts      = 0;
let retryTimer    = null;
let debounceTimer = null;
let autosaveTimer = null;
let probeTimer    = null;

/* ---------------------- The queue ---------------------- */

export async function pendingAnswers() {
  const rows = await Store.all('answers');
  return rows
    .filter((row) => row.value && row.sync !== 'synced')
    .sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));
}

async function markSynced(sentVersions) {
  for (const [questionId, version] of Object.entries(sentVersions)) {
    const id = Number(questionId);

    const stored = await Store.get('answers', id);
    if (stored && stored.version === version) {
      stored.sync = 'synced';
      await Store.put('answers', stored);
    }

    const inMemory = state.answers[id];
    if (inMemory && inMemory.version === version) inMemory.sync = 'synced';
  }
}

function markBackToLocal(batch) {
  for (const row of batch) {
    const inMemory = state.answers[row.question_id];
    if (inMemory && inMemory.sync === 'sending') inMemory.sync = 'local';
  }
}

/* ---------------------- Flushing ---------------------- */

/* Only one flush may own the queue at a time, and a caller that finds one in
   flight waits for it and then runs its own. The earlier guard returned true
   in that case, which let submit proceed on another attempt's optimism: the
   queued answers had not landed, and the exam was graded without them. */
let inFlight = null;

export async function flush(options = {}) {
  while (inFlight) { try { await inFlight; } catch (_) { /* its own caller handled it */ } }
  inFlight = flushOnce(options);
  try { return await inFlight; } finally { inFlight = null; }
}

async function flushOnce({ reason = 'timer' } = {}) {
  if (state.submitted) return true;
  if (!state.attemptId) return true;      // no session yet — nothing to send anywhere

  const pending = await pendingAnswers();
  if (pending.length === 0) {
    /* Nothing to send: repaint the last real sync time, not a fresh one that
       would suggest a save that never happened. */
    if (lastSyncAt) setStatus('synced', { at: lastSyncAt });
    return true;
  }

  state.saving = true;
  const batch = pending.slice(0, CFG.batchMax);
  const sentVersions = Object.fromEntries(batch.map((r) => [r.question_id, r.version]));

  for (const row of batch) {
    const inMemory = state.answers[row.question_id];
    if (inMemory) inMemory.sync = 'sending';
  }
  answersChanged();
  setStatus('sending', { pending: pending.length });

  const started = performance.now();

  try {
    const response = await api(`${API_BASE}/attempts/${state.attemptId}/save`, {
      method: 'POST',
      chaos: true,
      body: JSON.stringify({
        attempt_id: state.attemptId,
        answers: batch.map((r) => ({
          question_id: r.question_id,
          selected_answer: r.value,
          version: r.version,
        })),
      }),
    });

    const roundTripMs = Math.round(performance.now() - started);

    await markSynced(sentVersions);
    backoff  = CFG.retryBaseMs;
    attempts = 0;
    stopProbe();

    /* The server rejected an older version: its copy is newer, so pull and
       merge rather than insisting. */
    if (response.skipped_count > 0) await reconcile();

    state.saving = false;
    answersChanged();

    const remaining = await pendingAnswers();

    logEvent('sync_ok', {
      n: batch.length,
      ids: batch.map((r) => r.question_id),
      ms: roundTripMs,
      saved: response.saved_count,
      skipped: response.skipped_count,
      pending_after: remaining.length,
      reason,
    });

    if (remaining.length > 0) {
      scheduleFlush(0, 'continue');
      return true;
    }

    lastSyncAt = Date.parse(response.server_time) || Date.now();
    setStatus('synced', { at: lastSyncAt });
    return true;
  } catch (error) {
    attempts += 1;
    markBackToLocal(batch);
    answersChanged();

    logEvent('sync_fail', {
      n: batch.length,
      ids: batch.map((r) => r.question_id),
      ms: Math.round(performance.now() - started),
      error: error.message,
      pending: pending.length,
      reason,
    });

    const disconnected = !navigator.onLine
      || CFG.simulateOffline
      || error instanceof NetworkError;

    setStatus(disconnected ? 'offline' : 'error', {
      pending: pending.length,
      /* Without autosave there is no retry, so do not promise one. */
      retryIn: CFG.useAutosave ? backoff : null,
    });

    scheduleRetry();
    startProbe();
    return false;
  } finally {
    state.saving = false;
  }
}

export function scheduleFlush(delay = 0, reason = 'debounce') {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => flush({ reason }), delay);
}

function scheduleRetry() {
  if (!CFG.useAutosave) return;                       // baseline: a single attempt only
  if (CFG.maxRetries > 0 && attempts >= CFG.maxRetries) return;

  clearTimeout(retryTimer);
  const jitter = Math.random() * backoff * 0.3;       // keeps every browser from retrying in lockstep
  retryTimer = setTimeout(() => flush({ reason: 'retry' }), backoff + jitter);
  backoff = Math.min(backoff * 2, CFG.retryMaxMs);
}

/* ---------------------- Probing the server ----------------------
   The offline event does not fire when the database goes down while the network
   is healthy, so this is the only way to detect the service returning in that
   case. */

function startProbe() {
  if (probeTimer || !CFG.useAutosave) return;
  probeTimer = setInterval(async () => {
    try {
      const health = await api(`${API_BASE}/health`, { chaos: true, timeout: 4000 });
      if (health.status === 'ok') {
        stopProbe();
        backoff  = CFG.retryBaseMs;
        attempts = 0;
        logEvent('server_recovered', {});
        flush({ reason: 'recovered' });
      }
    } catch (_) { /* the service is still down */ }
  }, CFG.healthProbeMs);
}

function stopProbe() {
  clearInterval(probeTimer);
  probeTimer = null;
}

/* ---------------------- The timed cycle ---------------------- */

export function startAutoSave() {
  stopAutoSave();
  if (!CFG.useAutosave) return;
  autosaveTimer = setInterval(() => flush({ reason: 'timer' }), CFG.autosaveIntervalMs);
}

export function stopAutoSave() {
  clearInterval(autosaveTimer);
  autosaveTimer = null;
  clearTimeout(retryTimer);
  clearTimeout(debounceTimer);
  stopProbe();
}

/* A last attempt as the tab closes — reads from memory because sendBeacon is
   synchronous. */
export function flushOnExit() {
  if (state.submitted || !state.attemptId) return;
  if (CFG.simulateOffline) return;      // a simulated disconnect must cut this path too

  const payload = Object.values(state.answers)
    .filter((a) => a.value && a.sync !== 'synced')
    .map((a) => ({ question_id: a.question_id, selected_answer: a.value, version: a.version }));

  if (payload.length === 0) return;

  try {
    navigator.sendBeacon(
      `${API_BASE}/attempts/${state.attemptId}/save`,
      new Blob([JSON.stringify({ attempt_id: state.attemptId, answers: payload })],
               { type: 'application/json' }),
    );
  } catch (_) { /* the browser is closing anyway */ }
}

/* ---------------------- Restore and merge ---------------------- */

export async function mergeServerAnswers(serverAnswers) {
  let restored = 0;
  const reconciled = [];        // answers that turned out to be on the server already

  for (const remote of serverAnswers) {
    if (!remote.selected_answer) continue;
    const local = state.answers[remote.question_id];

    if (!local || remote.version > local.version) {
      const record = {
        question_id: remote.question_id,
        value: remote.selected_answer,
        version: remote.version,
        sync: 'synced',
        updated_at: Date.parse(remote.updated_at) || Date.now(),
      };
      state.answers[record.question_id] = record;
      await Store.put('answers', record);
      if (local && local.sync !== 'synced') reconciled.push(record.question_id);
      restored += 1;
    } else if (local.version === remote.version && local.value === remote.selected_answer) {
      if (local.sync !== 'synced') reconciled.push(local.question_id);
      local.sync = 'synced';                  // identical: no need to resend
      await Store.put('answers', local);
    }
  }

  /* Without this event an answer that arrived via sendBeacon would look lost
     in the dashboard. */
  if (reconciled.length > 0) logEvent('reconciled', { ids: reconciled, n: reconciled.length });

  answersChanged();
  return restored;
}

export async function reconcile() {
  const server = await api(`${API_BASE}/attempts/${state.attemptId}/answers`);
  await mergeServerAnswers(server.answers);
  return server;
}
