export interface WireGuardConfig {
  privateKey: string;
  publicKey: string;
  serverAddress: string;
  serverPort: number;
  address?: string | string[];
  allowedIPs: string[];
  dns?: string[];
  mtu?: number;
  presharedKey?: string;
  persistentKeepalive?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`The profile is missing ${label}.`);
  }
  return value.trim();
}

function stringList(value: unknown, label: string): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((item) => item.trim())
      : [];
  const filtered = list.filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (filtered.length === 0) {
    throw new Error(`The profile is missing ${label}.`);
  }
  return filtered;
}

function storedStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`The profile is missing ${label}.`);
  const filtered = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (filtered.length !== value.length || filtered.length === 0) {
    throw new Error(`The profile contains invalid ${label}.`);
  }
  return filtered.map((item) => item.trim());
}

function parseEndpoint(value: unknown): { serverAddress: string; serverPort: number } {
  const endpoint = requiredString(value, 'the peer endpoint');
  const ipv6Match = endpoint.match(/^\[([^\]]+)\](?::(\d+))?$/);
  const lastColon = endpoint.lastIndexOf(':');
  const host = ipv6Match?.[1] ?? (lastColon > 0 ? endpoint.slice(0, lastColon) : endpoint);
  const portValue = ipv6Match?.[2] ?? (lastColon > 0 ? endpoint.slice(lastColon + 1) : '51820');
  const serverPort = Number(portValue);
  if (!host || !Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error('The peer endpoint must include a valid host and port.');
  }
  return { serverAddress: host, serverPort };
}

function normalizeObject(input: Record<string, unknown>): WireGuardConfig {
  const interfacePart =
    (input.interface as Record<string, unknown> | undefined) ??
    (input.Interface as Record<string, unknown> | undefined) ??
    input;
  const peerPart =
    (input.peer as Record<string, unknown> | undefined) ??
    (input.Peer as Record<string, unknown> | undefined) ??
    (Array.isArray(input.peers) ? (input.peers[0] as Record<string, unknown>) : undefined) ??
    input;
  const endpoint = parseEndpoint(peerPart.endpoint ?? peerPart.Endpoint ?? peerPart.endpointaddress ?? input.endpoint);
  const address = interfacePart.address ?? interfacePart.Address;
  const dnsValue = interfacePart.dns ?? interfacePart.DNS;
  const allowedIPs = stringList(
    peerPart.allowedIPs ?? peerPart.AllowedIPs ?? peerPart.allowedIps ?? peerPart.allowedips,
    'allowed IPs',
  );
  const config: WireGuardConfig = {
    privateKey: requiredString(
      interfacePart.privateKey ?? interfacePart.PrivateKey ?? interfacePart.privatekey,
      'the interface private key',
    ),
    publicKey: requiredString(
      peerPart.publicKey ?? peerPart.PublicKey ?? peerPart.publickey,
      'the peer public key',
    ),
    serverAddress: endpoint.serverAddress,
    serverPort: endpoint.serverPort,
    allowedIPs,
  };
  if (address !== undefined) {
    config.address = Array.isArray(address)
      ? address.map((item) => requiredString(item, 'the tunnel address'))
      : requiredString(address, 'the tunnel address');
  }
  if (dnsValue !== undefined) config.dns = stringList(dnsValue, 'DNS servers');
  const mtuValue = interfacePart.mtu ?? interfacePart.MTU;
  if (mtuValue !== undefined) {
    const mtu = Number(mtuValue);
    if (!Number.isInteger(mtu) || mtu < 576 || mtu > 9000) throw new Error('The profile contains an invalid MTU.');
    config.mtu = mtu;
  }
  const presharedKey = peerPart.presharedKey ?? peerPart.PresharedKey ?? peerPart.presharedkey;
  if (presharedKey) config.presharedKey = requiredString(presharedKey, 'the preshared key');
  const keepaliveValue =
    peerPart.persistentKeepalive ?? peerPart.PersistentKeepalive ?? peerPart.persistentkeepalive;
  if (keepaliveValue !== undefined) {
    const persistentKeepalive = Number(keepaliveValue);
    if (!Number.isInteger(persistentKeepalive) || persistentKeepalive < 0 || persistentKeepalive > 65535) {
      throw new Error('The profile contains an invalid keepalive value.');
    }
    config.persistentKeepalive = persistentKeepalive;
  }
  return config;
}

/**
 * Validate the normalized shape persisted by the app. TypeScript interfaces
 * disappear at runtime, so restored JSON must be checked before it can be
 * displayed as ready or passed to the native tunnel module.
 */
