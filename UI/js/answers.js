/* The optimistic write path.
 *
 * Three stages for a single click:
 *   0 ms    — update state and paint the UI, before any await
 *   ~2 ms   — the IndexedDB transaction commits, and only then is
 *             "saved on this device" shown
 *   later   — sync to the server, deferred and blocking nobody
 *
 * "Saved on this device" is not a claim: Store.put only resolves at
 * tx.oncomplete. The optimism lives in the painting alone.
 */

import { CFG } from './config.js';
import { Store } from './store.js';
import { setStatus } from './status.js';
import { scheduleFlush, flush, pendingAnswers } from './sync.js';
import { state, answersChanged } from './state.js';
import { logEvent } from './metrics.js';

export async function selectAnswer(questionId, value) {
  const previous = state.answers[questionId];
  const record = {
    question_id: Number(questionId),
    value,
    version: (previous?.version || 0) + 1,
    sync: 'local',
    updated_at: Date.now(),
  };
  const started = performance.now();

  /* 1) Optimistic: the student sees the choice at once, waiting on neither
     disk nor network. */
  state.answers[record.question_id] = record;
  answersChanged();
  logEvent('answer_selected', { question_id: record.question_id, version: record.version });

  /* The comparison baseline: no reassuring local copy, and the indicator
     waits for the server reply. */
  if (!CFG.useOptimistic) {
    try { await Store.put('answers', record); } catch (_) { /* memory backend, or storage full */ }
    return flush({ reason: 'immediate' });
  }

  /* 2) Honest: never say "saved" before the transaction has actually committed. */
  try {
    await Store.put('answers', record);
  } catch (error) {
    logEvent('local_write_fail', { question_id: record.question_id, error: error.message });
    setStatus('at_risk');
    return;                       // do not schedule a sync for something unstored
  }

  const elapsedMs = Number((performance.now() - started).toFixed(2));
  const pending = await pendingAnswers();

  logEvent('saved_local', {
    question_id: record.question_id,
    ms: elapsedMs,                 // the perceived reassurance time
    pending: pending.length,       // queue depth, read by the dashboard
  });

  setStatus('local', { pending: pending.length });

  /* 3) The network, later. */
  scheduleFlush(CFG.saveDebounceMs);
}
