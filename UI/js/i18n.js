/* Bilingual strings for the dashboard — Arabic and English.
 *
 * Every visible string on the dashboard lives here under one key, so the two
 * languages can never drift apart: a missing key falls back to Arabic and is
 * visible immediately rather than silently rendering an identifier.
 *
 * Static markup is translated by tagging an element with data-i18n="key";
 * anything rendered from JavaScript calls t('key') directly. Switching the
 * language flips <html lang> and <html dir>, so the whole layout mirrors
 * between right-to-left and left-to-right without a reload.
 */

export const LANG_KEY = 'ui_lang';

const STRINGS = {
  ar: {
    /* --- Shell --- */
    'page.title':        'لوحة قياس آليات التعافي',
    'head.openExam':     'فتح الاختبار في تبويب ↗',
    'head.lang':         'English',
    'head.langTitle':    'Switch to English',
    'pill.server.load':  'الخادم…',
    'pill.server.ok':    'الخادم: متصل · القاعدة: تعمل',
    'pill.server.degr':  'الخادم: يعمل · القاعدة: {db}',
    'pill.server.down':  'الخادم: لا يستجيب',
    'pill.profile':      'الملف: {name}',
    'profile.baseline':  'خط الأساس',
    'profile.protected': 'الحماية الكاملة',

    /* --- Controls --- */
    'ctl.h':             'القيم المؤثّرة',
    'ctl.hint':          'هذه هي القيم التي تغيّر سلوك النظام فعلياً. «تطبيق» يكتبها في localStorage ويبثّها إلى تبويب الاختبار فوراً؛ القيم البنيوية تحتاج إعادة تحميل ذلك التبويب.',
    'ctl.advanced':      'قيم متقدّمة (نادراً ما تُغيّر)',
    'preset.baseline':   'خط الأساس — الآليات مطفأة',
    'preset.protected':  'الحماية الكاملة',
    'preset.fast':       'دورة سريعة (5 ثوانٍ)',
    'btn.apply':         'تطبيق',
    'btn.reset':         'استعادة الافتراضيات',
    'btn.export':        'تصدير الأحداث JSON',
    'btn.clear':         'مسح سجلّ الأحداث',
    'note.reload':       'قيمة بنيوية تغيّرت — أعد تحميل تبويب الاختبار.',

    /* --- Knobs --- */
    'k.autosaveIntervalMs':   'دورة الحفظ التلقائي (م.ث)',
    'k.autosaveIntervalMs.n': 'أهم قيمة: RPO ≈ الدورة + زمن الطلب',
    'k.storage':              'محرّك التخزين المحلي',
    'k.storage.n':            '«بلا نسخة محلية» = فقدان الإجابات عند الانقطاع',
    'k.useAutosave':          'الحفظ التلقائي وإعادة المحاولة',
    'k.useAutosave.n':        'إطفاؤها يلغي التعافي التلقائي بالكامل',
    'k.simulateOffline':      'قطع الاتصال (محاكى)',
    'k.simulateOffline.n':    'أداة إحداث العطل في التجربة',
    'k.failRate':             'نسبة الفشل العشوائي (0–1)',
    'k.failRate.n':           'انقطاع متقطّع بدل انقطاع كامل',
    'k.saveDebounceMs':       'الحفظ بعد آخر نقرة (م.ث)',
    'k.saveDebounceMs.n':     '0 = إرسال فوري',
    'k.syncingDelayMs':       'تأخير إظهار «جاري المزامنة»',
    'k.requestTimeoutMs':     'مهلة الطلب (م.ث)',
    'k.retryBaseMs':          'أساس التراجع الأسّي (م.ث)',
    'k.retryMaxMs':           'سقف الانتظار (م.ث)',
    'k.maxRetries':           'أقصى عدد محاولات',
    'k.maxRetries.n':         '0 = بلا حد',
    'k.healthProbeMs':        'نبض /health (م.ث)',
    'k.batchMax':             'أقصى إجابات في الدفعة',
    'k.extraLatencyMs':       'تأخير صناعي قبل الحفظ (م.ث)',
    'k.useOptimistic':        'التحديث التفاؤلي',
    'opt.indexeddb':          'IndexedDB',
    'opt.localstorage':       'localStorage',
    'opt.memory':             'بلا نسخة محلية',

    /* --- Client tiles --- */
    'tile.pending':      'إجابات بانتظار المزامنة',
    'tile.pending.s':    'الأقصى خلال الجلسة: {max}',
    'tile.lost':         'إجابات لم تصل الخادم',
    'tile.lost.u':       'من {n}',
    'tile.lost.s':       'المقياس الحاسم في المقارنة',
    'tile.perceived':    'زمن الطمأنينة (p50)',
    'tile.perceived.s':  'من النقرة إلى «محفوظ على الجهاز»',
    'tile.durable':      'زمن المتانة (p50)',
    'tile.durable.s':    'p95: {v}',
    'tile.recovery':     'أطول زمن تعافٍ',
    'tile.recovery.s':   '{n} انقطاع مسجّل',
    'tile.requests':     'طلبات الحفظ',
    'tile.requests.s':   '{ok} ناجح · {fail} فاشل · {rate} طلب/دقيقة',

    /* --- Cluster --- */
    'cl.h':              'قاعدة البيانات: النسخ المتماثل و WAL والتحويل التلقائي',
    'cl.hint':           'حالة العقدة التي يكتب إليها التطبيق الآن، مقروءة من القاعدة نفسها كل خمس ثوانٍ. الترقية إلى عقدة أخرى تظهر هنا لحظة حدوثها.',
    'cl.role':           'دور العقدة',
    'cl.role.primary':   'أساسية',
    'cl.role.standby':   'احتياطية',
    'cl.node':           'العقدة: {node}',
    'cl.wal':            'مستوى WAL',
    'cl.wal.s':          'تأكيد الالتزام: {v}',
    'cl.sync':           'وضع النسخ',
    'cl.sync.sync':      'متزامن',
    'cl.sync.async':     'غير متزامن',
    'cl.sync.none':      'بلا نسخة',
    'cl.sync.s.sync':    'RPO = 0 · الالتزام ينتظر الاحتياطية',
    'cl.sync.s.async':   'RPO > 0 · احتمال فقدان آخر الالتزامات',
    'cl.sync.s.none':    'لا توجد عقدة احتياطية متصلة',
    'cl.standbys':       'عقد احتياطية تبثّ',
    'cl.standbys.s':     'من أصل {n} متصلة',
    'cl.lag':            'تأخّر النسخ',
    'cl.lag.s':          'بايتات WAL لم تصل قرص الاحتياطية',
    'cl.timeline':       'الخط الزمني لـ WAL',
    'cl.timeline.s':     'يزداد واحداً عند كل ترقية',
    'cl.lsn':            'موضع WAL الحالي',
    'cl.down':           'القاعدة غير قابلة للوصول — الحالة أدناه هي آخر ما رُصد. المدّة: {t}',
    'cl.nostats':        'الدور المستخدم لا يرى تفاصيل النسخ. نفّذ: GRANT pg_monitor TO {user};',
    'cl.replicas.h':     'العقد الاحتياطية',
    'cl.th.name':        'العقدة',
    'cl.th.state':       'الحالة',
    'cl.th.sync':        'النمط',
    'cl.th.sent':        'أُرسل حتى',
    'cl.th.write':       'تأخّر الكتابة',
    'cl.th.flush':       'تأخّر التثبيت',
    'cl.th.replay':      'تأخّر التطبيق',
    'cl.none':           'لا توجد عقدة احتياطية متصلة بهذه العقدة.',
    'cl.st.streaming':   'تبثّ',
    'cl.st.catchup':     'تلحق',
    'cl.st.startup':     'تبدأ',
    'cl.sy.sync':        'متزامنة',
    'cl.sy.async':       'غير متزامنة',
    'cl.sy.quorum':      'نصاب',
    'cl.sy.potential':   'مرشّحة',
    'cl.fo.h':           'تحويلات مسجّلة (قبل / بعد)',
    'cl.fo.hint':        'كل سطر هو تغيّر العقدة التي يكتب إليها التطبيق. «ترقية» تعني أن الخط الزمني تقدّم — أي أن احتياطية رُقّيت تلقائياً.',
    'cl.fo.th.at':       'الوقت',
    'cl.fo.th.kind':     'النوع',
    'cl.fo.th.before':   'قبل',
    'cl.fo.th.after':    'بعد',
    'cl.fo.th.down':     'مدّة الانقطاع',
    'cl.fo.promotion':   'ترقية تلقائية',
    'cl.fo.switch':      'تبديل عقدة',
    'cl.fo.first_seen':  'أول رصد',
    'cl.fo.none':        'لم يقع أي تحويل منذ إقلاع التطبيق.',
    'cl.tl':             'خط زمني {n}',

    /* --- Chart --- */
    'ch.h':              'عمق الطابور عبر الزمن',
    'ch.hint':           'عدد الإجابات المحفوظة على الجهاز ولم تصل الخادم بعد. النطاق الأحمر فترة تعذّر فيها الوصول — عودة المنحنى إلى الصفر بعدها هي التعافي التلقائي.',
    'ch.empty':          'لا توجد أحداث بعد. افتح الاختبار وأجب عن سؤال.',
    'ch.alt':            'عمق طابور الإجابات غير المزامنة عبر زمن الجلسة، مع تظليل فترات تعذّر الوصول إلى الخادم',
    'ch.tip.queue':      'الطابور',

    /* --- Before / after --- */
    'cmp.h':             'قبل وبعد',
    'cmp.hint':          'العمود الأول جولة والآليات مطفأة، والثاني الجولة نفسها والآليات تعمل. شغّل جولة بكل إعداد ليمتلئ العمودان.',
    'cmp.th.metric':     'المقياس',
    'cmp.th.before':     'قبل (الآليات مطفأة)',
    'cmp.th.after':      'بعد (الحماية الكاملة)',
    'cmp.th.delta':      'الفرق',
    'cmp.lost':          'إجابات لم تصل الخادم',
    'cmp.lostv':         '{lost} من {n}',
    'cmp.rpo':           'RPO المقيس (أسوأ حالة)',
    'cmp.depth':         'أقصى عمق للطابور',
    'cmp.recovery':      'أطول زمن تعافٍ',
    'cmp.perceived':     'زمن الطمأنينة p50',
    'cmp.requests':      'طلبات ناجحة / فاشلة',
    'cmp.na':            'لم تُشغَّل بعد',

    /* --- Log --- */
    'log.h':             'سجلّ الأحداث',
    'log.hint':          'النسخة الجدولية لكل ما سبق — وهي الدليل الخام الذي يُرفق بالتقرير.',
    'log.th.time':       'الوقت',
    'log.th.event':      'الحدث',
    'log.th.details':    'التفاصيل',
    'log.th.profile':    'الملف',
    'log.profile.p':     'حماية',
    'log.profile.b':     'أساس',

    /* --- Event names --- */
    'ev.answer_selected':  'اختيار إجابة',
    'ev.saved_local':      'حُفظ على الجهاز',
    'ev.local_write_fail': 'فشل الحفظ المحلي',
    'ev.sync_ok':          'مزامنة ناجحة',
    'ev.sync_fail':        'مزامنة فاشلة',
    'ev.server_recovered': 'عادت الخدمة',
    'ev.reconciled':       'تسوية مع الخادم',
    'ev.browser_online':   'عاد الاتصال',
    'ev.browser_offline':  'انقطع الاتصال',
    'ev.exam_started':     'بدء الاختبار',
    'ev.restored':         'استعادة إجابات',
    'ev.submitted':        'تسليم',
    'ev.db_down':          'القاعدة سقطت',
    'ev.db_up':            'القاعدة عادت',
    'ev.failover':         'تحويل تلقائي',

    /* --- Event details --- */
    'd.selected':   'سؤال {q} · إصدار {v}',
    'd.local':      'سؤال {q} · {ms} · الطابور {p}',
    'd.ok':         '{n} إجابة · {ms} · متبقٍّ {p} · {reason}',
    'd.fail':       '{n} إجابة · {err} · الطابور {p}',
    'd.writefail':  'سؤال {q} · {err}',
    'd.started':    'التخزين {s} · مستعادة {n}',
    'd.restored':   '{n} إجابة',
    'd.reconciled': '{n} إجابة كانت على الخادم أصلاً',
    'd.submitted':  '{c} صحيحة من {n} مُجابة',
    'd.dbdown':     '{err}',
    'd.dbup':       'انقطاع دام {t}',
    'd.failover':   '{from} ← {to}',

    /* --- Units --- */
    'u.ms':   'م.ث',
    'u.s':    'ث',
    'u.min':  'د',
    'u.byte': 'بايت',
    'u.kb':   'ك.بايت',
    'u.mb':   'م.بايت',
  },

  en: {
    /* --- Shell --- */
    'page.title':        'Recovery Mechanisms Dashboard',
    'head.openExam':     'Open the exam in a tab ↗',
    'head.lang':         'العربية',
    'head.langTitle':    'التبديل إلى العربية',
    'pill.server.load':  'Server…',
    'pill.server.ok':    'Server: up · Database: up',
    'pill.server.degr':  'Server: up · Database: {db}',
    'pill.server.down':  'Server: not responding',
    'pill.profile':      'Profile: {name}',
    'profile.baseline':  'baseline',
    'profile.protected': 'full protection',

    /* --- Controls --- */
    'ctl.h':             'The values that matter',
    'ctl.hint':          'These are the values that actually change how the system behaves. Apply writes them to localStorage and broadcasts them to the exam tab at once; structural values need that tab reloaded.',
    'ctl.advanced':      'Advanced values (rarely changed)',
    'preset.baseline':   'Baseline — mechanisms off',
    'preset.protected':  'Full protection',
    'preset.fast':       'Fast cycle (5 seconds)',
    'btn.apply':         'Apply',
    'btn.reset':         'Restore defaults',
    'btn.export':        'Export events as JSON',
    'btn.clear':         'Clear the event log',
    'note.reload':       'A structural value changed — reload the exam tab.',

    /* --- Knobs --- */
    'k.autosaveIntervalMs':   'Autosave cycle (ms)',
    'k.autosaveIntervalMs.n': 'The key value: RPO ≈ cycle + request time',
    'k.storage':              'Local storage engine',
    'k.storage.n':            '"No local copy" = answers lost on a disconnect',
    'k.useAutosave':          'Autosave and retry',
    'k.useAutosave.n':        'Off means no automatic recovery at all',
    'k.simulateOffline':      'Disconnect (simulated)',
    'k.simulateOffline.n':    'The fault injector for the experiment',
    'k.failRate':             'Random failure rate (0–1)',
    'k.failRate.n':           'Intermittent failure instead of a full outage',
    'k.saveDebounceMs':       'Save after the last click (ms)',
    'k.saveDebounceMs.n':     '0 = send immediately',
    'k.syncingDelayMs':       'Delay before showing "syncing"',
    'k.requestTimeoutMs':     'Request timeout (ms)',
    'k.retryBaseMs':          'Exponential backoff base (ms)',
    'k.retryMaxMs':           'Backoff ceiling (ms)',
    'k.maxRetries':           'Maximum retries',
    'k.maxRetries.n':         '0 = unlimited',
    'k.healthProbeMs':        '/health probe interval (ms)',
    'k.batchMax':             'Maximum answers per batch',
    'k.extraLatencyMs':       'Artificial delay before saving (ms)',
    'k.useOptimistic':        'Optimistic update',
    'opt.indexeddb':          'IndexedDB',
    'opt.localstorage':       'localStorage',
    'opt.memory':             'No local copy',

    /* --- Client tiles --- */
    'tile.pending':      'Answers awaiting sync',
    'tile.pending.s':    'Session peak: {max}',
    'tile.lost':         'Answers that never reached the server',
    'tile.lost.u':       'of {n}',
    'tile.lost.s':       'The decisive metric in the comparison',
    'tile.perceived':    'Reassurance time (p50)',
    'tile.perceived.s':  'From the click to "saved on this device"',
    'tile.durable':      'Durability time (p50)',
    'tile.durable.s':    'p95: {v}',
    'tile.recovery':     'Longest recovery time',
    'tile.recovery.s':   '{n} outage(s) recorded',
    'tile.requests':     'Save requests',
    'tile.requests.s':   '{ok} ok · {fail} failed · {rate} req/min',

    /* --- Cluster --- */
    'cl.h':              'Database: replication, WAL and failover',
    'cl.hint':           'The state of the node the app writes to right now, read from the database itself every five seconds. A promotion to another node shows up here the moment it happens.',
    'cl.role':           'Node role',
    'cl.role.primary':   'primary',
    'cl.role.standby':   'standby',
    'cl.node':           'Node: {node}',
    'cl.wal':            'WAL level',
    'cl.wal.s':          'synchronous_commit: {v}',
    'cl.sync':           'Replication mode',
    'cl.sync.sync':      'synchronous',
    'cl.sync.async':     'asynchronous',
    'cl.sync.none':      'no replica',
    'cl.sync.s.sync':    'RPO = 0 · a commit waits for the standby',
    'cl.sync.s.async':   'RPO > 0 · the last commits can be lost',
    'cl.sync.s.none':    'No standby is connected',
    'cl.standbys':       'Standbys streaming',
    'cl.standbys.s':     'out of {n} connected',
    'cl.lag':            'Replication lag',
    'cl.lag.s':          'WAL bytes not yet on the standby’s disk',
    'cl.timeline':       'WAL timeline',
    'cl.timeline.s':     'Goes up by one on every promotion',
    'cl.lsn':            'Current WAL position',
    'cl.down':           'The database is unreachable — the state below is the last observed one. Duration: {t}',
    'cl.nostats':        'The application role cannot see replication detail. Run: GRANT pg_monitor TO {user};',
    'cl.replicas.h':     'Standby nodes',
    'cl.th.name':        'Node',
    'cl.th.state':       'State',
    'cl.th.sync':        'Mode',
    'cl.th.sent':        'Sent up to',
    'cl.th.write':       'Write lag',
    'cl.th.flush':       'Flush lag',
    'cl.th.replay':      'Replay lag',
    'cl.none':           'No standby is connected to this node.',
    'cl.st.streaming':   'streaming',
    'cl.st.catchup':     'catching up',
    'cl.st.startup':     'starting',
    'cl.sy.sync':        'sync',
    'cl.sy.async':       'async',
    'cl.sy.quorum':      'quorum',
    'cl.sy.potential':   'potential',
    'cl.fo.h':           'Recorded failovers (before / after)',
    'cl.fo.hint':        'Each row is a change of the node the app writes to. "Automatic promotion" means the timeline moved forward — a standby promoted itself.',
    'cl.fo.th.at':       'Time',
    'cl.fo.th.kind':     'Kind',
    'cl.fo.th.before':   'Before',
    'cl.fo.th.after':    'After',
    'cl.fo.th.down':     'Downtime',
    'cl.fo.promotion':   'Automatic promotion',
    'cl.fo.switch':      'Node switch',
    'cl.fo.first_seen':  'First observation',
    'cl.fo.none':        'No failover since the application started.',
    'cl.tl':             'timeline {n}',

    /* --- Chart --- */
    'ch.h':              'Queue depth over time',
    'ch.hint':           'How many answers are saved on the device and have not reached the server yet. A red band is a period the server could not be reached — the curve returning to zero after it is the automatic recovery.',
    'ch.empty':          'No events yet. Open the exam and answer a question.',
    'ch.alt':            'Depth of the unsynced answer queue over the session, with the periods the server was unreachable shaded',
    'ch.tip.queue':      'Queue',

    /* --- Before / after --- */
    'cmp.h':             'Before and after',
    'cmp.hint':          'The first column is a run with the mechanisms off, the second the same run with them on. Run the exam once under each setting to fill both columns.',
    'cmp.th.metric':     'Metric',
    'cmp.th.before':     'Before (mechanisms off)',
    'cmp.th.after':      'After (full protection)',
    'cmp.th.delta':      'Difference',
    'cmp.lost':          'Answers that never reached the server',
    'cmp.lostv':         '{lost} of {n}',
    'cmp.rpo':           'Measured RPO (worst case)',
    'cmp.depth':         'Peak queue depth',
    'cmp.recovery':      'Longest recovery time',
    'cmp.perceived':     'Reassurance time p50',
    'cmp.requests':      'Requests ok / failed',
    'cmp.na':            'not run yet',

    /* --- Log --- */
    'log.h':             'Event log',
    'log.hint':          'The tabular version of everything above — the raw evidence to attach to the report.',
    'log.th.time':       'Time',
    'log.th.event':      'Event',
    'log.th.details':    'Details',
    'log.th.profile':    'Profile',
    'log.profile.p':     'protected',
    'log.profile.b':     'baseline',

    /* --- Event names --- */
    'ev.answer_selected':  'Answer selected',
    'ev.saved_local':      'Saved on the device',
    'ev.local_write_fail': 'Local write failed',
    'ev.sync_ok':          'Sync succeeded',
    'ev.sync_fail':        'Sync failed',
    'ev.server_recovered': 'Service came back',
    'ev.reconciled':       'Reconciled with the server',
    'ev.browser_online':   'Back online',
    'ev.browser_offline':  'Went offline',
    'ev.exam_started':     'Exam started',
    'ev.restored':         'Answers restored',
    'ev.submitted':        'Submitted',
    'ev.db_down':          'Database went down',
    'ev.db_up':            'Database came back',
    'ev.failover':         'Failover',

    /* --- Event details --- */
    'd.selected':   'question {q} · version {v}',
    'd.local':      'question {q} · {ms} · queue {p}',
    'd.ok':         '{n} answer(s) · {ms} · {p} left · {reason}',
    'd.fail':       '{n} answer(s) · {err} · queue {p}',
    'd.writefail':  'question {q} · {err}',
    'd.started':    'storage {s} · restored {n}',
    'd.restored':   '{n} answer(s)',
    'd.reconciled': '{n} answer(s) were already on the server',
    'd.submitted':  '{c} correct out of {n} answered',
    'd.dbdown':     '{err}',
    'd.dbup':       'outage lasted {t}',
    'd.failover':   '{from} → {to}',

    /* --- Units --- */
    'u.ms':   'ms',
    'u.s':    's',
    'u.min':  'min',
    'u.byte': 'B',
    'u.kb':   'kB',
    'u.mb':   'MB',
  },
};

