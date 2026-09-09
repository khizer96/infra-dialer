---
name: Android VPN consent
description: Durable behavior required when Android VPN access can be revoked outside the app.
---

The stored Android VPN consent result is only a prompt-avoidance optimization, not proof that the system still grants access. If the native tunnel reports a permission-related failure, invalidate the cached result so the next connection attempt can request consent again.

**Why:** Users can revoke VPN access from Android system settings while the app's secure storage remains unchanged.

**How to apply:** Keep Android's consent activity as the source of truth for first approval and retries; preserve the cache only for already-approved installs, and clear it on a native permission failure.