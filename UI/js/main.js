/* نقطة الدخول: التقاط الأحداث وربط الوحدات ببعضها.
 *
 * وسم <script type="module"> واحد في index.html يستورد هذا الملف، وهو يستورد
 * البقية. الوحدات مؤجّلة افتراضياً فتنفَّذ بعد جهوز DOM.
 */

import { API_BASE, ATTEMPT_ID, CFG, profileName } from './config.js';
import { api } from './api.js';
import { $, showScreen, toast } from './dom.js';
import { Store } from './store.js';
import { state, answersChanged } from './state.js';
import { setStatus } from './status.js';
import { logEvent, onBusMessage } from './metrics.js';
import {
  flush, flushOnExit, mergeServerAnswers, pendingAnswers,
  startAutoSave, stopAutoSave,
} from './sync.js';
import { renderExam, renderNav, renderQuestion, syncQuestionSelection } from './render.js';
import { startTimer, stopTimer } from './timer.js';

/* ---------------------- الإقلاع ---------------------- */

async function boot() {
  state.storageBackend = await Store.init();
  console.info(
    `منصة الاختبارات — التخزين: ${state.storageBackend} · الملف التجريبي: ${profileName()}`,
  );

  const savedName = await Store.metaValue('studentName', '');
  if (savedName) $('student-name').value = savedName;

  wireEvents();
  wireDashboardBridge();
  setStatus('idle');
}

/* ---------------------- بدء الاختبار ---------------------- */

