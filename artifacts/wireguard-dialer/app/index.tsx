import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  parseStoredWireGuardProfile,
  profileSummary,
  validateWireGuardConfig,
  type WireGuardConfig,
} from '@/lib/wireguard';
import {
  buildProfileEndpoint,
  normalizeProfileHost,
  parseStoredHosts,
  profileRequestErrorMessage,
  refreshWireGuardProfile,
  validateProfileRequest,
} from '@/lib/profile';
import {
  clearAndroidVpnPermissionCache,
  ensureAndroidVpnPermission,
  getNativeTrackerBlockerStatus,
  getNativeTunnelStatus,
  getWireGuardModule,
  isNativeVpnPermissionError,
  setNativeTrackerBlockerEnabled,
  subscribeToNativeTrackerBlockerStatus,
  subscribeToNativeTunnelStatus,
  type TrackerBlockerStatus,
  VpnPermissionError,
} from '@/lib/tunnel';
import { readLocal, removeLocal, writeLocal } from '@/lib/storage';
import { generateWireGuardKeyPair } from '@/lib/keypair';

const LEGACY_ENDPOINT_KEY = 'wireguard.endpoint';
const HOSTS_KEY = 'wireguard.hosts';
const SELECTED_HOST_KEY = 'wireguard.selectedHost';
const PROFILE_KEY = 'wireguard.profile';
const EMPTY_TRACKER_STATUS: TrackerBlockerStatus = {
  enabled: false,
  socketConnected: false,
  counter: null,
  error: null,
};

