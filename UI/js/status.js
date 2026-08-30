/* The save-status indicator — a small state machine.
 *
 * State order under optimistic updates:
 *   answer selected -> local (within ~2 ms) -> sending -> synced
 * And when the server cannot be reached: -> offline, which it leaves on its own
 * once the service returns.
 *
 * Two rules keep the indicator from lying:
 *  1. Staleness guard: every call bumps seq, so a late reply cannot trample a
 *     newer state.
 *  2. No flicker: "syncing" only appears once the request outlives
 *     syncingDelayMs.
 */

import { CFG } from './config.js';
import { $ } from './dom.js';

/* Under the baseline profile (no local copy) "saved on this device" would be a
   lie, and so would promising a retry that never runs. The wording follows the
   configuration that is actually in effect. */
const hasLocalCopy = () => CFG.storage !== 'memory';
const retryClause = (retryIn) =>
  (retryIn === null || retryIn === undefined ? '' : `، إعادة المحاولة بعد ${seconds(retryIn)} ث`);

const LABELS = {
  idle:    () => '— لم تبدأ الإجابة بعد',
  local:   (d) => (d.pending > 0
                    ? `✓ محفوظ على الجهاز — ${d.pending} بانتظار المزامنة`
                    : '✓ محفوظ على الجهاز'),
  sending: (d) => (d.pending > 0
                    ? `⟳ جاري المزامنة… (${d.pending})`
                    : '⟳ جاري المزامنة…'),
  synced:  (d) => `✓ محفوظ — ${new Date(d.at || Date.now()).toLocaleTimeString('ar-SY')}`,
  offline: (d) => (hasLocalCopy()
                    ? `⚠ محفوظ على الجهاز — بانتظار الاتصال${retryClause(d.retryIn)}`
                    : `⚠ لا يوجد اتصال ولا نسخة محلية — لا تغلق الصفحة${retryClause(d.retryIn)}`),
  error:   (d) => (hasLocalCopy()
                    ? `⚠ تعذّر الحفظ على الخادم — محفوظ على الجهاز${retryClause(d.retryIn)}`
                    : `⚠ تعذّر الحفظ على الخادم — لا نسخة محلية${retryClause(d.retryIn)}`),
  at_risk: () => '⚠ تعذّر الحفظ على هذا الجهاز — أبقِ الصفحة مفتوحة',
};

/* Red is reserved for at_risk and server errors; a disconnect is a warning
   colour, not a danger one. */
const CLASSES = {
  idle: '', local: 'local', sending: 'saving', synced: 'saved',
  offline: 'offline', error: 'error', at_risk: 'error',
};

const seconds = (ms) => Math.max(1, Math.round((ms || 0) / 1000));

let seq = 0;
let sendingTimer = null;
let currentKind = 'idle';

export function currentStatus() { return currentKind; }

export function setStatus(kind, data = {}) {
  const mine = ++seq;

  if (kind === 'sending' && CFG.syncingDelayMs > 0) {
    clearTimeout(sendingTimer);
    sendingTimer = setTimeout(() => {
      if (mine === seq) paint('sending', data);   // still the newest state
    }, CFG.syncingDelayMs);
    return;
  }

  clearTimeout(sendingTimer);
  paint(kind, data);
}

function paint(kind, data) {
  currentKind = kind;
  const el = $('save-status');
  if (!el) return;
  el.className = `save-status ${CLASSES[kind] || ''}`.trim();
  el.textContent = (LABELS[kind] || LABELS.idle)(data);
}
