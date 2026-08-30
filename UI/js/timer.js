/* Countdown timer.
 *
 * The deadline is fixed once and stored locally, so reloading the page does not
 * hand out extra time. When time runs out an exam:timeup event is dispatched
 * rather than calling submit directly, to avoid a cycle with main.
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
