/* العدّاد التنازلي.
 *
 * الموعد النهائي يُثبَّت مرة واحدة ويُخزَّن محلياً، فتحديث الصفحة لا يمنح وقتاً
 * إضافياً. عند انتهاء الوقت يُطلق حدث exam:timeup بدل استدعاء التسليم مباشرةً،
 * تفادياً للاعتماد الدائري مع main.
 */

import { $ } from './dom.js';
import { state } from './state.js';

export function startTimer() {
  clearInterval(state.timerId);
  tick();
  state.timerId = setInterval(tick, 1000);
}

export function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
}

function tick() {
  const remaining = Math.max(0, state.deadline - Date.now());
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  const el = $('timer');
  if (el) {
    el.textContent = `${minutes}:${seconds}`;
    el.className = 'timer' + (totalSeconds <= 60 ? ' danger' : totalSeconds <= 300 ? ' warn' : '');
  }

  if (remaining === 0) {
    stopTimer();
    document.dispatchEvent(new CustomEvent('exam:timeup'));
  }
}
