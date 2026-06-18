/* global chrome */
import { store, apiUrl } from './common.js';

const $ = (id) => document.getElementById(id);

async function activeTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
}

function show(el, on) { el.hidden = !on; }

async function init() {
  const { baseUrl, token, userName } = await store.get(['baseUrl', 'token', 'userName']);

  if (!baseUrl || !token) {
    show($('setup'), true);
    show($('ready'), false);
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  $('who').textContent = userName ? userName : 'Connected';
  show($('ready'), true);

  const url = await activeTabUrl();
  $('url').textContent = url || '(no active tab URL)';

  const isHttp = /^https?:\/\//i.test(url);
  $('track').disabled = !isHttp;
  if (!isHttp) setMsg('This page isn’t a trackable product URL.', 'muted');

  $('track').addEventListener('click', () => track(baseUrl, token, url));
}

function setMsg(text, kind) {
  const m = $('msg');
  m.textContent = text;
  m.className = 'msg ' + (kind || '');
}

async function track(baseUrl, token, url) {
  $('track').disabled = true;
  setMsg('Adding…', 'muted');
  try {
    const res = await fetch(apiUrl(baseUrl, '/tracking/import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
    });

    if (res.status === 401) {
      setMsg('Session expired — reconnect in setup.', 'err');
      $('track').disabled = false;
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error || `Failed (${res.status})`, 'err');
      $('track').disabled = false;
      return;
    }

    setMsg(data.message || 'Now tracking this item ✓', 'ok');
  } catch (e) {
    setMsg('Could not reach your Trackit instance.', 'err');
    $('track').disabled = false;
  }
}

init();
