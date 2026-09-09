import assert from 'node:assert/strict';
import test from 'node:test';
import { keyPairFromSeed } from '../lib/keypair-core.ts';
import {
  profileRequestErrorMessage,
  refreshWireGuardProfile,
  requestWireGuardProfile,
  validateProfileRequest,
} from '../lib/profile.ts';
import {
  parseStoredWireGuardProfile,
  parseWireGuardApiResponse,
  validateWireGuardConfig,
} from '../lib/wireguard.ts';

const endpoint = 'https://vpn.example.com/profile';
const username = 'test-user';
const password = 'correct horse battery staple';
const firstKeyPair = keyPairFromSeed(new Uint8Array(32).fill(1));
const secondKeyPair = keyPairFromSeed(new Uint8Array(32).fill(2));
const savedProfile = {
  privateKey: firstKeyPair.privateKey,
  publicKey: 'saved-server-public-key',
  serverAddress: 'saved.vpn.example.com',
  serverPort: 51820,
  address: '10.42.0.8/32',
  allowedIPs: ['0.0.0.0/0'],
};

function response(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: async () => JSON.stringify(body),
  };
}

function successResponse() {
  return {
    header: { code: 1, message: 'Profile generated.' },
    body: {
      peer: { address: '10.42.0.2/32' },
      wireguard: {
        server_public_key: 'server-public-key',
        endpoint: 'vpn.example.com:51820',
        allowed_ips: ['0.0.0.0/0', '::/0'],
        dns: ['1.1.1.1'],
        mtu: 1420,
        persistent_keepalive: 25,
      },
    },
  };
}

test('posts JSON credentials and a fresh 32-byte base64 public key for every request', async () => {
  const requests = [];
  const keyPairs = [firstKeyPair, secondKeyPair];
  const result = async () => requestWireGuardProfile(endpoint, username, password, {
    fetchImpl: async (input, init) => {
      requests.push({ input, init });
      return response(successResponse());
    },
    generateKeyPair: async () => keyPairs.shift(),
  });

  await result();
  await result();

  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].init.body, requests[1].init.body);
  for (const request of requests) {
    assert.equal(request.input, endpoint);
    assert.equal(request.init.method, 'POST');
    assert.deepEqual(request.init.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(request.init.body);
    assert.deepEqual(Object.keys(body).sort(), ['password', 'publickey', 'username']);
    assert.equal(body.username, username);
    assert.equal(body.password, password);
    assert.match(body.publickey, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(Buffer.from(body.publickey, 'base64').length, 32);
  }
});

test('normalizes a successful API response and preserves peer details', async () => {
  const profile = await requestWireGuardProfile(endpoint, username, password, {
    fetchImpl: async () => response(successResponse()),
    generateKeyPair: async () => firstKeyPair,
  });

  assert.deepEqual(profile, {
    privateKey: firstKeyPair.privateKey,
    publicKey: 'server-public-key',
    serverAddress: 'vpn.example.com',
    serverPort: 51820,
    address: '10.42.0.2/32',
    allowedIPs: ['0.0.0.0/0', '::/0'],
    dns: ['1.1.1.1'],
    mtu: 1420,
    persistentKeepalive: 25,
  });
});

test('substitutes the generated private key into an inline WireGuard configuration', async () => {
  const body = {
    header: { code: 1 },
    body: {
      peer: { address: '10.42.0.7/32' },
      wireguard: {
        wireguard_configuration: `[Interface]
PrivateKey = {clientPrivateKey}
Address = 10.42.0.7/32
DNS = 9.9.9.9

[Peer]
PublicKey = inline-server-key
Endpoint = [2001:db8::7]:51820
AllowedIPs = 10.0.0.0/8
PersistentKeepalive = 15`,
      },
    },
  };

  const profile = await requestWireGuardProfile(endpoint, username, password, {
    fetchImpl: async () => response(body),
    generateKeyPair: async () => firstKeyPair,
  });

  assert.equal(profile.privateKey, firstKeyPair.privateKey);
  assert.equal(profile.publicKey, 'inline-server-key');
  assert.equal(profile.serverAddress, '2001:db8::7');
  assert.equal(profile.serverPort, 51820);
  assert.equal(profile.allowedIPs[0], '10.0.0.0/8');
});

test('surfaces profile API rejection messages', async () => {
  await assert.rejects(
    requestWireGuardProfile(endpoint, username, password, {
      fetchImpl: async () => response({
        header: { code: 0, message: 'Invalid username or password.' },
      }),
      generateKeyPair: async () => firstKeyPair,
    }),
    { message: 'Invalid username or password.' },
  );
});

test('rejects incomplete profiles with actionable errors', () => {
  const privateKey = firstKeyPair.privateKey;
  assert.throws(
    () => parseWireGuardApiResponse('not-json', privateKey),
    { message: 'The endpoint did not return a JSON API response.' },
  );
  assert.throws(
    () => parseWireGuardApiResponse(JSON.stringify({
      header: { code: 1 },
      body: { peer: {} },
    }), privateKey),
    { message: 'The API response is missing peer or WireGuard details.' },
  );
  assert.throws(
    () => parseWireGuardApiResponse(JSON.stringify({
      header: { code: 1 },
      body: {
        peer: { address: '10.42.0.2/32' },
        wireguard: {
          server_public_key: 'server-public-key',
          endpoint: 'vpn.example.com:51820',
        },
      },
    }), privateKey),
    { message: 'The profile is missing allowed IPs.' },
  );
});

