import { DeviceEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';
import type { WireGuardConfig } from './wireguard';
import { removeLocal, writeLocal } from './storage';

const ANDROID_VPN_CONSENT_KEY = 'wireguard.androidVpnConsent';

export type TunnelStatus = {
  isConnected: boolean;
  tunnelState: string;
  status: string;
  error?: string;
};

export type TrackerBlockerStatus = {
  enabled: boolean;
  socketConnected: boolean;
  counter: number | null;
  error?: string | null;
};

type WireGuardNativeModule = {
  initialize: () => Promise<void>;
  requestVpnPermission: () => Promise<boolean>;
  connect: (config: WireGuardConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  getStatus: () => Promise<TunnelStatus>;
  isSupported: () => Promise<boolean>;
  getTrackerBlockerStatus: () => Promise<TrackerBlockerStatus>;
  setTrackerBlockerEnabled: (enabled: boolean) => Promise<TrackerBlockerStatus>;
};

export class VpnPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VpnPermissionError';
  }
}

const NATIVE_VPN_PERMISSION_ERROR = /(?:vpn|securityexception|permission|authorized|authorised|eperm).*(?:denied|revoked|missing|prepare|permission|access)|(?:denied|revoked|missing|prepare|permission|access).*(?:vpn|securityexception|permission|authorized|authorised|eperm)/i;

export function getWireGuardModule(): WireGuardNativeModule | null {
  return (NativeModules.WireGuardVpnModule as WireGuardNativeModule | undefined) ?? null;
}

export function isNativeVpnPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return NATIVE_VPN_PERMISSION_ERROR.test(message);
}

export async function clearAndroidVpnPermissionCache(): Promise<void> {
  if (Platform.OS === 'android') {
    await removeLocal(ANDROID_VPN_CONSENT_KEY);
  }
}

/**
 * Android only allows VPN consent through VpnService.prepare(). The native
 * module owns that activity result and reports whether the user approved it.
 */
export async function ensureAndroidVpnPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const module = getWireGuardModule();
  if (!module?.requestVpnPermission) {
    throw new VpnPermissionError(
      'This Android build does not include VPN permission support. Rebuild and reinstall the app.',
    );
  }

  let granted: boolean;
  try {
    granted = await module.requestVpnPermission();
  } catch {
    throw new VpnPermissionError(
      'Android could not open the VPN permission prompt. Try connecting again from the installed app.',
    );
  }

  if (!granted) {
    await removeLocal(ANDROID_VPN_CONSENT_KEY);
    throw new VpnPermissionError(
      'VPN permission was not granted. Allow the Android VPN connection request to connect.',
    );
  }

  await writeLocal(ANDROID_VPN_CONSENT_KEY, 'granted');
}

export async function getNativeTunnelStatus(): Promise<TunnelStatus | null> {
  const module = getWireGuardModule();
  if (!module) return null;
  await module.initialize();
  return module.getStatus();
}

export function subscribeToNativeTunnelStatus(listener: (status: TunnelStatus) => void): EmitterSubscription | null {
  if (Platform.OS !== 'android' || !getWireGuardModule()) return null;
  return DeviceEventEmitter.addListener('vpnStateChanged', listener);
}

export async function getNativeTrackerBlockerStatus(): Promise<TrackerBlockerStatus | null> {
  const module = getWireGuardModule();
  if (!module?.getTrackerBlockerStatus) return null;
  return module.getTrackerBlockerStatus();
}

export async function setNativeTrackerBlockerEnabled(enabled: boolean): Promise<TrackerBlockerStatus> {
  const module = getWireGuardModule();
  if (!module?.setTrackerBlockerEnabled) {
    throw new Error('This Android build does not include tracker blocker support. Rebuild and reinstall the app.');
  }
  return module.setTrackerBlockerEnabled(enabled);
}

export function subscribeToNativeTrackerBlockerStatus(
  listener: (status: TrackerBlockerStatus) => void,
): EmitterSubscription | null {
  if (Platform.OS !== 'android' || !getWireGuardModule()) return null;
  return DeviceEventEmitter.addListener('trackerBlockerStateChanged', listener);
}