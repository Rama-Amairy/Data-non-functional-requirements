/* لوحة قياس آليات التعافي.
 *
 * تعمل على /static/dashboard.html بنفس أصل التطبيق، فتقرأ /api/v1 مباشرة.
 * مصدر أرقامها هو مخزن events في IndexedDB نفسه الذي تكتب فيه صفحة الاختبار،
 * إضافة إلى بثّ حيّ عبر BroadcastChannel يجعل اللوحة تتحرّك بينما تُجرى التجربة
 * في التبويب المجاور.
 */

import { API_BASE, CFG, CFG_KEY, DEFAULTS } from './config.js';
import { readEvents, clearEvents, onBusMessage, postBus } from './metrics.js';

/* ---------------------- وصف المقابض ---------------------- */

const KNOBS = [
  { key: 'autosaveIntervalMs', label: 'دورة الحفظ التلقائي (م.ث)', type: 'number', min: 500,  step: 500,  live: true,  note: 'RPO ≈ الدورة + زمن الطلب' },
  { key: 'saveDebounceMs',     label: 'الحفظ بعد آخر نقرة (م.ث)',  type: 'number', min: 0,    step: 100,  live: true,  note: '0 = إرسال فوري' },
  { key: 'syncingDelayMs',     label: 'تأخير إظهار «جاري المزامنة»', type: 'number', min: 0,  step: 50,   live: true,  note: 'يمنع وميض الحالة' },
  { key: 'requestTimeoutMs',   label: 'مهلة الطلب (م.ث)',           type: 'number', min: 500,  step: 500,  live: true },
  { key: 'retryBaseMs',        label: 'أساس التراجع الأسّي (م.ث)',  type: 'number', min: 100,  step: 100,  live: true },
  { key: 'retryMaxMs',         label: 'سقف الانتظار (م.ث)',         type: 'number', min: 1000, step: 1000, live: true },
  { key: 'maxRetries',         label: 'أقصى عدد محاولات',            type: 'number', min: 0,    step: 1,    live: true,  note: '0 = بلا حد' },
  { key: 'healthProbeMs',      label: 'نبض /health (م.ث)',          type: 'number', min: 1000, step: 500,  live: true },
  { key: 'batchMax',           label: 'أقصى إجابات في الدفعة',       type: 'number', min: 1,    step: 1,    live: true },
  { key: 'extraLatencyMs',     label: 'تأخير صناعي قبل الحفظ (م.ث)', type: 'number', min: 0,   step: 100,  live: true },
  { key: 'failRate',           label: 'نسبة الفشل العشوائي (0–1)',   type: 'number', min: 0, max: 1, step: 0.05, live: true },
  { key: 'storage',            label: 'محرّك التخزين المحلي',        type: 'select', live: false,
    options: [['indexeddb', 'IndexedDB'], ['localstorage', 'localStorage'], ['memory', 'بلا نسخة محلية']] },
  { key: 'useAutosave',        label: 'الحفظ التلقائي وإعادة المحاولة', type: 'switch', live: false },
  { key: 'useOptimistic',      label: 'التحديث التفاؤلي',               type: 'switch', live: false },
  { key: 'simulateOffline',    label: 'قطع الاتصال (محاكى)',            type: 'switch', live: true },
];

const PRESETS = {
  baseline:  { ...DEFAULTS, useAutosave: false, useOptimistic: false, storage: 'memory', saveDebounceMs: 0 },
  protected: { ...DEFAULTS },
  fast:      { ...DEFAULTS, autosaveIntervalMs: 5000 },
};

const $ = (id) => document.getElementById(id);

let events = [];
let redrawTimer = null;

/* ---------------------- الإقلاع ---------------------- */

async function boot() {
  renderKnobs();
  wireActions();

  events = await readEvents();
  redraw();

  onBusMessage((message) => {
    if (!message || message.type === 'cfg:update') return;   // رسائل إعداد لا أحداث
    events.push(message);
    scheduleRedraw();
  });

  pollHealth();
  setInterval(pollHealth, 5000);
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(redraw, 180);
}

