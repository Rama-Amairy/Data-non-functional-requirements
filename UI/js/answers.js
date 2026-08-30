/* مسار الكتابة التفاؤلي.
 *
 * ثلاث مراحل لنقرة واحدة:
 *   0 ملي ثانية  — تحديث الحالة وطلاء الواجهة، قبل أي await
 *   ~2 ملي ثانية — التزام معاملة IndexedDB، وعندها فقط تُعرض "محفوظ على الجهاز"
 *   لاحقاً       — المزامنة مع الخادم، مؤجّلة ولا تحجب أحداً
 *
 * "محفوظ على الجهاز" ليست ادّعاءً: Store.put لا تُحلّ إلا عند tx.oncomplete.
 * التفاؤل هو في الطلاء وحده.
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

  /* 1) تفاؤلي: الطالب يرى اختياره فوراً، بلا انتظار قرص ولا شبكة. */
  state.answers[record.question_id] = record;
  answersChanged();
  logEvent('answer_selected', { question_id: record.question_id, version: record.version });

  /* خط الأساس في المقارنة: لا نسخة محلية تُطمئن، والمؤشّر ينتظر ردّ الخادم. */
  if (!CFG.useOptimistic) {
    try { await Store.put('answers', record); } catch (_) { /* memory أو ممتلئ */ }
    return flush({ reason: 'immediate' });
  }

  /* 2) صادق: لا نقول "محفوظ" قبل أن تُثبَّت المعاملة فعلاً. */
  try {
    await Store.put('answers', record);
  } catch (error) {
    logEvent('local_write_fail', { question_id: record.question_id, error: error.message });
    setStatus('at_risk');
    return;                       // لا تجدول مزامنة لشيء لم يُخزَّن
  }

  const elapsedMs = Number((performance.now() - started).toFixed(2));
  const pending = await pendingAnswers();

  logEvent('saved_local', {
    question_id: record.question_id,
    ms: elapsedMs,                 // زمن الطمأنينة المحسوس
    pending: pending.length,       // عمق الطابور، تقرأه اللوحة
  });

  setStatus('local', { pending: pending.length });

  /* 3) الشبكة لاحقاً. */
  scheduleFlush(CFG.saveDebounceMs);
}
