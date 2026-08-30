/* The recovery-mechanism measurement dashboard.
 *
 * It runs at /static/dashboard.html on the application's own origin, so it can
 * read /api/v1 directly. Its numbers come from three places:
 *
 *   - the IndexedDB events store the exam page writes to, plus a live
 *     BroadcastChannel feed that keeps the dashboard moving while the
 *     experiment runs in the neighbouring tab (the client-side half);
 *   - GET /api/v1/health, polled to measure how long the database is down;
 *   - GET /api/v1/cluster, polled for replication, WAL, and failover state
 *     (the server-side half).
 *
 * Database outages and failovers are written into the same events store as the
 * client-side events, so one export contains the whole picture.
 */

import { API_BASE, CFG_KEY, DEFAULTS } from './config.js';
import { readEvents, clearEvents, logEvent, onBusMessage, postBus } from './metrics.js';
import { applyDirection, applyStatic, getLang, locale, onLangChange, setLang, t } from './i18n.js';

/* ---------------------- Knob definitions ----------------------
   Split in two: the values that change what the system does, always visible,
   and everything else behind a disclosure. Both halves are read and written
   identically — the split is about attention, not capability. */

const PRIMARY_KNOBS = [
  { key: 'autosaveIntervalMs', type: 'number', min: 500, step: 500, live: true, note: true },
  { key: 'storage',            type: 'select', live: false, note: true,
    options: ['indexeddb', 'localstorage', 'memory'] },
  { key: 'useAutosave',        type: 'switch', live: false, note: true },
  { key: 'simulateOffline',    type: 'switch', live: true,  note: true },
  { key: 'failRate',           type: 'number', min: 0, max: 1, step: 0.05, live: true, note: true },
];

const ADVANCED_KNOBS = [
  { key: 'saveDebounceMs',   type: 'number', min: 0,    step: 100,  live: true, note: true },
  { key: 'syncingDelayMs',   type: 'number', min: 0,    step: 50,   live: true },
  { key: 'requestTimeoutMs', type: 'number', min: 500,  step: 500,  live: true },
  { key: 'retryBaseMs',      type: 'number', min: 100,  step: 100,  live: true },
  { key: 'retryMaxMs',       type: 'number', min: 1000, step: 1000, live: true },
  { key: 'maxRetries',       type: 'number', min: 0,    step: 1,    live: true, note: true },
  { key: 'healthProbeMs',    type: 'number', min: 1000, step: 500,  live: true },
  { key: 'batchMax',         type: 'number', min: 1,    step: 1,    live: true },
  { key: 'extraLatencyMs',   type: 'number', min: 0,    step: 100,  live: true },
  { key: 'useOptimistic',    type: 'switch', live: false },
];

const KNOBS = [...PRIMARY_KNOBS, ...ADVANCED_KNOBS];

const PRESETS = {
  baseline:  { ...DEFAULTS, useAutosave: false, useOptimistic: false, storage: 'memory', saveDebounceMs: 0 },
  protected: { ...DEFAULTS },
  fast:      { ...DEFAULTS, autosaveIntervalMs: 5000 },
};

const CLUSTER_POLL_MS = 5000;

const $ = (id) => document.getElementById(id);

let events = [];
let redrawTimer = null;

/* Latest cluster reading, plus what is needed to turn a sequence of readings
   into before/after facts: when the database went down, and which failover
   transitions have already been logged. */
let cluster = null;
let health;              // undefined until the first poll answers
let downSince = null;
let loggedFailovers = new Set();

/* ---------------------- Boot ---------------------- */

async function boot() {
  applyDirection();
  applyStatic();
  renderKnobs();
  wireActions();

  onLangChange(() => { renderKnobs(); redraw(); });

  events = await readEvents();
  redraw();

  onBusMessage((message) => {
    if (!message || message.type === 'cfg:update') return;   // config messages, not events
    events.push(message);
    scheduleRedraw();
  });

  poll();
  setInterval(poll, CLUSTER_POLL_MS);
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(redraw, 180);
}

