---
name: Android tunnel lifecycle
description: How the app must recover and control a WireGuard tunnel after its React Native activity or module is recreated.
---

Use a stable native tunnel name, recreate the backend/tunnel handle when the module initializes, and query native state whenever the app becomes active. Disconnect must not depend on an in-memory profile configuration.

**Why:** WireGuard’s foreground VPN service can outlive the React Native activity. Module fields may be lost while the adapter remains active, which otherwise makes the UI report disconnected and prevents users from stopping it.

**How to apply:** Keep the foreground service independent of the task, subscribe to native state events while mounted, poll on resume/relaunch, and allow Disconnect whenever native state is connected even if profile restoration failed.