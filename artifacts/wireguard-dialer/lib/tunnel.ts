import { NativeModules } from 'react-native';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import type { WireGuardConfig } from './wireguard';
import { readLocal, removeLocal, writeLocal } from './storage';

const ANDROID_VPN_CONSENT_ACTION = 'android.net.VpnService';
const ANDROID_VPN_CONSENT_KEY = 'wireguard.androidVpnConsent';

type TunnelStatus = {
  isConnected: boolean;
  tunnelState: string;
  status: string;
  error?: string;
};

type WireGuardNativeModule = {
  initialize: () => Promise<void>;
  connect: (config: WireGuardConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  getStatus: () => Promise<TunnelStatus>;
  isSupported: () => Promise<boolean>;
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
 * The installed WireGuard module does not expose Android's VpnService.prepare().
 * Keep the one-time consent result in secure storage, then use Expo's intent
 * launcher to await the system confirmation activity when consent is needed.
 *
 * The native module remains the source of truth after a user revokes VPN
 * access in Android Settings. The connect path clears this cache when the
 * native error identifies a permission failure, allowing the next retry to
 * request consent again.
 */
export async function ensureAndroidVpnPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;

  if (await readLocal(ANDROID_VPN_CONSENT_KEY) === 'granted') return;

  const packageName = Constants.expoConfig?.android?.package;
  if (!packageName) {
    throw new VpnPermissionError(
      'The Android app package is unavailable, so VPN permission cannot be requested.',
    );
  }

  let result: IntentLauncher.IntentLauncherResult;
  try {
    result = await IntentLauncher.startActivityAsync(ANDROID_VPN_CONSENT_ACTION, {
      extra: { [ANDROID_VPN_CONSENT_ACTION]: packageName },
    });
  } catch {
    throw new VpnPermissionError(
      'Android could not open the VPN permission prompt. Try connecting again from the installed app.',
    );
  }

  if (result.resultCode !== IntentLauncher.ResultCode.Success) {
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
  return module.getStatus();
}