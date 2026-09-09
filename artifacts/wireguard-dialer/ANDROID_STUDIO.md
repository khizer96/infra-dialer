# Android Studio build and phone test

This project includes a generated native Android project with the
`react-native-wireguard-vpn` module. Expo Go cannot test the VPN tunnel.

## Prerequisites

- Android Studio with its bundled JDK
- Android SDK installed through Android Studio
- Node.js and pnpm
- An Android phone with Developer options and USB debugging enabled

## Open the project

1. Download the entire Replit workspace, not only this artifact directory.
2. At the workspace root, run `pnpm install`.
3. In Android Studio, choose **Open** and select
   `artifacts/wireguard-dialer/android`.
4. Allow Android Studio to install any requested SDK components and finish
   Gradle synchronization.

Do not commit `android/local.properties`. Android Studio creates it with the
local Android SDK path.

## Run on a phone

1. Connect the unlocked phone by USB.
2. Accept the phone's USB debugging prompt.
3. Select the phone in Android Studio's device menu.
4. Select the `app` run configuration and click **Run**.
5. In Infra Dialer, enter the full profile API URL, username, and password.
6. Retrieve the profile, tap **Connect**, and approve Android's VPN prompt.
7. Confirm Android shows the VPN indicator, then verify traffic reaches a
   resource available only through the tunnel.
8. Tap **Disconnect** and confirm the VPN indicator disappears.

## Create the Internal Testing bundle

1. In Android Studio, choose **Build → Generate Signed Bundle / APK**.
2. Select **Android App Bundle**.
3. Create or select a release keystore and keep it backed up securely.
4. Build the release bundle.
5. Upload the generated `.aab` to the Google Play Console's
   **Internal testing** track.

Never commit the release keystore, its passwords, or `local.properties`.