import assert from 'node:assert/strict';
import test from 'node:test';
import { keyPairFromSeed } from '../lib/keypair-core.ts';
import { captureProfileRegistrationEvidence } from './profile-registration-evidence.mjs';

const endpoint = 'https://vpn.example.com/profile';
const username = 'evidence-user';
const password = 'evidence-password';
const firstKeyPair = keyPairFromSeed(new Uint8Array(32).fill(11));
const secondKeyPair = keyPairFromSeed(new Uint8Array(32).fill(12));

function successResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      header: { code: 1 },
      body: {
        peer: { address: '10.42.0.2/32' },
        wireguard: {
          server_public_key: 'server-public-key',
          endpoint: 'vpn.example.com:51820',
          allowed_ips: ['0.0.0.0/0', '::/0'],
        },
      },
    }),
  };
}

test('captures reviewable metadata while keeping registration secrets and bodies redacted', async () => {
  const keyPairs = [firstKeyPair, secondKeyPair];
  const evidence = await captureProfileRegistrationEvidence({
    endpoint,
    username,
    password,
    fetchImpl: async () => successResponse(),
    generateKeyPair: async () => keyPairs.shift(),
  });

  assert.deepEqual(evidence, {
    captureMethod: 'profile-registration-acceptance-harness',
    httpMethod: 'POST',
    requestCount: 2,
    statusCodes: [200, 200],
    responseSuccess: true,
    generatedPublicKeyFresh: true,
    returnedProfileUsesGeneratedPrivateKey: true,
    profile: {
      server: 'vpn.example.com:51820',
      routes: '0.0.0.0/0, ::/0',
      address: '10.42.0.2/32',
    },
    redactions: {
      username: '[REDACTED]',
      password: '[REDACTED]',
      privateKey: '[REDACTED]',
      requestBody: '[REDACTED]',
      responseBody: '[REDACTED]',
    },
  });

  const serializedEvidence = JSON.stringify(evidence);
  for (const secret of [username, password, firstKeyPair.privateKey, secondKeyPair.privateKey]) {
    assert.equal(serializedEvidence.includes(secret), false);
  }
  assert.equal(serializedEvidence.includes('publickey'), false);
  assert.equal(serializedEvidence.includes('server-public-key'), false);
});

test('records failed status without exposing a failed response body', async () => {
  const evidence = await captureProfileRegistrationEvidence({
    endpoint,
    username,
    password,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({
        username,
        password,
        privateKey: firstKeyPair.privateKey,
        message: 'temporary outage',
      }),
    }),
    generateKeyPair: async () => firstKeyPair,
    requestCount: 1,
  });

  assert.equal(evidence.responseSuccess, false);
  assert.deepEqual(evidence.statusCodes, [503]);
  assert.equal(evidence.profile, null);
  assert.equal(evidence.generatedPublicKeyFresh, true);
  assert.equal(evidence.returnedProfileUsesGeneratedPrivateKey, false);
  assert.equal(JSON.stringify(evidence).includes('temporary outage'), false);
});

test('records null when a registration fails before receiving an HTTP response', async () => {
  const evidence = await captureProfileRegistrationEvidence({
    endpoint,
    username,
    password,
    fetchImpl: async () => {
      throw new Error('network failure');
    },
    generateKeyPair: async () => firstKeyPair,
    requestCount: 1,
  });

  assert.deepEqual(evidence.statusCodes, [null]);
  assert.equal(evidence.responseSuccess, false);
  assert.equal(evidence.generatedPublicKeyFresh, true);
});