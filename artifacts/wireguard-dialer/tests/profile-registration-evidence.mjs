import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { keyPairFromSeed } from '../lib/keypair-core.ts';
import {
  buildProfileRegistrationEvidence,
  requestWireGuardProfile,
} from '../lib/profile.ts';

function publicKeyByteLength(publicKey) {
  return Buffer.from(publicKey, 'base64').byteLength;
}

/**
 * Runs the registration path without retaining credentials or full bodies in
 * the returned evidence. Two requests are intentional: freshness cannot be
 * verified from a single registration.
 */
export async function captureProfileRegistrationEvidence({
  endpoint,
  username,
  password,
  fetchImpl,
  generateKeyPair,
  requestCount = 2,
  captureMethod = 'profile-registration-acceptance-harness',
}) {
  const statusCodes = [];
  const generatedPublicKeys = [];
  const returnedProfiles = [];
  let everyRequestSucceeded = requestCount > 0;
  let everyReturnedPrivateKeyMatched = requestCount > 0;

  for (let requestIndex = 0; requestIndex < requestCount; requestIndex += 1) {
    let generatedKeyPair;
    const statusCountBeforeRequest = statusCodes.length;
    try {
      generatedKeyPair = await generateKeyPair();
      const profile = await requestWireGuardProfile(endpoint, username, password, {
        generateKeyPair: async () => generatedKeyPair,
        fetchImpl: async (input, init) => {
          // Inspect only the public-key field needed for the freshness check.
          // The full request body is never stored in evidence or printed.
          const requestBody = JSON.parse(String(init?.body ?? '{}'));
          if (typeof requestBody.publickey === 'string') {
            generatedPublicKeys.push(requestBody.publickey);
          }

          try {
            const response = await fetchImpl(input, init);
            statusCodes.push(typeof response?.status === 'number' ? response.status : null);
            return response;
          } catch (error) {
            statusCodes.push(null);
            throw error;
          }
        },
      });
      returnedProfiles.push(profile);
      if (profile.privateKey !== generatedKeyPair.privateKey) {
        everyReturnedPrivateKeyMatched = false;
      }
    } catch {
      if (statusCodes.length === statusCountBeforeRequest) {
        statusCodes.push(null);
      }
      everyRequestSucceeded = false;
      everyReturnedPrivateKeyMatched = false;
    }
  }

  const generatedPublicKeyFresh =
    generatedPublicKeys.length === requestCount &&
    new Set(generatedPublicKeys).size === generatedPublicKeys.length &&
    generatedPublicKeys.every((publicKey) => publicKeyByteLength(publicKey) === 32);

  return buildProfileRegistrationEvidence({
    captureMethod,
    requestCount,
    statusCodes,
    responseSuccess: everyRequestSucceeded && returnedProfiles.length === requestCount,
    generatedPublicKeyFresh,
    returnedProfileUsesGeneratedPrivateKey: everyReturnedPrivateKeyMatched,
    profile: returnedProfiles.at(-1) ?? null,
  });
}

async function runAcceptanceCapture() {
  const endpoint = process.env.PROFILE_ENDPOINT;
  const username = process.env.PROFILE_USERNAME;
  const password = process.env.PROFILE_PASSWORD;
  if (!endpoint || !username || !password) {
    throw new Error('Set PROFILE_ENDPOINT, PROFILE_USERNAME, and PROFILE_PASSWORD in the secret environment.');
  }

  const evidence = await captureProfileRegistrationEvidence({
    endpoint,
    username,
    password,
    fetchImpl: fetch,
    generateKeyPair: async () => keyPairFromSeed(randomBytes(32)),
  });

  // This is the only output of the harness. It intentionally contains no
  // credentials, keys, request bodies, response bodies, or API messages.
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runAcceptanceCapture().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Capture failed.'}\n`);
    process.exitCode = 1;
  });
}