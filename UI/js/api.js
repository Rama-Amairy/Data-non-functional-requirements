/* غلاف fetch: مهلة زمنية صريحة + حقن الأعطال للتجربة.
 *
 * حقن الأعطال يعمل فقط عندما يمرّر المستدعي chaos: true، أي على مسار الحفظ
 * والنبض دون تسجيل الدخول وجلب الاختبار — حتى لا تفشل بداية الجلسة عشوائياً.
 */

import { CFG } from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* خطأ شبكة أو مهلة — يميّزه المؤشّر عن خطأ يردّه الخادم فعلاً. */
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
      try { detail = (await res.json()).detail || detail; } catch (_) { /* ردّ بلا JSON */ }
      const error = new Error(detail);
      error.status = res.status;
      throw error;
    }

    return res.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new NetworkError(`انتهت المهلة بعد ${timeout} ملي ثانية`);
    }
    if (error instanceof TypeError) {          // فشل الشبكة يصل هكذا من fetch
      throw new NetworkError('تعذّر الوصول إلى الخادم');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
