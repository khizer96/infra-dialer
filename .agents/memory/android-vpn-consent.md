---
name: Android VPN consent
description: Durable behavior required when Android VPN access can be revoked outside the app.
---

Request consent through a native bridge that calls `VpnService.prepare()` and awaits the activity result. A generic intent action cannot reliably open Android's VPN approval dialog. Treat any stored consent result as an optimization, not proof that access remains granted.

**Why:** Android gates VPN approval behind `VpnService.prepare()`, and users can later revoke access from system settings while app storage remains unchanged.

**How to apply:** Await the native permission result before connecting. Keep Android's consent activity as the source of truth and clear cached approval after a native permission failure.