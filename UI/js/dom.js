/* مساعدات DOM صغيرة مشتركة. */

export const $ = (id) => document.getElementById(id);

export function showScreen(name) {
  ['login', 'exam', 'result'].forEach((screen) => {
    const el = $(`screen-${screen}`);
    if (el) el.classList.toggle('hidden', screen !== name);
  });
}

let toastTimer = null;

export function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
