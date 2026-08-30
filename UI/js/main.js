/* Entry point: event wiring and joining the modules together.
 *
 * A single <script type="module"> tag in index.html imports this file, and it
 * imports the rest. Modules are deferred by default, so they run once the DOM
 * is ready.
 */

import { API_BASE, CFG } from './config.js';
import { api } from './api.js';
import { $, showScreen, toast } from './dom.js';
import { Store } from './store.js';
import { state } from './state.js';
import { setStatus } from './status.js';
import { logEvent, onBusMessage } from './metrics.js';
import {
  flush, flushOnExit, mergeServerAnswers, pendingAnswers,
  startAutoSave, stopAutoSave,
} from './sync.js';
import { renderExam, renderNav, renderQuestion, syncQuestionSelection } from './render.js';
import { startTimer, stopTimer } from './timer.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

/* Who signed in last, kept only to prefill the login form. It lives outside the
   answers store on purpose: that store is wiped whenever the attempt changes,
   and it holds exam data, which this is not. */
const LAST_STUDENT_KEY = 'exam_last_student';

function rememberStudent(name, email) {
  try { localStorage.setItem(LAST_STUDENT_KEY, JSON.stringify({ name, email })); }
  catch (_) { /* private browsing — the prefill is a convenience, not data */ }
}

function lastStudent() {
  try { return JSON.parse(localStorage.getItem(LAST_STUDENT_KEY) || '{}'); }
  catch (_) { return {}; }
}

/* ---------------------- Boot ---------------------- */

async function boot() {
  state.storageBackend = await Store.init();

  const last = lastStudent();
  if (last.name)  $('student-name').value  = last.name;
  if (last.email) $('student-email').value = last.email;

  wireEvents();
  wireDashboardBridge();
  setStatus('idle');
}

/* ---------------------- Signing in ---------------------- */

async function startExam() {
  const name  = $('student-name').value.trim();
  const email = $('student-email').value.trim();

  if (!name) {
    $('login-error').textContent = 'الرجاء إدخال اسم الطالب.';
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    $('login-error').textContent = 'الرجاء إدخال بريد إلكتروني صحيح — هو ما يميّز كل طالب.';
    return;
  }

  const button = $('btn-start');
  button.disabled = true;
  button.textContent = 'جاري التحضير...';
  $('login-error').textContent = '';

  try {
    /* One call: creates the student the first time this email is seen, makes
       sure the exam exists, and returns the attempt this student continues
       into — their own, never anybody else's. */
    const session = await api(`${API_BASE}/students/login`, {
      method: 'POST',
      body: JSON.stringify({ name, email }),
    });

    rememberStudent(session.student_name, session.student_email);
    await openSession(session);
  } catch (error) {
    $('login-error').textContent = `تعذّر بدء الاختبار: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'ابدأ الاختبار';
  }
}

/* Opens a session returned by the server — from login or from a new attempt.
   Everything downstream (autosave, restore, submission) addresses
   state.attemptId, so binding it here is what keeps two students on this same
   browser from ever touching each other's answers. */
async function openSession(session) {
  stopTimer();
  stopAutoSave();

  state.studentId    = session.student_id;
  state.studentName  = session.student_name;
  state.studentEmail = session.student_email;
  state.examId       = session.exam_id;
  state.attemptId    = session.attempt_id;
  state.answers      = {};
  state.index        = 0;
  state.submitted    = false;
  state.deadline     = null;

  /* Bind the local store to this attempt before reading a single answer out of
     it: a different attempt means the previous student's local copy is dropped. */
  await Store.openSession(session.attempt_id);

  state.exam = await api(`${API_BASE}/exams/${session.exam_id}`);

  /* Already submitted: show the result instead of reopening a finished exam. */
  if (session.is_submitted) {
    const result = await api(`${API_BASE}/attempts/${state.attemptId}/result`);
    await Store.clearSession();
    showResult(result);
    return;
  }

  /* The local copy first — this works even when the server is unreachable. */
  await loadLocalAnswers();
  const localCount = Object.keys(state.answers).length;

  /* Then restore the server copy and merge it: the higher version wins. */
  let serverState = null;
  try {
    serverState = await api(`${API_BASE}/attempts/${state.attemptId}/answers`);
    await mergeServerAnswers(serverState.answers);
  } catch (_) {
    toast('تعذّر جلب الإجابات من الخادم — تم استخدام النسخة المحليّة.');
  }

  /* Submitted from another device while this one was away. */
  if (serverState && serverState.is_submitted) {
    const result = await api(`${API_BASE}/attempts/${state.attemptId}/result`);
    await Store.clearSession();
    showResult(result);
    return;
  }

  /* The deadline is fixed once per attempt: reloading does not hand out extra
     time, and a new attempt starts its own clock. */
  state.deadline = await Store.metaValue('deadline', null)
    || Date.now() + state.exam.duration_minutes * 60000;
  await Store.setMeta('deadline', state.deadline);

  logEvent('exam_started', {
    storage: state.storageBackend,
    attempt_id: state.attemptId,
    session: session.status,
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
}

async function loadLocalAnswers() {
  const rows = await Store.all('answers');
  state.answers = {};
  for (const row of rows) {
    if (row && row.value) state.answers[row.question_id] = row;
  }
}

/* ---------------------- A new attempt, and signing out ---------------------- */

/* A retake for the same student. Login never does this on its own, so a reload
   after submitting still shows the result rather than wiping it. */
async function startNewAttempt() {
  if (!state.studentId || !state.examId) {
    signOut();
    return;
  }

  const button = $('btn-retry');
  button.disabled = true;
  button.textContent = 'جاري التحضير...';

  try {
    const session = await api(`${API_BASE}/attempts/start`, {
      method: 'POST',
      body: JSON.stringify({ student_id: state.studentId, exam_id: state.examId }),
    });
    await openSession(session);
  } catch (error) {
    toast(`تعذّر بدء محاولة جديدة: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'محاولة جديدة';
  }
}

