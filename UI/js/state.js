/* حالة التطبيق في الذاكرة.
 *
 * سجلّ الإجابة الواحدة:
 *   { question_id, value, version, sync: 'local'|'sending'|'synced', updated_at }
 *
 * الحقل sync هو ما يلوّن شبكة الأسئلة ويغذّي المؤشّر العلوي.
 */

export const state = {
  exam: null,
  index: 0,
  answers: {},        // question_id -> record
  studentName: '',
  deadline: null,     // طابع زمني (ms) لنهاية الاختبار
  timerId: null,
  saving: false,
  submitted: false,
  storageBackend: '', // المحرّك الذي نجح فعلاً: indexeddb | localstorage | memory
};

/* يُطلق بدل استيراد render مباشرةً — يمنع الاعتماد الدائري بين answers و render. */
export function answersChanged() {
  document.dispatchEvent(new CustomEvent('answers:changed'));
}
