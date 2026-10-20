import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encryptRegistry, decryptRegistry, pinKey, validateEnvelope} from '../registry-crypto.mjs';

const registry = {kind:'arete-registration-registry', schemaVersion:1, sources:[{names:['Synthetic, Taylor']}]};
test('the configured PIN unlocks readable names without plaintext in the asset', async () => {
  const encrypted = await encryptRegistry(registry, '0000');
  assert.ok(!JSON.stringify(encrypted).includes('Synthetic'));
  assert.deepEqual(await decryptRegistry(encrypted, await pinKey('0000', encrypted)), registry);
  await assert.rejects(decryptRegistry(encrypted, await pinKey('1234', encrypted)), {name:'OperationError'});
  await assert.rejects(pinKey('0', encrypted), /four-digit/);
});
test('changed snapshots retain the unlock key but use a fresh authenticated nonce', async () => {
  const first = await encryptRegistry(registry, '0000');
  const next = await encryptRegistry({...registry, sources:[]}, '0000', first.salt);
  assert.notEqual(first.iv, next.iv);
  assert.deepEqual(await decryptRegistry(next, await pinKey('0000', first)), {...registry, sources:[]});
  const tampered = {...next, ciphertext:(next.ciphertext[0] === 'A' ? 'B' : 'A') + next.ciphertext.slice(1)};
  await assert.rejects(decryptRegistry(tampered, await pinKey('0000', next)), {name:'OperationError'});
});
test('malformed or excessive crypto parameters are rejected before key derivation', () => {
  assert.throws(() => validateEnvelope({kind:'arete-shared-registry', schemaVersion:1, kdf:'PBKDF2-SHA256', iterations:1e12}), /Unsupported/);
});
