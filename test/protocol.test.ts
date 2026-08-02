import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verify } from 'node:crypto';
import { canonicalRequest, generateDeviceIdentity, signRequest } from '../src/protocol.ts';

test('creates a locally verifiable Ed25519 signature', () => {
  const identity = generateDeviceIdentity();
  const request = { agentId: 'agent-1', method: 'POST', path: '/jobs/next', timestamp: 42, nonce: 'nonce', body: '{}' };
  const signed = signRequest({ ...request, privateKey: identity.privateKey });
  assert.equal(verify(null, Buffer.from(canonicalRequest(request)), identity.publicKey, Buffer.from(signed.signature, 'base64url')), true);
});

test('body changes invalidate the signature', () => {
  const identity = generateDeviceIdentity();
  const request = { agentId: 'agent-1', method: 'POST', path: '/jobs/next', timestamp: 42, nonce: 'nonce', body: '{}' };
  const signed = signRequest({ ...request, privateKey: identity.privateKey });
  assert.equal(verify(null, Buffer.from(canonicalRequest({ ...request, body: '{"changed":true}' })), identity.publicKey, Buffer.from(signed.signature, 'base64url')), false);
});
