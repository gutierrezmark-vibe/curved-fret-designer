// toast.js — calm, stacked notifications.
let host = null;
const ICON = {
  info: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4M8 4.8v.01"/></svg>',
  warn: '<svg viewBox="0 0 16 16"><path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.6v3.2M8 11.6v.01"/></svg>',
  error: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"/></svg>',
  ok: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M5 8.3l2 2 4-4.4"/></svg>',
};
export function toast(message, level = 'info', { timeout = 4200 } = {}) {
  host = host || document.getElementById('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = `toast ${level}`;
  t.setAttribute('role', level === 'error' ? 'alert' : 'status');
  t.innerHTML = `<span class="t-ic">${ICON[level] || ICON.info}</span><span class="t-msg"></span><button class="t-x" aria-label="Dismiss">×</button>`;
  t.querySelector('.t-msg').textContent = message;
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 380); };
  t.querySelector('.t-x').onclick = close;
  host.appendChild(t);
  while (host.children.length > 3) host.firstElementChild.remove();
  requestAnimationFrame(() => t.classList.add('in'));
  if (timeout) setTimeout(close, timeout);
  return close;
}
