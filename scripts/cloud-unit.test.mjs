import test from 'node:test';
import assert from 'node:assert/strict';
import { getEntity, isUUID, validateInput } from '../src/lib/cloud/validation.ts';

test('entity lookup rejects prototype keys and unknown entities', () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'unknown']) assert.equal(getEntity(key), undefined);
  assert.ok(getEntity('memories'));
});
test('clients cannot set ownership, evidence, or trusted role', () => {
  for (const field of ['user_id', 'id', 'source', 'created_at']) assert.throws(() => validateInput('memories', { content: 'Fact', [field]: 'bad' }));
  assert.throws(() => validateInput('messages', { content: 'x', role: 'assistant' }));
  for (const entity of ['tasks', 'task_steps', 'devices', 'approvals', 'provider_connections', 'automations', 'audit_logs']) assert.throws(() => validateInput(entity, { status: 'succeeded' }));
});
test('required fields and body shape are validated', () => {
  for (const value of [null, [], '', {}, { content: '   ' }, { content: 'a'.repeat(10001) }]) assert.throws(() => validateInput('memories', value));
  assert.deepEqual(validateInput('memories', { content: ' safe ', importance: 3 }), { content: 'safe', importance: 3 });
});
test('numeric ranges and enumerations are enforced', () => {
  for (const speed of [0.74, 1.51, NaN, Infinity, '1.0']) assert.throws(() => validateInput('voice_profiles', { name: 'Voice', speed }));
  assert.equal(validateInput('voice_profiles', { name: 'Voice', speed: 1.5, language: 'te' }).speed, 1.5);
  assert.throws(() => validateInput('memories', { content: 'Fact', importance: 1.1 }));
  assert.throws(() => validateInput('memories', { content: 'Fact', kind: 'admin' }));
});
test('parent references must be UUIDs, partial edits retain required fields', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.ok(isUUID(id)); assert.equal(isUUID('bad'), false);
  assert.throws(() => validateInput('messages', { content: 'Message', conversation_id: 'bad' }));
  assert.equal(validateInput('messages', { content: 'Message', conversation_id: id }).conversation_id, id);
  assert.deepEqual(validateInput('messages', { content: 'Edited' }, true), { content: 'Edited' });
});
