const encoder = new TextEncoder();
const decoder = new TextDecoder();
const aad = encoder.encode('arete-shared-registry-v1');
export const ITERATIONS = 600000;

export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function validateEnvelope(value) {
  if (value?.kind !== 'arete-shared-registry' || value.schemaVersion !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== ITERATIONS) throw new Error('Unsupported shared registry format.');
  if (![value.salt, value.iv, value.ciphertext].every(x => typeof x === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(x)) || value.ciphertext.length > 16 * 1024 * 1024) throw new Error('Invalid shared registry file.');
  if (fromBase64(value.salt).length !== 16 || fromBase64(value.iv).length !== 12) throw new Error('Invalid shared registry parameters.');
  return value;
}

export async function pinKey(pin, envelope) {
  validateEnvelope(envelope);
  if (!/^\d{4}$/.test(pin)) throw new Error('Enter the four-digit PIN.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt:fromBase64(envelope.salt), iterations:envelope.iterations}, material, {name:'AES-GCM', length:256}, true, ['encrypt', 'decrypt']);
}

export async function decryptRegistry(envelope, key) {
  validateEnvelope(envelope);
  const bytes = await crypto.subtle.decrypt({name:'AES-GCM', iv:fromBase64(envelope.iv), additionalData:aad}, key, fromBase64(envelope.ciphertext));
  return JSON.parse(decoder.decode(bytes));
}

export async function encryptRegistry(registry, pin, salt) {
  const envelope = {kind:'arete-shared-registry', schemaVersion:1, kdf:'PBKDF2-SHA256', iterations:ITERATIONS, salt:salt || toBase64(crypto.getRandomValues(new Uint8Array(16))), iv:toBase64(crypto.getRandomValues(new Uint8Array(12))), ciphertext:'AAAA'};
  const key = await pinKey(pin, envelope);
  envelope.ciphertext = toBase64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv:fromBase64(envelope.iv), additionalData:aad}, key, encoder.encode(JSON.stringify(registry)))));
  return envelope;
}
