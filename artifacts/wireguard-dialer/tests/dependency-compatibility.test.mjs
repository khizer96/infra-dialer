import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const mobileRequire = createRequire(
  new URL('../package.json', import.meta.url),
);
const routerRequire = createRequire(
  mobileRequire.resolve('expo-router/package.json'),
);

test('Expo Router can parse query strings with the patched decoder', () => {
  const queryString = routerRequire('query-string');

  assert.deepEqual(
    { ...queryString.parse('screen=profile&name=Infra%20Dialer') },
    { name: 'Infra Dialer', screen: 'profile' },
  );
});