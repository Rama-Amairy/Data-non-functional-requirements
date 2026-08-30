/* الإعدادات — كل قيمة قابلة للضبط في المشروع تمرّ من هنا.
 *
 * لوحة المقارنة (dashboard.html) تكتب التجاوزات في localStorage تحت المفتاح
 * exam_cfg، وهذا الملف يدمجها فوق الافتراضيات عند تحميل الصفحة. هكذا تُجرى كل
 * تجارب المقارنة دون تعديل أي سطر كود.
 */

export const API_BASE   = '/api/v1';
export const EXAM_ID    = 1;
export const ATTEMPT_ID = 1;

export const CFG_KEY = 'exam_cfg';

export const DEFAULTS = {
  /* --- التوقيت --- */
  autosaveIntervalMs: 30000,  // دورة الحفظ التلقائي
  saveDebounceMs:      1500,  // حفظ فوري بعد آخر نقرة (0 = بلا تأجيل)
  syncingDelayMs:       250,  // لا تُظهر "جاري المزامنة" قبل هذا التأخّر
  requestTimeoutMs:    8000,  // مهلة الطلب قبل اعتباره فاشلاً

  /* --- إعادة المحاولة --- */
  retryBaseMs:         1000,  // أساس التراجع الأسّي
  retryMaxMs:         30000,  // سقف الانتظار بين المحاولات
  maxRetries:             0,  // 0 = بلا حد
  healthProbeMs:       5000,  // نبض /health أثناء الانقطاع
  batchMax:              50,  // أقصى عدد إجابات في الطلب الواحد

  /* --- مفاتيح المقارنة A/B --- */
  storage:      'indexeddb',  // indexeddb | localstorage | memory
  useAutosave:         true,  // إطفاؤه يلغي الدورة الزمنية وإعادة المحاولة
  useOptimistic:       true,  // إطفاؤه يجعل المؤشر ينتظر ردّ الخادم

  /* --- حقن الأعطال للتجربة --- */
  simulateOffline:    false,  // قطع محاكى دون DevTools
  failRate:               0,  // 0..1 نسبة فشل عشوائي
  extraLatencyMs:         0,  // تأخير صناعي قبل كل طلب حفظ
};

function readOverrides() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }
  catch (_) { return {}; }
}

export const CFG = { ...DEFAULTS, ...readOverrides() };

/* اسم الملف التجريبي الذي تُنسب إليه الأحداث في اللوحة. */
export function profileName() {
  return (CFG.useAutosave && CFG.useOptimistic && CFG.storage !== 'memory')
    ? 'protected'
    : 'baseline';
}
