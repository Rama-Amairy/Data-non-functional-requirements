/* fetch wrapper: an explicit timeout plus fault injection for the experiment.
 *
 * Fault injection only applies when the caller passes chaos: true — that is, on
 * the save and probe paths but not on login or fetching the exam, so a session
 * can never fail to start at random.
 */

import { CFG } from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* A network or timeout error — the indicator tells it apart from an error
   the server actually replied with. */
export class NetworkError extends Error {
  constructor(message) { super(message); this.name = 'NetworkError'; }
}

export async function api(path, options = {}) {
  const { chaos = false, timeout = CFG.requestTimeoutMs, ...init } = options;

  if (chaos) {
    if (CFG.extraLatencyMs > 0) await sleep(CFG.extraLatencyMs);
    if (CFG.simulateOffline) throw new NetworkError('انقطاع محاكى من اللوحة');
    if (CFG.failRate > 0 && Math.random() < CFG.failRate) {
      throw new NetworkError('فشل محاكى من اللوحة');
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json()).detail || detail; } catch (_) { /* response carried no JSON */ }
      const error = new Error(detail);
      error.status = res.status;
      throw error;
    }

    return res.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new NetworkError(`انتهت المهلة بعد ${timeout} ملي ثانية`);
    }
    if (error instanceof TypeError) {          // how fetch reports a network failure
      throw new NetworkError('تعذّر الوصول إلى الخادم');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