export function validateWireGuardConfig(value: unknown): WireGuardConfig {
  if (!isRecord(value)) throw new Error('The saved profile is not a valid object.');

  const privateKey = requiredString(value.privateKey, 'the interface private key');
  const publicKey = requiredString(value.publicKey, 'the peer public key');
  const serverAddress = requiredString(value.serverAddress, 'the peer endpoint');
  const serverPort = value.serverPort;
  if (typeof serverPort !== 'number' || !Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error('The saved profile contains an invalid peer port.');
  }

  const config: WireGuardConfig = {
    privateKey,
    publicKey,
    serverAddress,
    serverPort,
    allowedIPs: storedStringList(value.allowedIPs, 'allowed IPs'),
  };

  if (value.address !== undefined) {
    config.address = Array.isArray(value.address)
      ? value.address.map((item) => requiredString(item, 'the tunnel address'))
      : requiredString(value.address, 'the tunnel address');
  }
  if (value.dns !== undefined) config.dns = storedStringList(value.dns, 'DNS servers');

  if (value.mtu !== undefined) {
    const mtu = value.mtu;
    if (typeof mtu !== 'number' || !Number.isInteger(mtu) || mtu < 576 || mtu > 9000) {
      throw new Error('The saved profile contains an invalid MTU.');
    }
    config.mtu = mtu;
  }

  if (value.presharedKey !== undefined) {
    config.presharedKey = requiredString(value.presharedKey, 'the preshared key');
  }

  if (value.persistentKeepalive !== undefined) {
    const persistentKeepalive = value.persistentKeepalive;
    if (
      typeof persistentKeepalive !== 'number'
      || !Number.isInteger(persistentKeepalive)
      || persistentKeepalive < 0
      || persistentKeepalive > 65535
    ) {
      throw new Error('The saved profile contains an invalid keepalive value.');
    }
    config.persistentKeepalive = persistentKeepalive;
  }

  return config;
}

export function parseStoredWireGuardProfile(serialized: string): WireGuardConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('The saved profile is not valid JSON.');
  }
  return validateWireGuardConfig(parsed);
}

function parseIni(source: string): WireGuardConfig {
  const sections: Record<string, Record<string, string>> = {};
  let section = '';
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      sections[section] ??= {};
      continue;
    }
    const equals = line.indexOf('=');
    if (!section || equals < 0) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    sections[section][key] = line.slice(equals + 1).trim();
  }
  const iface = sections.interface;
  const peer = sections.peer;
  if (!iface || !peer) throw new Error('The response is not a complete WireGuard profile.');
  return normalizeObject({
    interface: iface,
    peer: peer,
  });
}

export function parseWireGuardApiResponse(body: string, privateKey: string): WireGuardConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('The endpoint did not return a JSON API response.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('The endpoint returned an invalid API response.');
  const response = parsed as Record<string, unknown>;
  const header = response.header as Record<string, unknown> | undefined;
  const headerCode = Number(header?.code ?? header?.response_code ?? 0);
  if (headerCode !== 1) {
    const headerMessage = typeof header?.message === 'string' ? header.message : 'The profile request was rejected.';
    throw new Error(headerMessage);
  }
  const apiBody = response.body as Record<string, unknown> | undefined;
  const peer = apiBody?.peer as Record<string, unknown> | undefined;
  const wireguard = apiBody?.wireguard as Record<string, unknown> | undefined;
  if (!peer || !wireguard) throw new Error('The API response is missing peer or WireGuard details.');
  const inlineConfig = wireguard.wireguard_configuration;
  if (typeof inlineConfig === 'string' && inlineConfig.includes('{clientPrivateKey}')) {
    return parseIni(inlineConfig.replaceAll('{clientPrivateKey}', privateKey));
  }
  return normalizeObject({
    interface: {
      privateKey,
      address: peer.address,
      dns: wireguard.dns,
      mtu: wireguard.mtu,
    },
    peer: {
      publicKey: wireguard.server_public_key,
      endpoint: wireguard.endpoint,
      allowedIPs: wireguard.allowed_ips,
      persistentKeepalive: wireguard.persistent_keepalive,
    },
  });
}

export function parseWireGuardResponse(body: string): WireGuardConfig {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('The endpoint returned an empty profile.');
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parseIni(parsed);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (typeof record.config === 'string') return parseIni(record.config);
      if (typeof record.profile === 'string') return parseIni(record.profile);
      return normalizeObject(record);
    }
  } catch (error) {
    if (error instanceof Error && error.message !== 'Unexpected end of JSON input') {
      if (error.message.startsWith('The profile') || error.message.startsWith('The peer')) throw error;
    }
  }
  return parseIni(trimmed);
}

export function profileSummary(config: WireGuardConfig) {
  return {
    server: `${config.serverAddress}:${config.serverPort}`,
    routes: config.allowedIPs.join(', '),
    address: Array.isArray(config.address) ? config.address.join(', ') : config.address ?? 'Assigned by tunnel',
  };
}