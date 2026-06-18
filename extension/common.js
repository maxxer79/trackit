// Shared helpers for popup + options. Cross-browser: Firefox exposes `browser`,
// Chrome exposes `chrome`; both support the chrome.* callback API we use here.
/* global chrome */

export const store = {
  get: (keys) =>
    new Promise((resolve) => chrome.storage.local.get(keys, (v) => resolve(v))),
  set: (obj) => new Promise((resolve) => chrome.storage.local.set(obj, resolve)),
  clear: () => new Promise((resolve) => chrome.storage.local.remove(['baseUrl', 'token', 'userName'], resolve)),
};

// Normalize whatever the user typed into a clean origin, no trailing slash,
// and strip a trailing "/api" so we can append paths consistently.
export function normalizeBase(raw) {
  let s = (raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/api$/i, '');
  return s;
}

export function apiUrl(baseUrl, path) {
  return `${baseUrl}/api${path}`;
}