async function startExam() {
  const name = $('student-name').value.trim();
  if (!name) {
    $('login-error').textContent = 'الرجاء إدخال اسم الطالب.';
    return;
  }

  const button = $('btn-start');
  button.disabled = true;
  button.textContent = 'جاري التحضير...';
  $('login-error').textContent = '';

  try {
    /* نداء واحد: يجهّز البيانات التجريبية، يحفظ الاسم، ويعيد المعرّفات. */
    const session = await api(`${API_BASE}/students/demo-login`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    state.exam = await api(`${API_BASE}/exams/${session.exam_id}`);
    state.studentName = session.student_name;
    await Store.setMeta('studentName', state.studentName);

    /* النسخة المحلية أولاً — تعمل حتى لو كان الخادم غير متاح. */
    await loadLocalAnswers();
    const localCount = Object.keys(state.answers).length;

    /* ثم استعادة نسخة الخادم ودمجها: الإصدار الأعلى يفوز. */
    let serverState = null;
    try {
      serverState = await api(`${API_BASE}/attempts/${ATTEMPT_ID}/answers`);
      await mergeServerAnswers(serverState.answers);
    } catch (_) {
      toast('تعذّر جلب الإجابات من الخادم — تم استخدام النسخة المحليّة.');
    }

    if (serverState && serverState.is_submitted) {
      const result = await api(`${API_BASE}/attempts/${ATTEMPT_ID}/result`);
      await Store.clearSession();
      showResult(result);
      return;
    }

    /* الموعد النهائي يُثبَّت مرة واحدة: التحديث لا يمنح وقتاً إضافياً. */
    state.deadline = await Store.metaValue('deadline', null)
      || Date.now() + state.exam.duration_minutes * 60000;
    await Store.setMeta('deadline', state.deadline);

    logEvent('exam_started', {
      storage: state.storageBackend,
      restored_local: localCount,
      restored_total: Object.keys(state.answers).length,
    });

    renderExam();
    showScreen('exam');
    startTimer();
    startAutoSave();

    const restored = Object.keys(state.answers).length;
    if (restored > 0) {
      toast(`تمت استعادة ${restored} إجابة محفوظة.`);
      logEvent('restored', { n: restored });
    }

    const pending = await pendingAnswers();
    if (pending.length > 0) flush({ reason: 'startup' });
    else setStatus(restored > 0 ? 'synced' : 'idle', { at: Date.now() });
  } catch (error) {
    $('login-error').textContent = `تعذّر بدء الاختبار: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'ابدأ الاختبار';
  }
}

async function loadLocalAnswers() {
  const rows = await Store.all('answers');
  state.answers = {};
  for (const row of rows) {
    if (row && row.value) state.answers[row.question_id] = row;
  }
}

/* ---------------------- التسليم والنتيجة ---------------------- */

async function submitExam({ auto = false } = {}) {
  if (state.submitted) return;

  const total = state.exam.questions.length;
  const answered = state.exam.questions.filter((q) => state.answers[q.id]?.value).length;

  if (!auto) {
    const message = answered < total
      ? `لم تُجب عن ${total - answered} سؤال. هل تريد التسليم على أي حال؟`
      : 'هل تريد تسليم الاختبار؟';
    if (!confirm(message)) return;
  }

  const button = $('btn-submit');
  button.disabled = true;
  button.textContent = 'جاري التسليم...';

  /* لا تسلّم قبل التأكد من وصول آخر الإجابات. */
  const flushed = await flush({ reason: 'submit' });
  if (!flushed
      && !confirm('تعذّر حفظ بعض الإجابات. المتابعة قد تُفقدها — هل تريد التسليم؟')) {
    button.disabled = false;
    button.textContent = 'تسليم الاختبار';
    return;
  }

  try {
    const result = await api(`${API_BASE}/attempts/${ATTEMPT_ID}/submit`, { method: 'POST' });
    state.submitted = true;
    stopTimer();
    stopAutoSave();
    logEvent('submitted', { correct: result.correct_count, answered: result.answered_count });
    await Store.clearSession();
    showResult(result);
  } catch (error) {
    toast(`تعذّر التسليم: ${error.message}`);
    button.disabled = false;
    button.textContent = 'تسليم الاختبار';
  }
}

function showResult(result) {
  state.submitted = true;
  $('result-student').textContent = state.studentName ? `الطالب: ${state.studentName}` : '';
  $('res-correct').textContent = result.correct_count;
  $('res-total').textContent = result.total_questions;
  $('res-answered').textContent = result.answered_count;
  $('res-time').textContent = result.finished_at
    ? new Date(result.finished_at).toLocaleString('ar-SY')
    : '—';

  $('score-value').textContent = `${result.percentage}%`;
  $('score-ring').style.setProperty('--pct', `${result.percentage}%`);

  showScreen('result');
}

/* ---------------------- جسر لوحة المقارنة ----------------------
   اللوحة تبثّ تعديلات الإعدادات، فتُطبَّق هنا حيّاً دون تحديث الصفحة. القيم
   البنيوية (محرّك التخزين ومفاتيح A/B) تحتاج إعادة تحميل، فلا تُطبَّق هنا. */

const LIVE_KNOBS = [
  'autosaveIntervalMs', 'saveDebounceMs', 'syncingDelayMs', 'requestTimeoutMs',
  'retryBaseMs', 'retryMaxMs', 'maxRetries', 'healthProbeMs', 'batchMax',
  'simulateOffline', 'failRate', 'extraLatencyMs',
];

function wireDashboardBridge() {
  onBusMessage((message) => {
    if (!message || message.type !== 'cfg:update') return;

    let intervalChanged = false;
    for (const [key, value] of Object.entries(message.patch || {})) {
      if (!LIVE_KNOBS.includes(key)) continue;
      if (key === 'autosaveIntervalMs' && value !== CFG[key]) intervalChanged = true;
      CFG[key] = value;
    }

    if (intervalChanged && state.exam && !state.submitted) startAutoSave();
    if (message.patch && message.patch.simulateOffline === false) {
      flush({ reason: 'dashboard-reconnect' });
    }
  });
}

/* ---------------------- ربط الأحداث ---------------------- */

function wireEvents() {
  $('btn-start').addEventListener('click', startExam);
  $('student-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') startExam(); });

  $('btn-prev').addEventListener('click', () => {
    if (state.index > 0) { state.index -= 1; renderQuestion(); renderNav(); }
  });
  $('btn-next').addEventListener('click', () => {
    if (state.index < state.exam.questions.length - 1) {
      state.index += 1; renderQuestion(); renderNav();
    }
  });

  $('btn-save-now').addEventListener('click', () => flush({ reason: 'manual' }));
  $('btn-submit').addEventListener('click', () => submitExam());
  $('btn-restart').addEventListener('click', () => location.reload());

  /* إعادة الرسم بعد أي تغيير في الإجابات أو في حالة مزامنتها. */
  document.addEventListener('answers:changed', () => {
    renderNav();
    syncQuestionSelection();
  });

  document.addEventListener('exam:timeup', () => {
    toast('انتهى الوقت — يجري التسليم التلقائي.');
    submitExam({ auto: true });
  });

  /* إشارات الشبكة: استأنف الحفظ فور عودة الاتصال. */
  window.addEventListener('online', () => {
    logEvent('browser_online', {});
    toast('عاد الاتصال — تجري إعادة المزامنة.');
    flush({ reason: 'online' });
  });
  window.addEventListener('offline', () => {
    logEvent('browser_offline', {});
    pendingAnswers().then((pending) => {
      setStatus('offline', { pending: pending.length, retryIn: CFG.retryBaseMs });
    });
  });

  /* التبويب المخفي تُخنق فيه المؤقتات، فنصرّف عند العودة إليه. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
    else if (!state.submitted && state.exam) flush({ reason: 'visible' });
  });
  window.addEventListener('pagehide', flushOnExit);
}

boot();