function redraw() {
  const current = currentProfile();
  const grouped = groupByProfile(events);

  renderTiles(summarize(grouped[current] || []), current);
  renderCompare(summarize(grouped.baseline || []), summarize(grouped.protected || []));
  renderChart(seriesFrom(events), summarize(events).outages);
  renderLog(events);

  $('pill-profile').textContent = `الملف: ${current === 'protected' ? 'الحماية الكاملة' : 'خط الأساس'}`;
  $('pill-profile').className = `pill ${current === 'protected' ? 'up' : 'warn'}`;
}

/* ---------------------- الإعدادات ---------------------- */

function storedConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch (_) { return { ...DEFAULTS }; }
}

function currentProfile() {
  const c = storedConfig();
  return (c.useAutosave && c.useOptimistic && c.storage !== 'memory') ? 'protected' : 'baseline';
}

function renderKnobs() {
  const config = storedConfig();
  const box = $('knobs');
  box.innerHTML = '';

  for (const knob of KNOBS) {
    const wrap = document.createElement('div');
    wrap.className = 'knob' + (knob.type === 'switch' ? ' switch' : '');

    if (knob.type === 'switch') {
      const row = document.createElement('div');
      row.className = 'row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `k-${knob.key}`;
      input.checked = Boolean(config[knob.key]);
      if (knob.live) input.addEventListener('change', () => applyConfig({ silent: true }));
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = knob.label;
      row.append(input, label);
      wrap.appendChild(row);
    } else if (knob.type === 'select') {
      const label = document.createElement('label');
      label.htmlFor = `k-${knob.key}`;
      label.textContent = knob.label;
      const select = document.createElement('select');
      select.id = `k-${knob.key}`;
      for (const [value, text] of knob.options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        option.selected = config[knob.key] === value;
        select.appendChild(option);
      }
      wrap.append(label, select);
    } else {
      const label = document.createElement('label');
      label.htmlFor = `k-${knob.key}`;
      label.textContent = knob.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.id = `k-${knob.key}`;
      input.value = config[knob.key];
      if (knob.min !== undefined)  input.min = knob.min;
      if (knob.max !== undefined)  input.max = knob.max;
      if (knob.step !== undefined) input.step = knob.step;
      wrap.append(label, input);
    }

    if (knob.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = knob.note;
      wrap.appendChild(note);
    }
    box.appendChild(wrap);
  }
}

function readForm() {
  const patch = {};
  for (const knob of KNOBS) {
    const el = $(`k-${knob.key}`);
    if (!el) continue;
    if (knob.type === 'switch')      patch[knob.key] = el.checked;
    else if (knob.type === 'select') patch[knob.key] = el.value;
    else {
      const value = Number(el.value);
      patch[knob.key] = Number.isFinite(value) ? value : DEFAULTS[knob.key];
    }
  }
  return patch;
}

function applyConfig({ silent = false } = {}) {
  const before = storedConfig();
  const patch = readForm();

  localStorage.setItem(CFG_KEY, JSON.stringify(patch));

  /* بثّ القيم القابلة للتغيير الحيّ إلى تبويب الاختبار. */
  const live = {};
  for (const knob of KNOBS) if (knob.live) live[knob.key] = patch[knob.key];
  postBus({ type: 'cfg:update', patch: live });

  const structural = KNOBS.filter((k) => !k.live).some((k) => before[k.key] !== patch[k.key]);
  $('reload-note').classList.toggle('hidden', !structural);

  if (!silent) redraw();
  else $('pill-profile').textContent = `الملف: ${currentProfile() === 'protected' ? 'الحماية الكاملة' : 'خط الأساس'}`;
}