function redraw() {
  const current = currentProfile();
  const grouped = groupByProfile(events);

  renderTiles(summarize(grouped[current] || []));
  renderServerPill();
  renderCluster();
  renderChart(seriesFrom(events), summarize(events).outages);
  renderCompare(summarize(grouped.baseline || []), summarize(grouped.protected || []));
  renderLog(events);
  renderProfilePill();
}

/* ---------------------- Configuration ---------------------- */

function storedConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch (_) { return { ...DEFAULTS }; }
}

function currentProfile() {
  const c = storedConfig();
  return (c.useAutosave && c.useOptimistic && c.storage !== 'memory') ? 'protected' : 'baseline';
}

function renderProfilePill() {
  const profile = currentProfile();
  const pill = $('pill-profile');
  pill.textContent = t('pill.profile', { name: t(`profile.${profile}`) });
  pill.className = `pill ${profile === 'protected' ? 'up' : 'warn'}`;
  pill.dataset.profile = profile;
}

function knobElement(knob, config) {
  const wrap = document.createElement('div');
  wrap.className = 'knob' + (knob.type === 'switch' ? ' switch' : '');
  const id = `k-${knob.key}`;
  const labelText = t(`k.${knob.key}`);

  if (knob.type === 'switch') {
    const row = document.createElement('div');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = Boolean(config[knob.key]);
    if (knob.live) input.addEventListener('change', () => applyConfig({ silent: true }));
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    row.append(input, label);
    wrap.appendChild(row);
  } else if (knob.type === 'select') {
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    const select = document.createElement('select');
    select.id = id;
    for (const value of knob.options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(`opt.${value}`);
      option.selected = config[knob.key] === value;
      select.appendChild(option);
    }
    wrap.append(label, select);
  } else {
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.value = config[knob.key];
    if (knob.min !== undefined)  input.min = knob.min;
    if (knob.max !== undefined)  input.max = knob.max;
    if (knob.step !== undefined) input.step = knob.step;
    wrap.append(label, input);
  }

  if (knob.note) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = t(`k.${knob.key}.n`);
    wrap.appendChild(note);
  }
  return wrap;
}

