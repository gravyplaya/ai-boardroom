import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClientKeys } from '../utils/client_keys.js';
import { authEnabled } from '../utils/auth.js';
import { buildAttemptPlan } from '../utils/llm_router.js';

test('extractClientKeys parses base64 header', () => {
  const keys = { nvidia: 'nv-test' };
  const hdr = Buffer.from(JSON.stringify(keys)).toString('base64');
  const req = { headers: { 'x-provider-keys': hdr }, body: {} };
  assert.equal(extractClientKeys(req).nvidia, 'nv-test');
});

test('extractClientKeys empty on garbage', () => {
  const req = { headers: { 'x-provider-keys': '!!!' }, body: {} };
  assert.deepEqual(extractClientKeys(req), {});
});

test('buildAttemptPlan prefers role model', () => {
  const plan = buildAttemptPlan({
    role: 'coder',
    roleModels: { coder: { provider: 'openai', model: 'gpt-4o-mini' } },
    clientKeys: { openai: 'sk', nvidia: 'nv' },
  });
  assert.ok(plan.length);
  assert.equal(plan[0].provider, 'openai');
});

test('authEnabled is boolean', () => {
  assert.equal(typeof authEnabled(), 'boolean');
});