type ConnectionState = 'idle' | 'fetching' | 'ready' | 'connecting' | 'connected' | 'disconnected' | 'error';

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [host, setHost] = useState('');
  const [savedHosts, setSavedHosts] = useState<string[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<WireGuardConfig | null>(null);
  const [state, setState] = useState<ConnectionState>('idle');
  const [message, setMessage] = useState('');
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [trackerStatus, setTrackerStatus] = useState<TrackerBlockerStatus>(EMPTY_TRACKER_STATUS);
  const [trackerBusy, setTrackerBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const restoreSavedState = async () => {
      try {
        const [storedHosts, selectedHost, legacyEndpoint, savedProfile] = await Promise.all([
          readLocal(HOSTS_KEY),
          readLocal(SELECTED_HOST_KEY),
          readLocal(LEGACY_ENDPOINT_KEY),
          readLocal(PROFILE_KEY),
        ]);
        if (!mounted) return;
        const restoredHosts = parseStoredHosts(storedHosts);
        const migratedHost = normalizeProfileHost(selectedHost || legacyEndpoint || '');
        const nextHosts = migratedHost && !restoredHosts.includes(migratedHost)
          ? [migratedHost, ...restoredHosts]
          : restoredHosts;
        setSavedHosts(nextHosts);
        setHost(migratedHost || nextHosts[0] || '');
        if (migratedHost) {
          await Promise.all([
            writeLocal(HOSTS_KEY, JSON.stringify(nextHosts)),
            writeLocal(SELECTED_HOST_KEY, migratedHost),
            removeLocal(LEGACY_ENDPOINT_KEY),
          ]);
        }
        if (savedProfile) {
          try {
            setProfile(parseStoredWireGuardProfile(savedProfile));
            setState('ready');
          } catch {
            setProfile(null);
            setState('error');
            try {
              await removeLocal(PROFILE_KEY);
              if (mounted) setMessage('The saved profile was invalid and has been cleared. Fetch a new profile to reconnect.');
            } catch {
              if (mounted) setMessage('The saved profile is invalid and could not be cleared. Remove it from device storage, then fetch a new profile.');
            }
          }
        }
        const status = await getNativeTunnelStatus();
        if (mounted && status?.isConnected) {
          setState('connected');
          const restoredTrackerStatus = await getNativeTrackerBlockerStatus();
          if (mounted && restoredTrackerStatus) setTrackerStatus(restoredTrackerStatus);
        }
      } catch {
        if (mounted) setMessage('Could not load the saved profile from this device.');
      }
    };
    restoreSavedState();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const syncTunnelStatus = () => {
      getNativeTunnelStatus().then(async (status) => {
        if (!status) return;
        setState((current) => status.isConnected
          ? 'connected'
          : current === 'connected' || current === 'connecting'
            ? 'disconnected'
            : current);
        if (status.isConnected) {
          const nextTrackerStatus = await getNativeTrackerBlockerStatus();
          if (nextTrackerStatus) setTrackerStatus(nextTrackerStatus);
        } else {
          setTrackerStatus(EMPTY_TRACKER_STATUS);
        }
      }).catch(() => undefined);
    };
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') syncTunnelStatus();
    });
    const tunnelSubscription = subscribeToNativeTunnelStatus((status) => {
      setState(status.isConnected ? 'connected' : status.status === 'ERROR' ? 'error' : 'disconnected');
      if (!status.isConnected) setTrackerStatus(EMPTY_TRACKER_STATUS);
    });
    const trackerSubscription = subscribeToNativeTrackerBlockerStatus(setTrackerStatus);
    return () => {
      appStateSubscription.remove();
      tunnelSubscription?.remove();
      trackerSubscription?.remove();
    };
  }, []);

  const summary = useMemo(() => (profile ? profileSummary(profile) : null), [profile]);
  const endpointPreview = useMemo(() => {
    try {
      return host ? buildProfileEndpoint(host) : 'https://{host}:2083/api/v3/user/action';
    } catch {
      return 'Enter a valid host to build the profile URL.';
    }
  }, [host]);
  const isBusy = state === 'fetching' || state === 'connecting';
  const isConnected = state === 'connected';

  const toggleTrackerBlocker = useCallback(async (enabled: boolean) => {
    setTrackerBusy(true);
    setMessage('');
    try {
      const nextStatus = await setNativeTrackerBlockerEnabled(enabled);
      setTrackerStatus(nextStatus);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The tracker blocker command failed.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setTrackerBusy(false);
    }
  }, []);

  const saveHostEntry = useCallback(async (candidate: string) => {
    const normalizedHost = normalizeProfileHost(candidate);
    if (!normalizedHost) {
      setState('error');
      setMessage('Enter a valid host name or IP address.');
      return null;
    }
    const nextHosts = [normalizedHost, ...savedHosts.filter((entry) => entry !== normalizedHost)];
    setHost(normalizedHost);
    setSavedHosts(nextHosts);
    await Promise.all([
      writeLocal(HOSTS_KEY, JSON.stringify(nextHosts)),
      writeLocal(SELECTED_HOST_KEY, normalizedHost),
    ]);
    return normalizedHost;
  }, [savedHosts]);

  const selectHost = useCallback(async (selectedHost: string) => {
    setHost(selectedHost);
    setMessage('');
    await writeLocal(SELECTED_HOST_KEY, selectedHost);
  }, []);

  const removeHostEntry = useCallback(async (removedHost: string) => {
    const nextHosts = savedHosts.filter((entry) => entry !== removedHost);
    const nextSelectedHost = host === removedHost ? nextHosts[0] || '' : host;
    setSavedHosts(nextHosts);
    setHost(nextSelectedHost);
    await writeLocal(HOSTS_KEY, JSON.stringify(nextHosts));
    if (nextSelectedHost) await writeLocal(SELECTED_HOST_KEY, nextSelectedHost);
    else await removeLocal(SELECTED_HOST_KEY);
  }, [host, savedHosts]);

  const fetchProfile = useCallback(async () => {
    const value = normalizeProfileHost(host);
    const validationMessage = validateProfileRequest(value, username, password);
    if (validationMessage) {
      setState('error');
      setMessage(validationMessage);
      return;
    }
    setState('fetching');
    setMessage('');
    try {
      const validatedProfile = validateWireGuardConfig(await refreshWireGuardProfile(value, username, password, {
        fetchImpl: fetch,
        generateKeyPair: generateWireGuardKeyPair,
      }));
      await saveHostEntry(value);
      await writeLocal(PROFILE_KEY, JSON.stringify(validatedProfile));
      setProfile(validatedProfile);
      setLastFetched(new Date());
      setState('ready');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setState('error');
      setMessage(profileRequestErrorMessage(error));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [host, password, saveHostEntry, username]);

  const toggleConnection = useCallback(async () => {
    const module = getWireGuardModule();
    if (!module) {
      Alert.alert(
        'Android build required',
        'The live preview cannot start a VPN tunnel. Install a development APK or production Android build with the WireGuard module enabled.',
        [{ text: 'Okay' }],
      );
      return;
    }
    if (isConnected) {
      setMessage('');
      setState('connecting');
      try {
        await module.initialize();
        await module.disconnect();
        setState('disconnected');
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (error) {
        setState('error');
        setMessage(error instanceof Error ? error.message : 'The tunnel could not be stopped.');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }
    if (!profile) {
      setMessage('Fetch a profile before connecting.');
      return;
    }
    let validatedProfile: WireGuardConfig;
    try {
      validatedProfile = validateWireGuardConfig(profile);
    } catch {
      setProfile(null);
      setState('error');
      setMessage('The saved profile is invalid. Fetch a new profile before connecting.');
      try {
        await removeLocal(PROFILE_KEY);
      } catch {
        setMessage('The saved profile is invalid and could not be cleared. Remove it from device storage, then fetch a new profile.');
      }
      return;
    }
    setMessage('');
    try {
      setState('connecting');
      await module.initialize();
      const supported = await module.isSupported();
      if (!supported) throw new Error('This Android device does not support WireGuard tunnels.');
      await ensureAndroidVpnPermission();
       await module.connect(validatedProfile);
      setState('connected');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if (error instanceof VpnPermissionError) {
        setState('disconnected');
        setMessage(error.message);
      } else {
        if (isNativeVpnPermissionError(error)) {
          await clearAndroidVpnPermissionCache();
          setState('disconnected');
          setMessage('Android VPN access is no longer approved. Tap Connect tunnel to review the permission again.');
        } else {
          setState('error');
          setMessage(error instanceof Error ? error.message : 'The tunnel could not be started.');
        }
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [isConnected, profile]);

  const clearProfile = useCallback(() => {
    Alert.alert('Remove saved profile?', 'This clears the private WireGuard profile. Saved hosts remain available.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeLocal(PROFILE_KEY);
          setUsername('');
          setPassword('');
          setProfile(null);
          setLastFetched(null);
          setState('idle');
          setMessage('');
        },
      },
    ]);
  }, []);

  const statusLabel = isConnected ? 'Tunnel active' : state === 'connecting' ? 'Connecting' : profile ? 'Profile ready' : 'Not configured';
  const statusColor = isConnected ? colors.primary : state === 'error' ? colors.destructive : colors.mutedForeground;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={[styles.logo, { backgroundColor: colors.accent }]}>
            <Feather name="shield" size={22} color={colors.primary} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>WIREGUARD DIALER</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Private by default.</Text>
          </View>
          <Pressable
            accessibilityLabel="Open WireGuard documentation"
            onPress={() => Linking.openURL('https://www.wireguard.com/quickstart/')}
            style={({ pressed }) => [styles.infoButton, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="info" size={19} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: isConnected ? colors.primary : colors.border }]}>
          <View style={styles.statusTopline}>
            <View style={styles.statusIndicator}>
              <View style={[styles.dot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {profile && <Text style={[styles.statusMeta, { color: colors.mutedForeground }]}>{summary?.server}</Text>}
          </View>
          <View style={styles.statusBody}>
            <View style={[styles.radar, { borderColor: isConnected ? colors.primary : colors.border }]}>
              <View style={[styles.radarInner, { borderColor: isConnected ? colors.primary : colors.border }]}>
                <Feather name={isConnected ? 'lock' : 'wifi-off'} size={29} color={isConnected ? colors.primary : colors.mutedForeground} />
              </View>
            </View>
            <View style={styles.statusDescription}>
              <Text style={[styles.statusHeadline, { color: colors.foreground }]}>
                {isConnected ? 'Your connection is protected' : profile ? 'Ready when you are' : 'Connect a private tunnel'}
              </Text>
              <Text style={[styles.statusSubcopy, { color: colors.mutedForeground }]}>
                {isConnected ? 'Traffic is routing through your WireGuard peer.' : 'Fetch a profile from your host to begin.'}
              </Text>
            </View>
          </View>
          <Pressable
            testID="connect-button"
            disabled={isBusy || (!profile && !isConnected)}
            onPress={toggleConnection}
            style={({ pressed }) => [
              styles.connectButton,
              { backgroundColor: isConnected ? colors.secondary : colors.primary, opacity: pressed ? 0.82 : isBusy || (!profile && !isConnected) ? 0.45 : 1 },
            ]}
          >
            {isBusy ? <ActivityIndicator color={isConnected ? colors.foreground : colors.primaryForeground} /> : <Feather name={isConnected ? 'power' : 'zap'} size={18} color={isConnected ? colors.foreground : colors.primaryForeground} />}
            <Text style={[styles.connectLabel, { color: isConnected ? colors.foreground : colors.primaryForeground }]}>
              {isConnected ? 'Disconnect tunnel' : 'Connect tunnel'}
            </Text>
          </Pressable>
        </View>

        {isConnected ? (
          <View style={[styles.trackerCard, { backgroundColor: colors.card, borderColor: trackerStatus.enabled ? colors.primary : colors.border }]}>
            <View style={styles.trackerHeader}>
              <View style={[styles.trackerIcon, { backgroundColor: colors.accent }]}>
                <Feather name="shield" size={18} color={colors.primary} />
              </View>
              <View style={styles.trackerCopy}>
                <Text style={[styles.trackerTitle, { color: colors.foreground }]}>Enable tracker blocker</Text>
                <Text style={[styles.trackerSubtitle, { color: colors.mutedForeground }]}>
                  {trackerStatus.enabled
                    ? trackerStatus.socketConnected ? 'Tracker and ad blocking active' : 'Reconnecting blocker service'
                    : 'Block trackers and ads through the tunnel'}
                </Text>
              </View>
              {trackerBusy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  testID="tracker-blocker-toggle"
                  accessibilityLabel="Enable tracker blocker"
                  value={trackerStatus.enabled}
                  onValueChange={toggleTrackerBlocker}
                  trackColor={{ false: colors.input, true: colors.primary }}
                  thumbColor={trackerStatus.enabled ? colors.primaryForeground : colors.mutedForeground}
                />
              )}
            </View>
            {trackerStatus.enabled ? (
              <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.statsLabel, { color: colors.mutedForeground }]}>Blocked counter</Text>
                <Text testID="tracker-counter" style={[styles.statsValue, { color: colors.primary }]}>
                  {trackerStatus.counter ?? '—'}
                </Text>
              </View>
            ) : null}
            {trackerStatus.error ? (
              <Text style={[styles.trackerError, { color: colors.destructive }]}>{trackerStatus.error}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Profile API</Text>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>POST credentials + public key</Text>
        </View>
        <View style={[styles.endpointCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.inputLabelRow}>
            <Feather name="link" size={15} color={colors.primary} />
             <Text style={[styles.inputLabel, { color: colors.secondaryForeground }]}>API HOST</Text>
          </View>
          {savedHosts.length > 0 ? (
            <View style={styles.hostList}>
              {savedHosts.map((savedHost) => (
                <View key={savedHost} style={[styles.hostChip, { borderColor: host === savedHost ? colors.primary : colors.border }]}>
                  <Pressable onPress={() => selectHost(savedHost)} style={styles.hostSelect}>
                    <Feather name="server" size={13} color={host === savedHost ? colors.primary : colors.mutedForeground} />
                    <Text numberOfLines={1} style={[styles.hostText, { color: host === savedHost ? colors.primary : colors.foreground }]}>{savedHost}</Text>
                  </Pressable>
                  <Pressable accessibilityLabel={`Remove ${savedHost}`} onPress={() => removeHostEntry(savedHost)} hitSlop={8}>
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.hostInputRow}>
          <TextInput
             testID="host-input"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
             placeholder="vpn.example.com"
            placeholderTextColor={colors.mutedForeground}
             value={host}
             onChangeText={(value) => { setHost(value); if (state === 'error') setState(profile ? 'ready' : 'idle'); }}
             style={[styles.input, styles.hostInput, { color: colors.foreground, borderColor: colors.input }]}
          />
            <Pressable
              accessibilityLabel="Save host"
              onPress={() => saveHostEntry(host)}
              style={({ pressed }) => [styles.saveHostButton, { backgroundColor: colors.accent, opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="plus" size={19} color={colors.primary} />
            </Pressable>
          </View>
          <Text numberOfLines={1} style={[styles.helper, { color: colors.mutedForeground }]}>
            {endpointPreview}
          </Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Your password is used only for this request and is never saved.</Text>
          <View style={styles.credentialsRow}>
            <View style={styles.credentialField}>
              <Text style={[styles.inputLabel, { color: colors.secondaryForeground }]}>USERNAME</Text>
              <TextInput
                testID="username-input"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="test0s9276335"
                placeholderTextColor={colors.mutedForeground}
                value={username}
                onChangeText={(value) => { setUsername(value); if (state === 'error') setState(profile ? 'ready' : 'idle'); }}
                style={[styles.input, styles.smallInput, { color: colors.foreground, borderColor: colors.input }]}
              />
            </View>
            <View style={styles.credentialField}>
              <Text style={[styles.inputLabel, { color: colors.secondaryForeground }]}>PASSWORD</Text>
              <TextInput
                testID="password-input"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry
                value={password}
                onChangeText={(value) => { setPassword(value); if (state === 'error') setState(profile ? 'ready' : 'idle'); }}
                style={[styles.input, styles.smallInput, { color: colors.foreground, borderColor: colors.input }]}
              />
            </View>
          </View>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>A fresh WireGuard key pair is generated on every profile request.</Text>
          <Pressable
            testID="fetch-profile-button"
            disabled={isBusy}
            onPress={fetchProfile}
            style={({ pressed }) => [styles.fetchButton, { borderColor: colors.border, opacity: pressed ? 0.72 : isBusy ? 0.5 : 1 }]}
          >
            {state === 'fetching' ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="download-cloud" size={17} color={colors.primary} />}
            <Text style={[styles.fetchLabel, { color: colors.primary }]}>{profile ? 'Refresh profile' : 'Fetch profile'}</Text>
          </Pressable>
        </View>

        {message ? (
          <View style={[styles.message, { backgroundColor: state === 'error' ? '#2A191B' : colors.accent }]}>
            <Feather name={state === 'error' ? 'alert-circle' : 'check-circle'} size={17} color={state === 'error' ? colors.destructive : colors.primary} />
            <Text style={[styles.messageText, { color: state === 'error' ? '#FFB3AB' : colors.accentForeground }]}>{message}</Text>
          </View>
        ) : null}

        {summary ? (
          <View style={[styles.detailsCard, { borderTopColor: colors.border }]}>
            <View style={styles.detailHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active profile</Text>
                <Text style={[styles.detailCaption, { color: colors.mutedForeground }]}>
                  {lastFetched ? `Fetched ${lastFetched.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved on this device'}
                </Text>
              </View>
              <Feather name="check-circle" size={20} color={colors.primary} />
            </View>
            <DetailRow icon="globe" label="Peer" value={summary.server} colors={colors} />
            <DetailRow icon="navigation" label="Routes" value={summary.routes} colors={colors} />
            <DetailRow icon="crosshair" label="Tunnel address" value={summary.address} colors={colors} />
            <Pressable onPress={clearProfile} style={({ pressed }) => [styles.removeButton, { opacity: pressed ? 0.6 : 1 }]}>
              <Feather name="trash-2" size={15} color={colors.destructive} />
              <Text style={[styles.removeLabel, { color: colors.destructive }]}>Remove saved profile</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.privacyNote}>
            <Feather name="lock" size={16} color={colors.mutedForeground} />
            <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
              {Platform.OS === 'web' ? 'The browser preview uses local device storage. Android builds keep your profile in secure storage.' : 'Your profile is stored securely on this device and never uploaded here.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function DetailRow({ icon, label, value, colors }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.detailRow}>
      <Feather name={icon} size={16} color={colors.mutedForeground} />
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, gap: 3 },
  eyebrow: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.6 },
  title: { fontSize: 25, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  infoButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statusCard: { borderRadius: 24, borderWidth: 1, padding: 19, gap: 19 },
  statusTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  statusIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.4 },
  statusMeta: { flex: 1, textAlign: 'right', fontSize: 11, fontFamily: 'Inter_500Medium' },
  statusBody: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  radar: { width: 86, height: 86, borderRadius: 43, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  radarInner: { width: 60, height: 60, borderRadius: 30, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statusDescription: { flex: 1, gap: 7 },
  statusHeadline: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  statusSubcopy: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular' },
  connectButton: { minHeight: 52, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  connectLabel: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  trackerCard: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 14 },
  trackerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trackerIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  trackerCopy: { flex: 1, gap: 3 },
  trackerTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  trackerSubtitle: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular' },
  statsRow: { borderTopWidth: 1, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statsLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  statsValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  trackerError: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_500Medium' },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  sectionHint: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  endpointCard: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 11 },
  hostList: { gap: 8 },
  hostChip: { minHeight: 38, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  hostSelect: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  hostText: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  hostInputRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  hostInput: { flex: 1 },
  saveHostButton: { width: 50, height: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  inputLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  inputLabel: { fontSize: 10, letterSpacing: 1.2, fontFamily: 'Inter_700Bold' },
  input: { height: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, fontSize: 14, fontFamily: 'Inter_500Medium' },
  credentialsRow: { flexDirection: 'row', gap: 10 },
  credentialField: { flex: 1, gap: 7 },
  smallInput: { height: 46, fontSize: 13 },
  helper: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular' },
  fetchButton: { height: 44, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  fetchLabel: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  message: { borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  messageText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: 'Inter_500Medium' },
  detailsCard: { borderTopWidth: 1, paddingTop: 19, gap: 16 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  detailCaption: { fontSize: 11, marginTop: 4, fontFamily: 'Inter_400Regular' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailLabel: { width: 82, fontSize: 12, fontFamily: 'Inter_500Medium' },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  removeButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 },
  removeLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 3, paddingBottom: 6 },
  privacyText: { flex: 1, fontSize: 11, lineHeight: 17, fontFamily: 'Inter_400Regular' },
});