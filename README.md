# Infra Dialer

Infra Dialer is an Android WireGuard VPN client built with Expo and React Native. It fetches a WireGuard profile from:

```text
https://{host}:2083/api/v3/user/action
```

The app generates a fresh client key pair for every profile request, stores the resulting profile in Android secure storage, and never saves the profile-service password.

## Requirements

- Node.js and pnpm
- Android Studio with the Android SDK and NDK required by the project
- Java 17
- A physical Android device or emulator

Real VPN tunnels require a native Android APK. Expo Go can preview the interface but cannot load the WireGuard native module.

## Get the latest code

From the repository root:

```bash
git pull
pnpm install
```

Always run `pnpm install` after pulling. It applies the checked-in patches for the WireGuard native module and dependency compatibility.

## Versioning

The current Android release version is stored in `artifacts/wireguard-dialer/app.json`:

- `expo.version` is the user-visible semantic version, such as `1.2.0`.
- `expo.android.versionCode` is Android's internal monotonically increasing build number.

Gradle reads both values directly from `app.json`, so they cannot drift from the Expo configuration.

Before distributing each new change, choose one version command:

```bash
# Bug fix: 1.2.0 -> 1.2.1
pnpm --filter @workspace/wireguard-dialer run version:patch

# Backward-compatible feature: 1.2.0 -> 1.3.0
pnpm --filter @workspace/wireguard-dialer run version:minor

# Breaking release: 1.2.0 -> 2.0.0
pnpm --filter @workspace/wireguard-dialer run version:major
```

Each command also increments `versionCode` by one and synchronizes the private package version. Commit the version change with the feature or fix.

Do not run a version command repeatedly while retrying the same build. Bump once for the release, then use the clean build command as many times as needed.

## Clean release APK build

### Command line

From the repository root:

```bash
git pull
pnpm install
pnpm --filter @workspace/wireguard-dialer run android:release
```

The command runs Gradle `clean` followed by `assembleRelease`. The APK is written to:

```text
artifacts/wireguard-dialer/android/app/build/outputs/apk/release/app-release.apk
```

To bump the patch version and build in one command:

```bash
pnpm --filter @workspace/wireguard-dialer run release:patch
```

### Android Studio

1. Pull the latest repository changes.
2. Run `pnpm install` at the repository root.
3. Open `artifacts/wireguard-dialer/android` in Android Studio.
4. Wait for Gradle sync to finish.
5. Select **Build → Clean Project**.
6. Select **Build → Rebuild Project**.
7. Select the `release` build variant if building a release APK.
8. Build the APK and install the newly generated file.

If Android Studio still compiles an old native patch:

1. Close Android Studio.
2. Run `pnpm install --force` from the repository root.
3. Delete only `artifacts/wireguard-dialer/android/.gradle` and `artifacts/wireguard-dialer/android/app/build`.
4. Reopen Android Studio, sync Gradle, and rebuild.

## Install a fresh APK

Uninstall the previous app when native code, permissions, or the WireGuard patch changed:

```bash
adb uninstall com.infradialer.app
adb install artifacts/wireguard-dialer/android/app/build/outputs/apk/release/app-release.apk
```

Uninstalling clears the saved hosts and WireGuard profile. For JavaScript-only changes, an in-place upgrade is normally sufficient:

```bash
adb install -r artifacts/wireguard-dialer/android/app/build/outputs/apk/release/app-release.apk
```

## Verify a release

After installing:

1. Confirm Android shows the expected app version.
2. Add or select a profile host.
3. Fetch a profile and approve the Android VPN prompt.
4. Confirm the tunnel connects and Android shows its VPN indicator.
5. Enable **Tracker blocker** and confirm the blocked counter appears.
6. Wait at least 10 seconds and confirm the counter remains available after a stats refresh.
7. Background and reopen the app; it should still show **Tunnel active** and restore the tracker-blocker state.
8. Swipe the app away and reopen it; the active adapter and enabled tracker blocker should still be detected.
9. Disable **Tracker blocker** and confirm the control switches off.
10. Tap **Disconnect tunnel** and confirm the Android VPN indicator disappears.

For native failures, capture:

```bash
adb logcat -d | grep -E "WireGuard|GoBackend|WireGuardVpnModule|TrackerBlocker|AndroidRuntime"
```

## Signing warning

The current Gradle release configuration uses the debug keystore. This is suitable for direct device testing but not for Play Store distribution. Configure a private release signing key before publishing, keep its credentials outside Git, and never commit keystores or passwords.