test('rejects incomplete persisted profiles before they can be restored', () => {
  const incomplete = {
    privateKey: firstKeyPair.privateKey,
    publicKey: 'server-public-key',
    serverAddress: 'vpn.example.com',
    serverPort: 51820,
  };

  assert.throws(
    () => parseStoredWireGuardProfile(JSON.stringify(incomplete)),
    { message: 'The profile is missing allowed IPs.' },
  );
  assert.throws(
    () => parseStoredWireGuardProfile('{not-json'),
    { message: 'The saved profile is not valid JSON.' },
  );
});

test('validates and normalizes a persisted profile without changing its tunnel details', () => {
  const persisted = {
    privateKey: ` ${firstKeyPair.privateKey} `,
    publicKey: ' server-public-key ',
    serverAddress: ' vpn.example.com ',
    serverPort: 51820,
    address: ['10.42.0.2/32'],
    allowedIPs: ['0.0.0.0/0', ' ::/0 '],
    dns: ['1.1.1.1'],
    mtu: 1420,
    persistentKeepalive: 25,
  };

  assert.deepEqual(validateWireGuardConfig(persisted), {
    ...persisted,
    privateKey: firstKeyPair.privateKey,
    publicKey: 'server-public-key',
    serverAddress: 'vpn.example.com',
    allowedIPs: ['0.0.0.0/0', '::/0'],
  });
});

function screenRefresh(initialProfile, input, dependencies) {
  const screen = {
    profile: initialProfile,
    state: initialProfile ? 'ready' : 'idle',
    message: '',
    states: [],
  };

  const refresh = async () => {
    const validationMessage = validateProfileRequest(input.endpoint, input.username, input.password);
    if (validationMessage) {
      screen.state = 'error';
      screen.message = validationMessage;
      return screen;
    }

    screen.state = 'fetching';
    screen.states.push(screen.state);
    screen.message = '';
    try {
      screen.profile = await refreshWireGuardProfile(
        input.endpoint,
        input.username,
        input.password,
        dependencies,
      );
      screen.state = 'ready';
      screen.states.push(screen.state);
    } catch (error) {
      screen.state = 'error';
      screen.states.push(screen.state);
      screen.message = profileRequestErrorMessage(error);
    }
    return screen;
  };

  return refresh();
}

test('covers validation and loading-to-success screen refresh states', async () => {
  const invalid = await screenRefresh(null, {
    endpoint: 'not-an-endpoint',
    username,
    password,
  }, {
    fetchImpl: async () => response(successResponse()),
    generateKeyPair: async () => firstKeyPair,
  });
  assert.deepEqual(invalid, {
    profile: null,
    state: 'error',
    message: 'Enter a full HTTPS endpoint, such as https://vpn.example.com/profile.',
    states: [],
  });

  const success = await screenRefresh(null, {
    endpoint,
    username,
    password,
  }, {
    fetchImpl: async () => response(successResponse()),
    generateKeyPair: async () => firstKeyPair,
  });
  assert.equal(success.state, 'ready');
  assert.deepEqual(success.states, ['fetching', 'ready']);
  assert.equal(success.profile.serverAddress, 'vpn.example.com');
  assert.equal(success.message, '');
});

test('shows HTTP failures and preserves a previously usable profile during refresh', async () => {
  const failed = await screenRefresh(savedProfile, {
    endpoint,
    username,
    password,
  }, {
    fetchImpl: async () => response({ error: 'unavailable' }, { ok: false, status: 503 }),
    generateKeyPair: async () => secondKeyPair,
  });

  assert.equal(failed.state, 'error');
  assert.deepEqual(failed.states, ['fetching', 'error']);
  assert.equal(failed.message, 'The endpoint returned HTTP 503.');
  assert.deepEqual(failed.profile, savedProfile);
});

test('cleans up a timed-out request and exposes a user-facing timeout message', async () => {
  let signal;
  const timedOut = await screenRefresh(savedProfile, {
    endpoint,
    username,
    password,
  }, {
    timeoutMs: 10,
    fetchImpl: async (_input, init) => {
      signal = init.signal;
      await new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('The request was aborted.');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
    generateKeyPair: async () => secondKeyPair,
  });

  assert.equal(timedOut.state, 'error');
  assert.deepEqual(timedOut.states, ['fetching', 'error']);
  assert.equal(timedOut.message, 'The request timed out. Check the host and try again.');
  assert.deepEqual(timedOut.profile, savedProfile);
  assert.equal(signal.aborted, true);
});

test('clears the timeout after a successful refresh', async () => {
  let signal;
  const refreshed = await screenRefresh(savedProfile, {
    endpoint,
    username,
    password,
  }, {
    timeoutMs: 10,
    fetchImpl: async (_input, init) => {
      signal = init.signal;
      return response(successResponse());
    },
    generateKeyPair: async () => secondKeyPair,
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(refreshed.state, 'ready');
  assert.equal(signal.aborted, false);
  assert.notDeepEqual(refreshed.profile, savedProfile);
});