export const LOCALES = { ar: 'ar-SY', en: 'en-GB' };

let lang = read();
const listeners = [];

function read() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch (_) { /* storage blocked */ }
  return 'ar';
}

export function getLang() {
  return lang;
}

export function locale() {
  return LOCALES[lang];
}

export function isRTL() {
  return lang === 'ar';
}

/* Interpolates {name} placeholders; an unknown key falls back to Arabic and
   then to the key itself, so a gap is visible rather than silent. */
export function t(key, vars) {
  let text = STRINGS[lang][key];
  if (text === undefined) text = STRINGS.ar[key];
  if (text === undefined) return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    (vars[name] === undefined ? match : String(vars[name])));
}

export function setLang(next) {
  if (next !== 'ar' && next !== 'en') return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch (_) { /* ignore */ }
  applyDirection();
  applyStatic();
  for (const listener of listeners) listener(lang);
}

export function toggleLang() {
  setLang(lang === 'ar' ? 'en' : 'ar');
}

export function onLangChange(handler) {
  listeners.push(handler);
}

export function applyDirection() {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = isRTL() ? 'rtl' : 'ltr';
}

/* Translates the static markup: data-i18n sets the text, data-i18n-title the
   tooltip. Called once at boot and again on every language switch. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  const title = root.querySelector('title');
  if (title) title.textContent = t('page.title');
}
