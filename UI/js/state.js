/* In-memory application state.
 *
 * A single answer record:
 *   { question_id, value, version, sync: 'local'|'sending'|'synced', updated_at }
 *
 * The sync field is what colours the question grid and feeds the top indicator.
 */

export const state = {
  exam: null,
  index: 0,
  answers: {},        // question_id -> record
  studentId: null,    // the signed-in student
  studentName: '',
  studentEmail: '',
  examId: null,
  attemptId: null,    // this student's own attempt — every request carries it
  deadline: null,     // timestamp (ms) of the exam deadline
  timerId: null,
  saving: false,
  submitted: false,
  storageBackend: '', // the backend that actually opened: indexeddb | localstorage | memory
};

/* Dispatched instead of importing render directly — keeps answers and render
   from depending on each other in a cycle. */
export function answersChanged() {
  document.dispatchEvent(new CustomEvent('answers:changed'));
}
