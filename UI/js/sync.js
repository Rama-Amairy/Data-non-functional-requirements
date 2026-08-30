/* منطق المزامنة: الطابور، التراجع الأسّي، والنبض على /health.
 *
 * الطابور هو مخزن answers نفسه: كل سجلّ حالته sync !== 'synced' ينتظر الإرسال.
 * لا حاجة إلى مخزن outbox منفصل لأن الترتيب لا يهمّ — الخادم يحكّم بالإصدار
 * لكل سؤال على حدة، فآخر كتابة لسؤال هي الوحيدة التي تعني شيئاً.
 *
 * إعادة الإرسال آمنة تماماً لأن الخادم يقبل الإجابة فقط عندما
 * incoming.version >= existing.version، فدفعة مكرّرة أو متأخّرة لا تفسد شيئاً.
 */

import { API_BASE, ATTEMPT_ID, CFG } from './config.js';
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

/* ---------------------- الطابور ---------------------- */

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

/* ---------------------- التصريف ---------------------- */

export async function flush({ reason = 'timer' } = {}) {
  if (state.saving || state.submitted) return true;

  const pending = await pendingAnswers();
  if (pending.length === 0) {
    /* لا شيء لإرساله: أعد رسم آخر وقت مزامنة حقيقي، لا وقتاً جديداً يوحي بحفظ لم يحدث. */
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
    const response = await api(`${API_BASE}/attempts/${ATTEMPT_ID}/save`, {
      method: 'POST',
      chaos: true,
      body: JSON.stringify({
        attempt_id: ATTEMPT_ID,
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

    /* الخادم رفض إصداراً أقدم: نسخته أحدث، فاسحب واندمج بدل الإصرار. */
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
      retryIn: backoff,
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
  if (!CFG.useAutosave) return;                       // خط الأساس: محاولة واحدة فقط
  if (CFG.maxRetries > 0 && attempts >= CFG.maxRetries) return;

  clearTimeout(retryTimer);
  const jitter = Math.random() * backoff * 0.3;       // يمنع تزامن كل المتصفّحات دفعةً
  retryTimer = setTimeout(() => flush({ reason: 'retry' }), backoff + jitter);
  backoff = Math.min(backoff * 2, CFG.retryMaxMs);
}

/* ---------------------- النبض على الخادم ----------------------
   حدث offline لا يُطلق عندما تسقط قاعدة البيانات والشبكة سليمة، فهذه هي
   الطريقة الوحيدة لاكتشاف عودة الخدمة في تلك الحالة. */

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
    } catch (_) { /* ما زالت الخدمة ساقطة */ }
  }, CFG.healthProbeMs);
}

function stopProbe() {
  clearInterval(probeTimer);
  probeTimer = null;
}

/* ---------------------- الدورة الزمنية ---------------------- */

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

/* محاولة أخيرة عند إغلاق التبويب — تقرأ من الذاكرة لأن sendBeacon متزامن. */
export function flushOnExit() {
  if (state.submitted) return;
  if (CFG.simulateOffline) return;      // الانقطاع المحاكى يجب أن يقطع هذا المسار أيضاً

  const payload = Object.values(state.answers)
    .filter((a) => a.value && a.sync !== 'synced')
    .map((a) => ({ question_id: a.question_id, selected_answer: a.value, version: a.version }));

  if (payload.length === 0) return;

  try {
    navigator.sendBeacon(
      `${API_BASE}/attempts/${ATTEMPT_ID}/save`,
      new Blob([JSON.stringify({ attempt_id: ATTEMPT_ID, answers: payload })],
               { type: 'application/json' }),
    );
  } catch (_) { /* المتصفّح يغلق على أي حال */ }
}

/* ---------------------- الاستعادة والدمج ---------------------- */

export async function mergeServerAnswers(serverAnswers) {
  let restored = 0;
  const reconciled = [];        // إجابات تبيّن أنها على الخادم أصلاً

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
      local.sync = 'synced';                  // متطابقة: لا داعي لإعادة الإرسال
      await Store.put('answers', local);
    }
  }

  /* بلا هذا الحدث تبدو الإجابة التي وصلت عبر sendBeacon وكأنها مفقودة في اللوحة. */
  if (reconciled.length > 0) logEvent('reconciled', { ids: reconciled, n: reconciled.length });

  answersChanged();
  return restored;
}

export async function reconcile() {
  const server = await api(`${API_BASE}/attempts/${ATTEMPT_ID}/answers`);
  await mergeServerAnswers(server.answers);
  return server;
}
