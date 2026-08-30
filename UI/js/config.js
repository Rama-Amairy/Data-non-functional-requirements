/* Configuration — every tunable value in the project passes through here.
 *
 * The comparison dashboard (dashboard.html) writes its overrides to
 * localStorage under the key exam_cfg, and this file merges them over the
 * defaults on page load. That is how every comparison run is carried out
 * without editing a single line of code.
 */

export const API_BASE = '/api/v1';

/* The exam and attempt ids are not constants any more: every student gets their
   own attempt, and the ids come back from POST /students/login. */

export const CFG_KEY = 'exam_cfg';

export const DEFAULTS = {
  /* --- Timing --- */
  autosaveIntervalMs: 30000,  // autosave cycle
  saveDebounceMs:      1500,  // save shortly after the last click (0 = no delay)
  syncingDelayMs:       250,  // do not show "syncing" before this delay
  requestTimeoutMs:    8000,  // request timeout before it counts as failed

  /* --- Retry --- */
  retryBaseMs:         1000,  // base of the exponential backoff
  retryMaxMs:         30000,  // ceiling on the wait between attempts
  maxRetries:             0,  // 0 = unlimited
  healthProbeMs:       5000,  // /health probe interval while disconnected
  batchMax:              50,  // most answers allowed in one request

  /* --- A/B comparison switches --- */
  storage:      'indexeddb',  // indexeddb | localstorage | memory
  useAutosave:         true,  // off: no timed cycle and no retries
  useOptimistic:       true,  // off: the indicator waits for the server reply

  /* --- Fault injection for the experiment --- */
  simulateOffline:    false,  // simulated disconnect without DevTools
  failRate:               0,  // 0..1 random failure rate
  extraLatencyMs:         0,  // artificial delay before every save request
};

function readOverrides() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }
  catch (_) { return {}; }
}

export const CFG = { ...DEFAULTS, ...readOverrides() };

/* Name of the profile the dashboard attributes events to. */
export function profileName() {
  return (CFG.useAutosave && CFG.useOptimistic && CFG.storage !== 'memory')
    ? 'protected'
    : 'baseline';
}