function wireActions() {
  $('btn-apply').addEventListener('click', () => applyConfig());
  $('btn-reset').addEventListener('click', () => {
    localStorage.removeItem(CFG_KEY);
    renderKnobs();
    applyConfig();
  });

  for (const [name, preset] of Object.entries(PRESETS)) {
    const button = $(`preset-${name}`);
    if (!button) continue;
    button.addEventListener('click', () => {
      localStorage.setItem(CFG_KEY, JSON.stringify(preset));
      renderKnobs();
      applyConfig();
    });
  }

  $('btn-clear').addEventListener('click', async () => {
    await clearEvents();
    events = [];
    redraw();
  });

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recovery-events-${new Date().toISOString().slice(0, 19)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

async function pollHealth() {
  const pill = $('pill-server');
  try {
    const res = await fetch(`${API_BASE}/health`);
    const body = await res.json();
    if (body.status === 'ok') {
      pill.textContent = 'الخادم: متصل · القاعدة: تعمل';
      pill.className = 'pill up';
    } else {
      pill.textContent = `الخادم: يعمل · القاعدة: ${body.database}`;
      pill.className = 'pill warn';
    }
  } catch (_) {
    pill.textContent = 'الخادم: لا يستجيب';
    pill.className = 'pill down';
  }
}

/* ---------------------- التحليل ---------------------- */

function groupByProfile(list) {
  const groups = {};
  for (const event of list) {
    const key = event.profile || 'unknown';
    (groups[key] || (groups[key] = [])).push(event);
  }
  return groups;
}

/* عمق الطابور: كل حدث يحمل عدد الإجابات التي لم تصل الخادم بعد. */
function seriesFrom(list) {
  const points = [];
  for (const event of list) {
    const p = event.payload || {};
    let depth = null;
    if (event.type === 'saved_local' && typeof p.pending === 'number') depth = p.pending;
    else if (event.type === 'sync_ok' && typeof p.pending_after === 'number') depth = p.pending_after;
    else if (event.type === 'sync_fail' && typeof p.pending === 'number') depth = p.pending;
    if (depth !== null) points.push({ t: event.t, depth, type: event.type });
  }
  return points;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(list) {
  const selected = list.filter((e) => e.type === 'answer_selected');
  const local    = list.filter((e) => e.type === 'saved_local');
  const ok       = list.filter((e) => e.type === 'sync_ok');
  const fail     = list.filter((e) => e.type === 'sync_fail');
  /* إجابة قد تصل الخادم عبر sendBeacon عند إغلاق التبويب، فيكتشفها الدمج
     عند الفتح التالي — تُحتسب واصلة، لا مفقودة. */
  const delivered = list.filter((e) => e.type === 'sync_ok' || e.type === 'reconciled');

  /* آخر اختيار لكل سؤال — هو ما يجب أن يصل الخادم. */
  const lastSelect = new Map();
  for (const event of selected) lastSelect.set(event.payload.question_id, event.t);

  const durable = [];
  let lost = 0;
  for (const [questionId, t] of lastSelect) {
    const hit = delivered.find((e) => e.t >= t && (e.payload.ids || []).includes(questionId));
    if (!hit) { lost += 1; continue; }
    if (hit.type === 'sync_ok') durable.push(hit.t - t);   // زمن المتانة من المسار العادي فقط
  }

  const perceived = local
    .map((e) => e.payload.ms)
    .filter((value) => typeof value === 'number');

  /* نوافذ الانقطاع: من أول فشل حتى أول نجاح بعده. */
  const outages = [];
  let openedAt = null;
  for (const event of list) {
    if (event.type === 'sync_fail' && openedAt === null) openedAt = event.t;
    else if (event.type === 'sync_ok' && openedAt !== null) {
      outages.push({ from: openedAt, to: event.t });
      openedAt = null;
    }
  }
  if (openedAt !== null) outages.push({ from: openedAt, to: null });

  const closed = outages.filter((o) => o.to !== null);
  const depths = seriesFrom(list).map((p) => p.depth);
  const span = list.length > 1 ? list[list.length - 1].t - list[0].t : 0;
  const requests = ok.length + fail.length;

  return {
    events: list.length,
    answers: lastSelect.size,
    lost,
    perceivedP50: percentile(perceived, 50),
    perceivedP95: percentile(perceived, 95),
    durableP50: percentile(durable, 50),
    durableP95: percentile(durable, 95),
    rpo: durable.length ? Math.max(...durable) : null,
    recovery: closed.length ? Math.max(...closed.map((o) => o.to - o.from)) : null,
    ok: ok.length,
    fail: fail.length,
    requests,
    perMinute: span > 0 ? requests / (span / 60000) : null,
    maxDepth: depths.length ? Math.max(...depths) : 0,
    nowDepth: depths.length ? depths[depths.length - 1] : 0,
    outages,
  };
}

/* ---------------------- التنسيق ---------------------- */

const dash = '—';

function ms(value) {
  if (value === null || value === undefined) return dash;
  if (value < 1000) return `${value < 10 ? value.toFixed(1) : Math.round(value)} م.ث`;
  return `${(value / 1000).toFixed(1)} ث`;
}

function number(value, digits = 1) {
  if (value === null || value === undefined) return dash;
  return value.toFixed(digits);
}

function clockTime(t) {
  return new Date(t).toLocaleTimeString('ar-SY', { hour12: false });
}

/* ---------------------- البطاقات ---------------------- */

function renderTiles(s, profile) {
  const tiles = [
    { k: 'إجابات بانتظار المزامنة', v: s.nowDepth, u: '', s: `الأقصى خلال الجلسة: ${s.maxDepth}`,
      tone: s.nowDepth === 0 ? 'good' : 'warn' },
    { k: 'إجابات لم تصل الخادم', v: s.lost, u: `من ${s.answers}`, s: 'المقياس الحاسم في المقارنة',
      tone: s.lost === 0 ? 'good' : 'bad' },
    { k: 'زمن الطمأنينة (p50)', v: ms(s.perceivedP50), u: '', s: 'من النقرة إلى «محفوظ على الجهاز»',
      tone: 'good' },
    { k: 'زمن المتانة (p50)', v: ms(s.durableP50), u: '', s: `p95: ${ms(s.durableP95)}`, tone: '' },
    { k: 'أطول زمن تعافٍ', v: ms(s.recovery), u: '', s: `${s.outages.length} انقطاع مسجّل`,
      tone: s.recovery === null ? '' : 'warn' },
    { k: 'طلبات الحفظ', v: s.requests, u: '', tone: '',
      s: `${s.ok} ناجح · ${s.fail} فاشل · ${number(s.perMinute)} طلب/دقيقة` },
  ];

  $('tiles').innerHTML = tiles.map((tile) => `
    <div class="tile ${tile.tone}">
      <div class="k">${tile.k}</div>
      <div class="v">${tile.v}${tile.u ? `<span class="u">${tile.u}</span>` : ''}</div>
      <div class="s">${tile.s}</div>
    </div>`).join('');

  $('pill-profile').dataset.profile = profile;
}

/* ---------------------- جدول المقارنة ---------------------- */

function renderCompare(base, prot) {
  const rows = [
    ['إجابات لم تصل الخادم', `${base.lost} من ${base.answers}`, `${prot.lost} من ${prot.answers}`, 'less'],
    ['RPO المقيس (أسوأ حالة)', ms(base.rpo), ms(prot.rpo), 'less'],
    ['زمن الطمأنينة p50', ms(base.perceivedP50), ms(prot.perceivedP50), 'less'],
    ['زمن الطمأنينة p95', ms(base.perceivedP95), ms(prot.perceivedP95), 'less'],
    ['زمن المتانة p50', ms(base.durableP50), ms(prot.durableP50), 'none'],
    ['زمن المتانة p95', ms(base.durableP95), ms(prot.durableP95), 'none'],
    ['أطول زمن تعافٍ', ms(base.recovery), ms(prot.recovery), 'none'],
    ['أقصى عمق للطابور', base.maxDepth, prot.maxDepth, 'none'],
    ['طلبات ناجحة / فاشلة', `${base.ok} / ${base.fail}`, `${prot.ok} / ${prot.fail}`, 'none'],
    ['طلبات في الدقيقة', number(base.perMinute), number(prot.perMinute), 'none'],
    ['أحداث مسجّلة', base.events, prot.events, 'none'],
  ];

  $('compare').innerHTML = `
    <thead>
      <tr><th>المقياس</th><th>خط الأساس</th><th>الحماية الكاملة</th></tr>
    </thead>
    <tbody>
      ${rows.map(([label, a, b]) => `
        <tr>
          <td class="metric">${label}</td>
          <td class="num">${a}</td>
          <td class="num">${b}</td>
        </tr>`).join('')}
    </tbody>`;
}

/* ---------------------- المخطّط ----------------------
   سلسلة واحدة، فلا حاجة إلى مفتاح ألوان: العنوان يسمّيها. النطاقات الحمراء
   تعني حالة (تعذّر الوصول)، لا هوية سلسلة أخرى. */

const W = 900, H = 260;
const PAD = { top: 18, right: 58, bottom: 30, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function renderChart(points, outages) {
  const wrap = $('chart-wrap');

  if (points.length === 0) {
    wrap.innerHTML = '<div class="chart-empty" id="chart-empty">لا توجد أحداث بعد. افتح الاختبار وأجب عن سؤال.</div>';
    return;
  }

  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, t0 + 1000);
  const maxDepth = Math.max(1, ...points.map((p) => p.depth));
  const step = Math.max(1, Math.ceil(maxDepth / 4));
  const yMax = step * Math.ceil(maxDepth / step);

  const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * PLOT_W;
  const y = (d) => PAD.top + PLOT_H - (d / yMax) * PLOT_H;

  /* مسار درجي: القيمة تبقى ثابتة حتى الحدث التالي. */
  let line = `M ${x(points[0].t).toFixed(1)} ${y(points[0].depth).toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    line += ` H ${x(points[i].t).toFixed(1)} V ${y(points[i].depth).toFixed(1)}`;
  }
  line += ` H ${(PAD.left + PLOT_W).toFixed(1)}`;

  const baseY = (PAD.top + PLOT_H).toFixed(1);
  const area = `${line} V ${baseY} H ${x(points[0].t).toFixed(1)} Z`;

  const gridLines = [];
  for (let d = 0; d <= yMax; d += step) {
    gridLines.push(`<line class="grid-line" x1="${PAD.left}" y1="${y(d).toFixed(1)}" x2="${PAD.left + PLOT_W}" y2="${y(d).toFixed(1)}"></line>
      <text class="axis-text" x="${PAD.left - 8}" y="${(y(d) + 4).toFixed(1)}" text-anchor="end">${d}</text>`);
  }

  const xTicks = [];
  for (let i = 0; i <= 4; i += 1) {
    const t = t0 + ((t1 - t0) * i) / 4;
    const elapsed = (t - t0) / 1000;
    const label = elapsed >= 120 ? `${Math.round(elapsed / 60)} د` : `${Math.round(elapsed)} ث`;
    xTicks.push(`<text class="axis-text" x="${x(t).toFixed(1)}" y="${H - 10}" text-anchor="middle">${label}</text>`);
  }

  const bands = outages.map((outage) => {
    const from = x(outage.from);
    const to = x(outage.to === null ? t1 : outage.to);
    const width = Math.max(2, to - from);
    return `<rect class="outage-band" x="${from.toFixed(1)}" y="${PAD.top}" width="${width.toFixed(1)}" height="${PLOT_H}"></rect>`;
  }).join('');

  const last = points[points.length - 1];
  const endX = PAD.left + PLOT_W;
  const endY = y(last.depth);

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img"
         aria-label="عمق طابور الإجابات غير المزامنة عبر زمن الجلسة، مع تظليل فترات تعذّر الوصول إلى الخادم">
      ${bands}
      ${gridLines.join('')}
      <path class="series-area" d="${area}"></path>
      <path class="series-line" d="${line}"></path>
      <circle class="endpoint" cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4.5"></circle>
      <text class="endpoint-label" x="${(endX + 9).toFixed(1)}" y="${(endY + 4).toFixed(1)}">${last.depth}</text>
      ${xTicks.join('')}
      <line class="crosshair hidden" id="crosshair" x1="0" y1="${PAD.top}" x2="0" y2="${PAD.top + PLOT_H}"></line>
      <rect id="hover-area" x="${PAD.left}" y="${PAD.top}" width="${PLOT_W}" height="${PLOT_H}" fill="transparent"></rect>
    </svg>
    <div class="tooltip" id="chart-tip"></div>`;

  wireHover(wrap, points, x, y, t0);
}

function wireHover(wrap, points, x, y, t0) {
  const svg = wrap.querySelector('svg');
  const area = wrap.querySelector('#hover-area');
  const crosshair = wrap.querySelector('#crosshair');
  const tip = wrap.querySelector('#chart-tip');

  const LABELS = { saved_local: 'حُفظ على الجهاز', sync_ok: 'وصل الخادم', sync_fail: 'تعذّر الوصول' };

  area.addEventListener('mousemove', (event) => {
    const rect = svg.getBoundingClientRect();
    const scale = W / rect.width;
    const px = (event.clientX - rect.left) * scale;

    let nearest = points[0];
    let best = Infinity;
    for (const point of points) {
      const distance = Math.abs(x(point.t) - px);
      if (distance < best) { best = distance; nearest = point; }
    }

    const cx = x(nearest.t);
    const cy = y(nearest.depth);
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    crosshair.classList.remove('hidden');

    tip.innerHTML = `${LABELS[nearest.type] || nearest.type}<br>`
      + `الطابور: <b>${nearest.depth}</b> · <b>${Math.round((nearest.t - t0) / 1000)}</b> ث · ${clockTime(nearest.t)}`;
    tip.style.left = `${(cx / scale)}px`;
    tip.style.top = `${(cy / scale)}px`;
    tip.classList.add('show');
  });

  area.addEventListener('mouseleave', () => {
    crosshair.classList.add('hidden');
    tip.classList.remove('show');
  });
}

/* ---------------------- سجلّ الأحداث ---------------------- */

const EVENT_META = {
  answer_selected:  ['اختيار إجابة', 'sel'],
  saved_local:      ['حُفظ على الجهاز', 'loc'],
  local_write_fail: ['فشل الحفظ المحلي', 'fail'],
  sync_ok:          ['مزامنة ناجحة', 'ok'],
  sync_fail:        ['مزامنة فاشلة', 'fail'],
  server_recovered: ['عادت الخدمة', 'ok'],
  reconciled:       ['تسوية مع الخادم', 'ok'],
  browser_online:   ['عاد الاتصال', 'ok'],
  browser_offline:  ['انقطع الاتصال', 'fail'],
  exam_started:     ['بدء الاختبار', ''],
  restored:         ['استعادة إجابات', 'loc'],
  submitted:        ['تسليم', 'ok'],
};

function details(event) {
  const p = event.payload || {};
  switch (event.type) {
    case 'answer_selected':  return `سؤال ${p.question_id} · إصدار ${p.version}`;
    case 'saved_local':      return `سؤال ${p.question_id} · ${ms(p.ms)} · الطابور ${p.pending}`;
    case 'sync_ok':          return `${p.n} إجابة · ${ms(p.ms)} · متبقٍّ ${p.pending_after} · ${p.reason}`;
    case 'sync_fail':        return `${p.n} إجابة · ${p.error} · الطابور ${p.pending}`;
    case 'local_write_fail': return `سؤال ${p.question_id} · ${p.error}`;
    case 'exam_started':     return `التخزين ${p.storage} · مستعادة ${p.restored_total}`;
    case 'restored':         return `${p.n} إجابة`;
    case 'reconciled':       return `${p.n} إجابة كانت على الخادم أصلاً`;
    case 'submitted':        return `${p.correct} صحيحة من ${p.answered} مُجابة`;
    default:                 return '';
  }
}

function renderLog(list) {
  const rows = [...list].reverse().slice(0, 150);

  $('log').innerHTML = `
    <thead>
      <tr><th>الوقت</th><th>الحدث</th><th>التفاصيل</th><th>الملف</th></tr>
    </thead>
    <tbody>
      ${rows.map((event) => {
        const [label, tone] = EVENT_META[event.type] || [event.type, ''];
        return `<tr>
          <td class="num">${clockTime(event.t)}</td>
          <td><span class="tag ${tone}">${label}</span></td>
          <td class="metric">${details(event)}</td>
          <td>${event.profile === 'protected' ? 'حماية' : 'أساس'}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

boot();
