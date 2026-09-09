import nacl from 'tweetnacl';

export type WireGuardKeyPair = {
  privateKey: string;
  publicKey: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (second === undefined ? 0 : second >> 4)];
    output += second === undefined ? '=' : alphabet[((second & 15) << 2) | (third === undefined ? 0 : third >> 6)];
    output += third === undefined ? '=' : alphabet[third & 63];
  }
  return output;
}

export function keyPairFromSeed(seed: Uint8Array): WireGuardKeyPair {
  if (seed.length !== nacl.box.secretKeyLength) {
    throw new Error(`WireGuard key generation requires ${nacl.box.secretKeyLength} random bytes.`);
  }

  nacl.setPRNG((target, length) => {
    for (let index = 0; index < length; index += 1) target[index] = seed[index];
  });
  const keyPair = nacl.box.keyPair();
  return {
    privateKey: bytesToBase64(keyPair.secretKey),
    publicKey: bytesToBase64(keyPair.publicKey),
  };
}