/* Back to the login screen so another student can sign in on this device. */
function signOut() {
  stopTimer();
  stopAutoSave();

  state.studentId = null;
  state.attemptId = null;
  state.examId    = null;
  state.exam      = null;
  state.answers   = {};
  state.index     = 0;
  state.submitted = false;
  state.deadline  = null;

  /* Clear the fields as well: leaving the previous email in place is how the
     next student would silently land in somebody else's attempt. */
  $('student-name').value = '';
  $('student-email').value = '';
  $('login-error').textContent = '';

  setStatus('idle');
  showScreen('login');
  $('student-name').focus();
}

/* ---------------------- Submission and result ---------------------- */

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

  /* Do not submit before confirming the latest answers have landed. */
  const flushed = await flush({ reason: 'submit' });
  if (!flushed
      && !confirm('تعذّر حفظ بعض الإجابات. المتابعة قد تُفقدها — هل تريد التسليم؟')) {
    button.disabled = false;
    button.textContent = 'تسليم الاختبار';
    return;
  }

  try {
    const result = await api(`${API_BASE}/attempts/${state.attemptId}/submit`, { method: 'POST' });
    state.submitted = true;
    stopTimer();
    stopAutoSave();
    logEvent('submitted', {
      attempt_id: state.attemptId,
      correct: result.correct_count,
      answered: result.answered_count,
    });
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
  $('result-student').textContent = state.studentName
    ? `الطالب: ${state.studentName} · ${state.studentEmail}`
    : '';
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

/* ---------------------- Dashboard bridge ----------------------
   The dashboard broadcasts config changes, which are applied here live without
   a page reload. Structural values (the storage backend and the A/B switches)
   need a reload, so they are not applied here. */

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

/* ---------------------- Event wiring ---------------------- */

function wireEvents() {
  $('btn-start').addEventListener('click', startExam);
  for (const id of ['student-name', 'student-email']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') startExam(); });
  }

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
  $('btn-retry').addEventListener('click', startNewAttempt);
  $('btn-signout').addEventListener('click', signOut);

  /* Repaint after any change to the answers or to their sync state. */
  document.addEventListener('answers:changed', () => {
    renderNav();
    syncQuestionSelection();
  });

  document.addEventListener('exam:timeup', () => {
    toast('انتهى الوقت — يجري التسليم التلقائي.');
    submitExam({ auto: true });
  });

  /* Network signals: resume saving as soon as the connection returns. */
  window.addEventListener('online', () => {
    logEvent('browser_online', {});
    toast('عاد الاتصال — تجري إعادة المزامنة.');
    flush({ reason: 'online' });
  });
  window.addEventListener('offline', () => {
    logEvent('browser_offline', {});
    pendingAnswers().then((pending) => {
      setStatus('offline', {
        pending: pending.length,
        retryIn: CFG.useAutosave ? CFG.retryBaseMs : null,
      });
    });
  });

  /* Timers are throttled in a hidden tab, so flush when it comes back. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
    else if (!state.submitted && state.exam) flush({ reason: 'visible' });
  });
  window.addEventListener('pagehide', flushOnExit);
}

boot();
