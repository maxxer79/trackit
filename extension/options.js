/* global chrome */
import { store, normalizeBase, apiUrl } from './common.js';

const $ = (id) => document.getElementById(id);

function setMsg(text, kind) {
  const m = $('msg');
  m.textContent = text;
  m.className = 'msg ' + (kind || '');
}

async function render() {
  const { baseUrl, userName } = await store.get(['baseUrl', 'token', 'userName']);
  const { token } = await store.get(['token']);
  if (baseUrl && token) {
    $('connected').hidden = false;
    $('form').hidden = true;
    $('connectedMsg').textContent = `Connected to ${baseUrl}${userName ? ` as ${userName}` : ''} ✓`;
  } else {
    $('connected').hidden = true;
    $('form').hidden = false;
    if (baseUrl) $('baseUrl').value = baseUrl;
  }
}

// MV3 cross-origin fetch needs host permission for the instance origin. We
// request just that origin (not all sites) when the user connects.
async function ensureHostPermission(baseUrl) {
  try {
    const origin = new URL(baseUrl).origin + '/*';
    const granted = await chrome.permissions.contains({ origins: [origin] });
    if (granted) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

async function connect() {
  const baseUrl = normalizeBase($('baseUrl').value);
  const email = $('email').value.trim();
  const password = $('password').value;

  if (!baseUrl) return setMsg('Enter your Trackit URL.', 'err');
  if (!email || !password) return setMsg('Enter your email and password.', 'err');

  $('connect').disabled = true;
  setMsg('Connecting…', 'muted');

  const ok = await ensureHostPermission(baseUrl);
  if (!ok) {
    setMsg('Permission to reach that site was declined.', 'err');
    $('connect').disabled = false;
    return;
  }

  try {
    const res = await fetch(apiUrl(baseUrl, '/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      setMsg(data.error || `Login failed (${res.status})`, 'err');
      $('connect').disabled = false;
      return;
    }
    await store.set({ baseUrl, token: data.token, userName: data.user?.name || '' });
    setMsg('Connected ✓', 'ok');
    render();
  } catch {
    setMsg('Could not reach that URL. Check the address and that the server is up.', 'err');
    $('connect').disabled = false;
  }
}

async function disconnect() {
  await store.clear();
  setMsg('', '');
  render();
}

$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', disconnect);
render();
