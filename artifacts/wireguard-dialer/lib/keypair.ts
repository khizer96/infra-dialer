import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import { keyPairFromSeed } from './keypair-core';

export async function generateWireGuardKeyPair() {
  const randomSeed = await Crypto.getRandomBytesAsync(nacl.box.secretKeyLength);
  return keyPairFromSeed(randomSeed);
}