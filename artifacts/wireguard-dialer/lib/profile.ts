import {
  parseWireGuardApiResponse,
  profileSummary,
  type WireGuardConfig,
} from './wireguard.ts';

export const PROFILE_REQUEST_TIMEOUT_MS = 20_000;

export type ProfileKeyPair = {
  privateKey: string;
  publicKey: string;
};

export type ProfileRequestDependencies = {
  fetchImpl: typeof fetch;
  generateKeyPair: () => Promise<ProfileKeyPair>;
};

export type ProfileRegistrationEvidence = {
  captureMethod: string;
  httpMethod: 'POST';
  requestCount: number;
  statusCodes: Array<number | null>;
  responseSuccess: boolean;
  generatedPublicKeyFresh: boolean;
  returnedProfileUsesGeneratedPrivateKey: boolean;
  profile: ReturnType<typeof profileSummary> | null;
  redactions: {
    username: '[REDACTED]';
    password: '[REDACTED]';
    privateKey: '[REDACTED]';
    requestBody: '[REDACTED]';
    responseBody: '[REDACTED]';
  };
};

export function buildProfileRegistrationEvidence({
  captureMethod,
  requestCount,
  statusCodes,
  responseSuccess,
  generatedPublicKeyFresh,
  returnedProfileUsesGeneratedPrivateKey,
  profile,
}: {
  captureMethod: string;
  requestCount: number;
  statusCodes: Array<number | null>;
  responseSuccess: boolean;
  generatedPublicKeyFresh: boolean;
  returnedProfileUsesGeneratedPrivateKey: boolean;
  profile: WireGuardConfig | null;
}): ProfileRegistrationEvidence {
  return {
    captureMethod,
    httpMethod: 'POST',
    requestCount,
    statusCodes: [...statusCodes],
    responseSuccess,
    generatedPublicKeyFresh,
    returnedProfileUsesGeneratedPrivateKey,
    profile: profile ? profileSummary(profile) : null,
    redactions: {
      username: '[REDACTED]',
      password: '[REDACTED]',
      privateKey: '[REDACTED]',
      requestBody: '[REDACTED]',
      responseBody: '[REDACTED]',
    },
  };
}

export class ProfileRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileRequestError';
  }
}

export function validateProfileRequest(endpoint: string, username: string, password: string): string | null {
  if (!/^https?:\/\/\S+$/i.test(endpoint.trim())) {
    return 'Enter a full HTTPS endpoint, such as https://vpn.example.com/profile.';
  }
  if (!username.trim() || !password) {
    return 'Enter the username and password used by your profile service.';
  }
  return null;
}

export function profileRequestErrorMessage(error: unknown): string {
  return error instanceof Error && error.name === 'AbortError'
    ? 'The request timed out. Check the host and try again.'
    : error instanceof Error
      ? error.message
      : 'Could not retrieve a valid WireGuard profile.';
}

export async function requestWireGuardProfile(
  endpoint: string,
  username: string,
  password: string,
  { fetchImpl, generateKeyPair }: ProfileRequestDependencies,
): Promise<WireGuardConfig> {
  const keyPair = await generateKeyPair();
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      publickey: keyPair.publicKey,
    }),
  });
  if (!response.ok) throw new Error(`The endpoint returned HTTP ${response.status}.`);
  return parseWireGuardApiResponse(await response.text(), keyPair.privateKey);
}

export async function refreshWireGuardProfile(
  endpoint: string,
  username: string,
  password: string,
  {
    fetchImpl,
    generateKeyPair,
    timeoutMs = PROFILE_REQUEST_TIMEOUT_MS,
  }: ProfileRequestDependencies & { timeoutMs?: number },
): Promise<WireGuardConfig> {
  const validationMessage = validateProfileRequest(endpoint, username, password);
  if (validationMessage) throw new ProfileRequestError(validationMessage);

  const keyPair = await generateKeyPair();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const profile = await requestWireGuardProfile(endpoint.trim(), username.trim(), password, {
      fetchImpl: (input, init) => fetchImpl(input, { ...init, signal: controller.signal }),
      generateKeyPair: async () => keyPair,
    });
    return profile;
  } finally {
    clearTimeout(timeout);
  }
}