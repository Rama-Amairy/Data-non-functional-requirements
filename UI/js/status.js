/* مؤشّر حالة الحفظ — آلة حالات صغيرة.
 *
 * ترتيب الحالات في التحديث التفاؤلي:
 *   اختيار إجابة → local (خلال ~2 ملي ثانية) → sending → synced
 * وعند تعذّر الوصول إلى الخادم: → offline، ويخرج منها تلقائياً عند عودة الخدمة.
 *
 * قاعدتان تحميان المؤشّر من الكذب:
 *  1. حارس التقادم: كل نداء يزيد seq، فلا يستطيع ردّ متأخّر أن يدهس حالة أحدث.
 *  2. لا وميض: "جاري المزامنة" لا تظهر إلا إذا تجاوز الطلب syncingDelayMs.
 */

import { CFG } from './config.js';
import { $ } from './dom.js';

const LABELS = {
  idle:    () => '— لم تبدأ الإجابة بعد',
  local:   (d) => (d.pending > 0
                    ? `✓ محفوظ على الجهاز — ${d.pending} بانتظار المزامنة`
                    : '✓ محفوظ على الجهاز'),
  sending: (d) => (d.pending > 0
                    ? `⟳ جاري المزامنة… (${d.pending})`
                    : '⟳ جاري المزامنة…'),
  synced:  (d) => `✓ محفوظ — ${new Date(d.at || Date.now()).toLocaleTimeString('ar-SY')}`,
  offline: (d) => `⚠ محفوظ على الجهاز — بانتظار الاتصال، إعادة المحاولة بعد ${seconds(d.retryIn)} ث`,
  error:   (d) => `⚠ تعذّر الحفظ على الخادم — إعادة المحاولة بعد ${seconds(d.retryIn)} ث`,
  at_risk: () => '⚠ تعذّر الحفظ على هذا الجهاز — أبقِ الصفحة مفتوحة',
};

/* الأحمر محجوز لـ at_risk وأخطاء الخادم؛ الانقطاع لونه تحذيري لا خطر. */
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
      if (mine === seq) paint('sending', data);   // ما زالت أحدث حالة
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
