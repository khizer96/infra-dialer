import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
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
  profileRequestErrorMessage,
  refreshWireGuardProfile,
  validateProfileRequest,
} from '@/lib/profile';
import {
  clearAndroidVpnPermissionCache,
  ensureAndroidVpnPermission,
  getNativeTunnelStatus,
  getWireGuardModule,
  isNativeVpnPermissionError,
  VpnPermissionError,
} from '@/lib/tunnel';
import { readLocal, removeLocal, writeLocal } from '@/lib/storage';
import { generateWireGuardKeyPair } from '@/lib/keypair';

const ENDPOINT_KEY = 'wireguard.endpoint';
const PROFILE_KEY = 'wireguard.profile';

type ConnectionState = 'idle' | 'fetching' | 'ready' | 'connecting' | 'connected' | 'disconnected' | 'error';

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [endpoint, setEndpoint] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<WireGuardConfig | null>(null);
  const [state, setState] = useState<ConnectionState>('idle');
  const [message, setMessage] = useState('');
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;
    const restoreSavedState = async () => {
      try {
        const [savedEndpoint, savedProfile] = await Promise.all([readLocal(ENDPOINT_KEY), readLocal(PROFILE_KEY)]);
        if (!mounted) return;
        if (savedEndpoint) setEndpoint(savedEndpoint);
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
      } catch {
        if (mounted) setMessage('Could not load the saved profile from this device.');
      }
    };
    restoreSavedState();
    getNativeTunnelStatus().then((status) => {
      if (mounted && status?.isConnected) setState('connected');
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  const summary = useMemo(() => (profile ? profileSummary(profile) : null), [profile]);
  const isBusy = state === 'fetching' || state === 'connecting';
  const isConnected = state === 'connected';

  const fetchProfile = useCallback(async () => {
    const value = endpoint.trim();
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
      await writeLocal(ENDPOINT_KEY, value);
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
  }, [endpoint, password, username]);

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
      if (isConnected) {
        setState('connecting');
        await module.disconnect();
        setState('disconnected');
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      }
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
    Alert.alert('Remove saved profile?', 'This clears the endpoint and private profile from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeLocal(ENDPOINT_KEY);
          await removeLocal(PROFILE_KEY);
          setEndpoint('');
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
            disabled={isBusy || !profile}
            onPress={toggleConnection}
            style={({ pressed }) => [
              styles.connectButton,
              { backgroundColor: isConnected ? colors.secondary : colors.primary, opacity: pressed ? 0.82 : isBusy || !profile ? 0.45 : 1 },
            ]}
          >
            {isBusy ? <ActivityIndicator color={isConnected ? colors.foreground : colors.primaryForeground} /> : <Feather name={isConnected ? 'power' : 'zap'} size={18} color={isConnected ? colors.foreground : colors.primaryForeground} />}
            <Text style={[styles.connectLabel, { color: isConnected ? colors.foreground : colors.primaryForeground }]}>
              {isConnected ? 'Disconnect tunnel' : 'Connect tunnel'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Profile API</Text>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>POST credentials + public key</Text>
        </View>
        <View style={[styles.endpointCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.inputLabelRow}>
            <Feather name="link" size={15} color={colors.primary} />
            <Text style={[styles.inputLabel, { color: colors.secondaryForeground }]}>API ENDPOINT</Text>
          </View>
          <TextInput
            testID="endpoint-input"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://vpn.example.com:2083/api/v3/user/action"
            placeholderTextColor={colors.mutedForeground}
            value={endpoint}
            onChangeText={(value) => { setEndpoint(value); if (state === 'error') setState(profile ? 'ready' : 'idle'); }}
            style={[styles.input, { color: colors.foreground, borderColor: colors.input }]}
          />
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
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  sectionHint: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  endpointCard: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 11 },
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