function renderKnobs() {
  const config = storedConfig();
  for (const [id, list] of [['knobs', PRIMARY_KNOBS], ['knobs-advanced', ADVANCED_KNOBS]]) {
    const box = $(id);
    box.innerHTML = '';
    for (const knob of list) box.appendChild(knobElement(knob, config));
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

  /* Merged, not replaced: a preset may set a value that has no field on the
     form, and applying afterwards must not silently drop it. */
  localStorage.setItem(CFG_KEY, JSON.stringify({ ...before, ...patch }));

  /* Broadcast the live-changeable values to the exam tab. */
  const live = {};
  for (const knob of KNOBS) if (knob.live) live[knob.key] = patch[knob.key];
  postBus({ type: 'cfg:update', patch: live });

  const structural = KNOBS.filter((k) => !k.live).some((k) => before[k.key] !== patch[k.key]);
  $('reload-note').classList.toggle('hidden', !structural);

  if (!silent) redraw();
  else renderProfilePill();
}

function wireActions() {
  $('btn-lang').addEventListener('click', () => setLang(getLang() === 'ar' ? 'en' : 'ar'));

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
    const payload = { exported_at: new Date().toISOString(), cluster, events };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recovery-events-${new Date().toISOString().slice(0, 19)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

/* ---------------------- Server polling ----------------------
   The two endpoints are polled together so a database outage and the cluster
   state it produced always carry the same timestamp. */

async function poll() {
  await Promise.all([pollHealth(), pollCluster()]);
  renderServerPill();
  renderCluster();
}

async function pollHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    health = await res.json();
  } catch (_) {
    health = null;
  }
}

function renderServerPill() {
  const pill = $('pill-server');
  if (health === undefined) {
    pill.textContent = t('pill.server.load');
    pill.className = 'pill';
  } else if (health === null) {
    pill.textContent = t('pill.server.down');
    pill.className = 'pill down';
  } else if (health.status === 'ok') {
    pill.textContent = t('pill.server.ok');
    pill.className = 'pill up';
  } else {
    pill.textContent = t('pill.server.degr', { db: health.database });
    pill.className = 'pill warn';
  }
}

/* Records an event of our own into the same store the exam page writes to, and
   into the in-memory list — BroadcastChannel does not echo to the sender. */
function record(type, payload) {
  logEvent(type, payload).then((event) => {
    events.push(event);
    scheduleRedraw();
  });
}

async function pollCluster() {
  let body;
  try {
    const res = await fetch(`${API_BASE}/cluster`);
    body = await res.json();
  } catch (error) {
    body = { reachable: false, error: String(error), replicas: [], failovers: [] };
  }

  /* Downtime: opened on the first unreachable reading, closed on the first
     reachable one — that difference is the measured RTO of the database. */
  if (!body.reachable && downSince === null) {
    downSince = Date.now();
    record('db_down', { error: body.error || '' });
  } else if (body.reachable && downSince !== null) {
    record('db_up', { ms: Date.now() - downSince });
    downSince = null;
  }

  for (const failover of body.failovers || []) {
    const id = `${failover.at}|${failover.to_node}|${failover.to_timeline}`;
    if (failover.kind === 'first_seen' || loggedFailovers.has(id)) continue;
    loggedFailovers.add(id);
    record('failover', {
      kind: failover.kind,
      from: nodeLabel(failover.from_node, failover.from_timeline),
      to: nodeLabel(failover.to_node, failover.to_timeline),
    });
  }

  /* An unreachable database keeps the last known cluster picture on screen —
     blanking it would erase exactly the evidence of what failed. */
  if (body.reachable || cluster === null) cluster = body;
  else cluster = { ...cluster, reachable: false, error: body.error, failovers: body.failovers || cluster.failovers };
}

/* ---------------------- Analysis ---------------------- */

function groupByProfile(list) {
  const groups = {};
  for (const event of list) {
    const key = event.profile || 'unknown';
    (groups[key] || (groups[key] = [])).push(event);
  }
  return groups;
}

/* Queue depth: every event carries how many answers have not reached the
   server yet. */
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
  /* An answer may reach the server via sendBeacon as the tab closes, and the
     merge on the next open discovers it — it counts as delivered, not lost. */
  const delivered = list.filter((e) => e.type === 'sync_ok' || e.type === 'reconciled');

  /* The last selection per question — that is what has to reach the server. */
  const lastSelect = new Map();
  for (const event of selected) lastSelect.set(event.payload.question_id, event.t);

  const durable = [];
  let lost = 0;
  for (const [questionId, t0] of lastSelect) {
    const hit = delivered.find((e) => e.t >= t0 && (e.payload.ids || []).includes(questionId));
    if (!hit) { lost += 1; continue; }
    if (hit.type === 'sync_ok') durable.push(hit.t - t0);   // durability time from the normal path only
  }

  const perceived = local
    .map((e) => e.payload.ms)
    .filter((value) => typeof value === 'number');

  /* Outage windows: from the first failure to the first success after it. */
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

/* ---------------------- Formatting ---------------------- */

const dash = '—';

function ms(value) {
  if (value === null || value === undefined) return dash;
  if (value < 1000) return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${t('u.ms')}`;
  return `${(value / 1000).toFixed(1)} ${t('u.s')}`;
}

function bytes(value) {
  if (value === null || value === undefined) return dash;
  if (value < 1024) return `${Math.round(value)} ${t('u.byte')}`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} ${t('u.kb')}`;
  return `${(value / (1024 * 1024)).toFixed(1)} ${t('u.mb')}`;
}

function number(value, digits = 1) {
  if (value === null || value === undefined) return dash;
  return value.toFixed(digits);
}

function clockTime(time) {
  return new Date(time).toLocaleTimeString(locale(), { hour12: false });
}

function nodeLabel(node, timeline) {
  if (!node) return dash;
  return timeline === null || timeline === undefined
    ? node
    : `${node} · ${t('cl.tl', { n: timeline })}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function tileHtml(tile) {
  return `
    <div class="tile ${tile.tone || ''}">
      <div class="k">${escapeHtml(tile.k)}</div>
      <div class="v">${escapeHtml(tile.v)}${tile.u ? `<span class="u">${escapeHtml(tile.u)}</span>` : ''}</div>
      <div class="s">${escapeHtml(tile.s || '')}</div>
    </div>`;
}

/* ---------------------- Client metric tiles ---------------------- */

function renderTiles(s) {
  const tiles = [
    { k: t('tile.pending'), v: s.nowDepth, s: t('tile.pending.s', { max: s.maxDepth }),
      tone: s.nowDepth === 0 ? 'good' : 'warn' },
    { k: t('tile.lost'), v: s.lost, u: t('tile.lost.u', { n: s.answers }), s: t('tile.lost.s'),
      tone: s.lost === 0 ? 'good' : 'bad' },
    { k: t('tile.perceived'), v: ms(s.perceivedP50), s: t('tile.perceived.s'), tone: 'good' },
    { k: t('tile.durable'), v: ms(s.durableP50), s: t('tile.durable.s', { v: ms(s.durableP95) }) },
    { k: t('tile.recovery'), v: ms(s.recovery), s: t('tile.recovery.s', { n: s.outages.length }),
      tone: s.recovery === null ? '' : 'warn' },
    { k: t('tile.requests'), v: s.requests,
      s: t('tile.requests.s', { ok: s.ok, fail: s.fail, rate: number(s.perMinute) }) },
  ];

  $('tiles').innerHTML = tiles.map(tileHtml).join('');
}

/* ---------------------- Cluster: replication, WAL, failover ---------------------- */

function renderCluster() {
  const banner = $('cluster-banner');

  if (cluster === null) {
    $('cluster-tiles').innerHTML = '';
    $('replicas').innerHTML = '';
    $('failovers').innerHTML = '';
    banner.classList.add('hidden');
    return;
  }

  if (!cluster.reachable) {
    banner.className = 'banner bad';
    banner.textContent = t('cl.down', { t: downSince ? ms(Date.now() - downSince) : dash });
  } else if (cluster.stats_visible === false) {
    banner.className = 'banner warn';
    banner.textContent = t('cl.nostats', { user: cluster.db_user || 'app_user' });
  } else {
    banner.className = 'banner hidden';
    banner.textContent = '';
  }

  const replicas = cluster.replicas || [];
  const streaming = replicas.filter((r) => r.state === 'streaming');
  const flushLag = replicas
    .map((r) => r.flush_lag_bytes)
    .filter((v) => typeof v === 'number');
  const worstLag = flushLag.length ? Math.max(...flushLag) : null;
  const sync = cluster.sync_mode || 'none';

  const dbPill = $('pill-db');
  dbPill.textContent = `${cluster.role ? t(`cl.role.${cluster.role}`) : dash} · ${t(`cl.sync.${sync}`)}`;
  dbPill.className = `pill ${!cluster.reachable ? 'down' : (sync === 'sync' ? 'up' : 'warn')}`;

  const tiles = [
    { k: t('cl.role'), v: cluster.role ? t(`cl.role.${cluster.role}`) : dash,
      s: t('cl.node', { node: cluster.node || dash }),
      tone: cluster.role === 'primary' ? 'good' : 'warn' },

    { k: t('cl.wal'), v: cluster.wal_level || dash,
      s: t('cl.wal.s', { v: cluster.synchronous_commit || dash }),
      tone: cluster.wal_level === 'replica' || cluster.wal_level === 'logical' ? 'good' : 'bad' },

    { k: t('cl.sync'), v: t(`cl.sync.${sync}`), s: t(`cl.sync.s.${sync}`),
      tone: sync === 'sync' ? 'good' : (sync === 'async' ? 'warn' : 'bad') },

    { k: t('cl.standbys'), v: streaming.length, s: t('cl.standbys.s', { n: replicas.length }),
      tone: streaming.length > 0 ? 'good' : 'bad' },

    { k: t('cl.lag'), v: bytes(worstLag), s: t('cl.lag.s'),
      tone: worstLag === 0 ? 'good' : (worstLag === null ? '' : 'warn') },

    { k: t('cl.timeline'), v: cluster.timeline === null || cluster.timeline === undefined ? dash : cluster.timeline,
      s: t('cl.timeline.s') },

    { k: t('cl.lsn'), v: cluster.current_lsn || dash, s: cluster.wal_file || '' },
  ];

  $('cluster-tiles').innerHTML = tiles.map(tileHtml).join('');
  renderReplicas(replicas);
  renderFailovers(cluster.failovers || []);
}

function stateLabel(prefix, value) {
  if (!value) return dash;
  const key = `${prefix}.${value}`;
  const label = t(key);
  return label === key ? value : label;
}

function renderReplicas(replicas) {
  const head = `
    <thead>
      <tr>
        <th>${t('cl.th.name')}</th><th>${t('cl.th.state')}</th><th>${t('cl.th.sync')}</th>
        <th>${t('cl.th.sent')}</th><th>${t('cl.th.write')}</th>
        <th>${t('cl.th.flush')}</th><th>${t('cl.th.replay')}</th>
      </tr>
    </thead>`;

  if (!replicas.length) {
    $('replicas').innerHTML = `${head}<tbody><tr><td class="metric empty" colspan="7">${t('cl.none')}</td></tr></tbody>`;
    return;
  }

  $('replicas').innerHTML = `${head}
    <tbody>
      ${replicas.map((replica) => {
        const streaming = replica.state === 'streaming';
        const isSync = replica.sync_state === 'sync' || replica.sync_state === 'quorum';
        return `<tr>
          <td class="metric">${escapeHtml(replica.name)}${replica.client_addr ? ` <span class="dim">${escapeHtml(replica.client_addr)}</span>` : ''}</td>
          <td><span class="tag ${streaming ? 'ok' : 'fail'}">${escapeHtml(stateLabel('cl.st', replica.state))}</span></td>
          <td><span class="tag ${isSync ? 'ok' : ''}">${escapeHtml(stateLabel('cl.sy', replica.sync_state))}</span></td>
          <td class="num mono">${escapeHtml(replica.sent_lsn || dash)}</td>
          <td class="num">${bytes(replica.write_lag_bytes)}</td>
          <td class="num">${bytes(replica.flush_lag_bytes)}</td>
          <td class="num">${bytes(replica.replay_lag_bytes)}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

/* The failover table is the server-side before/after: which node was written
   to before the transition, which one after it, and how long the gap was. The
   downtime column is filled from our own db_down/db_up events, matched to the
   transition they surround. */
function renderFailovers(list) {
  const head = `
    <thead>
      <tr>
        <th>${t('cl.fo.th.at')}</th><th>${t('cl.fo.th.kind')}</th>
        <th>${t('cl.fo.th.before')}</th><th>${t('cl.fo.th.after')}</th>
        <th>${t('cl.fo.th.down')}</th>
      </tr>
    </thead>`;

  const transitions = list.filter((f) => f.kind !== 'first_seen');
  if (!transitions.length) {
    $('failovers').innerHTML = `${head}<tbody><tr><td class="metric empty" colspan="5">${t('cl.fo.none')}</td></tr></tbody>`;
    return;
  }

  $('failovers').innerHTML = `${head}
    <tbody>
      ${transitions.map((failover) => {
        const at = new Date(failover.at).getTime();
        return `<tr>
          <td class="num">${clockTime(at)}</td>
          <td><span class="tag ${failover.kind === 'promotion' ? 'ok' : ''}">${t(`cl.fo.${failover.kind}`)}</span></td>
          <td class="metric">${escapeHtml(nodeLabel(failover.from_node, failover.from_timeline))}</td>
          <td class="metric">${escapeHtml(nodeLabel(failover.to_node, failover.to_timeline))}</td>
          <td class="num">${ms(downtimeAround(at))}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

/* The db_up event closest after the transition carries the outage it ended. */
function downtimeAround(time) {
  const recovery = events.find((e) => e.type === 'db_up' && e.t >= time - CLUSTER_POLL_MS);
  return recovery ? recovery.payload.ms : null;
}

/* ---------------------- The chart ----------------------
   A single series, so no colour legend is needed: the heading names it. The red
   bands mean a state (the server could not be reached), not the identity of
   another series. */

const W = 900, H = 260;
const PAD = { top: 18, right: 58, bottom: 30, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function renderChart(points, outages) {
  const wrap = $('chart-wrap');

  if (points.length === 0) {
    wrap.innerHTML = `<div class="chart-empty">${t('ch.empty')}</div>`;
    return;
  }

  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, t0 + 1000);
  const maxDepth = Math.max(1, ...points.map((p) => p.depth));
  const step = Math.max(1, Math.ceil(maxDepth / 4));
  const yMax = step * Math.ceil(maxDepth / step);

  const x = (time) => PAD.left + ((time - t0) / (t1 - t0)) * PLOT_W;
  const y = (d) => PAD.top + PLOT_H - (d / yMax) * PLOT_H;

  /* A step path: the value holds until the next event. */
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
    const time = t0 + ((t1 - t0) * i) / 4;
    const elapsed = (time - t0) / 1000;
    const label = elapsed >= 120
      ? `${Math.round(elapsed / 60)} ${t('u.min')}`
      : `${Math.round(elapsed)} ${t('u.s')}`;
    xTicks.push(`<text class="axis-text" x="${x(time).toFixed(1)}" y="${H - 10}" text-anchor="middle">${label}</text>`);
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
    <svg viewBox="0 0 ${W} ${H}" role="img" dir="ltr" aria-label="${t('ch.alt')}">
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

    tip.innerHTML = `${escapeHtml(t(`ev.${nearest.type}`))}<br>`
      + `${t('ch.tip.queue')}: <b>${nearest.depth}</b> · <b>${Math.round((nearest.t - t0) / 1000)}</b> ${t('u.s')} · ${clockTime(nearest.t)}`;
    tip.style.left = `${(cx / scale)}px`;
    tip.style.top = `${(cy / scale)}px`;
    tip.classList.add('show');
  });

  area.addEventListener('mouseleave', () => {
    crosshair.classList.add('hidden');
    tip.classList.remove('show');
  });
}

/* ---------------------- Before / after ----------------------
   Only the metrics that decide whether the mechanisms earned their place. Each
   row says which direction is an improvement, and the delta column colours the
   answer rather than leaving the reader to subtract two numbers. */

function renderCompare(before, after) {
  const rows = [
    { label: t('cmp.lost'), unit: 'count', better: 'less',
      a: before.lost, b: after.lost,
      fmt: (value, s) => t('cmp.lostv', { lost: value, n: s.answers }) },
    { label: t('cmp.rpo'),       unit: 'ms',    better: 'less', a: before.rpo,          b: after.rpo,           fmt: ms },
    { label: t('cmp.recovery'),  unit: 'ms',    better: 'less', a: before.recovery,     b: after.recovery,      fmt: ms },
    { label: t('cmp.depth'),     unit: 'count', better: 'none', a: before.maxDepth,     b: after.maxDepth,      fmt: (v) => v },
    { label: t('cmp.perceived'), unit: 'ms',    better: 'less', a: before.perceivedP50, b: after.perceivedP50,  fmt: ms },
    { label: t('cmp.requests'),  unit: 'count', better: 'none',
      a: before.ok, b: after.ok,
      fmt: (value, s) => `${s.ok} / ${s.fail}` },
  ];

  const missing = (s) => s.events === 0;

  $('compare').innerHTML = `
    <thead>
      <tr>
        <th>${t('cmp.th.metric')}</th>
        <th>${t('cmp.th.before')}</th>
        <th>${t('cmp.th.after')}</th>
        <th>${t('cmp.th.delta')}</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => {
        const aText = missing(before) ? `<span class="dim">${t('cmp.na')}</span>` : escapeHtml(String(row.fmt(row.a, before)));
        const bText = missing(after)  ? `<span class="dim">${t('cmp.na')}</span>` : escapeHtml(String(row.fmt(row.b, after)));
        return `<tr>
          <td class="metric">${escapeHtml(row.label)}</td>
          <td class="num">${aText}</td>
          <td class="num">${bText}</td>
          <td class="num">${deltaCell(row, before, after)}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

function deltaCell(row, before, after) {
  if (before.events === 0 || after.events === 0) return dash;
  if (row.better === 'none') return dash;
  if (typeof row.a !== 'number' || typeof row.b !== 'number') return dash;

  const difference = row.b - row.a;
  if (difference === 0) return `<span class="dim">${dash}</span>`;

  const improved = row.better === 'less' ? difference < 0 : difference > 0;
  const size = row.unit === 'ms' ? ms(Math.abs(difference)) : Math.abs(difference);
  return `<span class="${improved ? 'better' : 'worse'}">${difference < 0 ? '−' : '+'}${size}</span>`;
}

/* ---------------------- The event log ---------------------- */

const EVENT_TONE = {
  answer_selected: 'sel',
  saved_local: 'loc',
  local_write_fail: 'fail',
  sync_ok: 'ok',
  sync_fail: 'fail',
  server_recovered: 'ok',
  reconciled: 'ok',
  browser_online: 'ok',
  browser_offline: 'fail',
  exam_started: '',
  restored: 'loc',
  submitted: 'ok',
  db_down: 'fail',
  db_up: 'ok',
  failover: 'warn',
};

function details(event) {
  const p = event.payload || {};
  switch (event.type) {
    case 'answer_selected':  return t('d.selected', { q: p.question_id, v: p.version });
    case 'saved_local':      return t('d.local', { q: p.question_id, ms: ms(p.ms), p: p.pending });
    case 'sync_ok':          return t('d.ok', { n: p.n, ms: ms(p.ms), p: p.pending_after, reason: p.reason });
    case 'sync_fail':        return t('d.fail', { n: p.n, err: p.error, p: p.pending });
    case 'local_write_fail': return t('d.writefail', { q: p.question_id, err: p.error });
    case 'exam_started':     return t('d.started', { s: p.storage, n: p.restored_total });
    case 'restored':         return t('d.restored', { n: p.n });
    case 'reconciled':       return t('d.reconciled', { n: p.n });
    case 'submitted':        return t('d.submitted', { c: p.correct, n: p.answered });
    case 'db_down':          return t('d.dbdown', { err: p.error });
    case 'db_up':            return t('d.dbup', { t: ms(p.ms) });
    case 'failover':         return t('d.failover', { from: p.from, to: p.to });
    default:                 return '';
  }
}

function renderLog(list) {
  const rows = [...list].reverse().slice(0, 150);

  $('log').innerHTML = `
    <thead>
      <tr>
        <th>${t('log.th.time')}</th><th>${t('log.th.event')}</th>
        <th>${t('log.th.details')}</th><th>${t('log.th.profile')}</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((event) => {
        const key = `ev.${event.type}`;
        const label = t(key) === key ? event.type : t(key);
        return `<tr>
          <td class="num">${clockTime(event.t)}</td>
          <td><span class="tag ${EVENT_TONE[event.type] || ''}">${escapeHtml(label)}</span></td>
          <td class="metric">${escapeHtml(details(event))}</td>
          <td>${event.profile === 'protected' ? t('log.profile.p') : t('log.profile.b')}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

boot();
