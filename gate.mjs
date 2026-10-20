import {pinKey, decryptRegistry, validateEnvelope, toBase64, fromBase64} from './registry-crypto.mjs';
import {validateRegistry} from './people.mjs';
import {sharedRegistry} from './shared-registry.mjs';

const gate = document.querySelector('#access-gate');
const shell = document.querySelector('.app-shell');
const form = document.querySelector('#unlock-form');
const input = document.querySelector('#access-pin');
const error = document.querySelector('#access-error');
const button = form.querySelector('button');
const sessionKey = 'arete.access.session.v1';
let envelope, key, expires, expiryTimer, started = false;

async function loadEnvelope() {
  const response = await fetch('./registry.enc.json', {cache:'no-store'});
  if (!response.ok) throw new Error('The shared archive could not load. Check your connection and try again.');
  return validateEnvelope(await response.json());
}
async function openRegistry(current, currentKey) {
  const registry = await decryptRegistry(current, currentKey);
  const invalid = validateRegistry(registry);
  if (invalid) throw new Error(invalid);
  return registry;
}
async function start(registry) {
  sharedRegistry.registry = registry;
  sharedRegistry.refresh = async () => {
    const current = await loadEnvelope();
    if (current.salt !== envelope.salt) throw new Error('The access PIN changed. Lock and unlock the app again.');
    const updated = await openRegistry(current, key);
    envelope = current;
    sharedRegistry.registry = updated;
    return updated;
  };
  // Retire the old browser-only copy after the shared archive has loaded.
  try { localStorage.removeItem('arete.people.private.v1'); } catch {}
  gate.hidden = true;
  shell.hidden = false;
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(lock, Math.max(0, expires - Date.now()));
  if (!started) { started = true; await import('./app.mjs'); }
}
function showError(message) { error.textContent = message; error.hidden = false; }
function lock() {
  try { sessionStorage.removeItem(sessionKey); } catch {}
  document.querySelector('#modal').close();
  shell.hidden = true;
  gate.hidden = false;
  location.reload();
}
document.querySelector('#lock-app').addEventListener('click', lock);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Opening...';
  try {
    envelope = envelope || await loadEnvelope();
    key = await pinKey(input.value, envelope);
    const registry = await openRegistry(envelope, key);
    const raw = toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
    expires = Date.now() + 12 * 60 * 60 * 1000;
    try { sessionStorage.setItem(sessionKey, JSON.stringify({salt:envelope.salt, raw, expires})); } catch {}
    input.value = '';
    await start(registry);
  } catch (failure) {
    showError(failure.name === 'OperationError' ? 'Incorrect PIN. Try again.' : failure.message);
    input.select();
  } finally { button.disabled = false; button.textContent = 'Unlock'; }
});

async function initialize() {
  if (new URLSearchParams(location.search).has('demo')) {
    gate.hidden = true; shell.hidden = false;
    document.querySelector('#lock-app').hidden = true;
    await import('./app.mjs');
    return;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try {
    envelope = await loadEnvelope();
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(sessionKey)); } catch {}
    if (saved?.salt === envelope.salt && saved.expires > Date.now()) {
      try {
        expires = saved.expires;
        key = await crypto.subtle.importKey('raw', fromBase64(saved.raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
        await start(await openRegistry(envelope, key));
        return;
      } catch { try { sessionStorage.removeItem(sessionKey); } catch {} }
    }
  } catch { /* The submit action retries loading; the PIN screen remains usable. */ }
  input.focus();
}
initialize().catch(() => showError('The app could not open. Reload and try again.'));
