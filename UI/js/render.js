/* رسم الاختبار: شبكة الأسئلة، السؤال الحالي، شريط التقدّم.
 *
 * هذه الوحدة تستورد selectAnswer، وanswers.js لا يستورد منها شيئاً — الاتجاه
 * أحادي، والتحديث يعود عبر حدث answers:changed الذي يلتقطه main.
 */

import { $ } from './dom.js';
import { state } from './state.js';
import { selectAnswer } from './answers.js';

const KEYS = ['a', 'b', 'c', 'd'];
const KEY_LABELS = { a: 'أ', b: 'ب', c: 'ج', d: 'د' };

export function renderExam() {
  $('exam-title').textContent = state.exam.title;
  $('exam-student').textContent = `— ${state.studentName}`;
  renderNav();
  renderQuestion();
}

export function renderNav() {
  const grid = $('nav-grid');
  if (!grid || !state.exam) return;
  grid.innerHTML = '';

  state.exam.questions.forEach((question, i) => {
    const answer = state.answers[question.id];
    const button = document.createElement('button');
    button.className = 'nav-btn';
    button.textContent = i + 1;

    if (answer && answer.value) {
      button.classList.add('answered');
      if (answer.sync === 'local')   button.classList.add('pending');
      if (answer.sync === 'sending') button.classList.add('pending', 'sending');
    }
    if (i === state.index) button.classList.add('current');

    button.addEventListener('click', () => {
      state.index = i;
      renderQuestion();
      renderNav();
    });
    grid.appendChild(button);
  });

  const total = state.exam.questions.length;
  const answered = state.exam.questions.filter((q) => state.answers[q.id]?.value).length;
  $('progress-text').textContent = `أجبت عن ${answered} من ${total}`;
  $('progress-bar').style.width = `${total ? (answered / total) * 100 : 0}%`;
}

export function renderQuestion() {
  if (!state.exam) return;
  const questions = state.exam.questions;
  const question = questions[state.index];

  $('q-counter').textContent = `السؤال ${state.index + 1} من ${questions.length}`;
  $('q-text').textContent = question.text;

  const box = $('options');
  box.innerHTML = '';
  const current = state.answers[question.id]?.value;

  for (const key of KEYS) {
    const label = document.createElement('label');
    label.className = 'option' + (current === key ? ' selected' : '');
    label.dataset.key = key;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `q_${question.id}`;
    radio.value = key;
    radio.checked = current === key;
    radio.addEventListener('change', () => selectAnswer(question.id, key));

    const badge = document.createElement('span');
    badge.className = 'key';
    badge.textContent = KEY_LABELS[key];

    const text = document.createElement('span');
    text.textContent = question.options[key];

    label.append(radio, badge, text);
    box.appendChild(label);
  }

  $('btn-prev').disabled = state.index === 0;
  $('btn-next').disabled = state.index === questions.length - 1;
}

/* تحديث الاختيار دون إعادة بناء الخيارات — يحافظ على تركيز لوحة المفاتيح. */
export function syncQuestionSelection() {
  if (!state.exam) return;
  const question = state.exam.questions[state.index];
  const current = state.answers[question.id]?.value;

  for (const label of $('options').querySelectorAll('.option')) {
    const key = label.dataset.key;
    label.classList.toggle('selected', current === key);
    const radio = label.querySelector('input');
    if (radio) radio.checked = current === key;
  }
}
