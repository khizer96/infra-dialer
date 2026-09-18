---
name: Tracker blocker lifecycle
description: Native lifecycle constraints for the tunnel-only tracker and ad blocker TCP session.
---

Keep the tracker-blocker socket, desired enabled state, reconnect logic, and periodic stats polling in one serialized native worker. React Native should only display state and issue user actions.

**Why:** JavaScript timers and module instances are destroyed when the app UI is removed, while the Android VPN service and blocker session must continue. Socket reconnects must reapply the enabled command before requesting stats, and tunnel shutdown must finish disable/quit/close before lowering WireGuard.

**How to apply:** Any blocker protocol or lifecycle change must preserve single-worker socket ownership, persisted desired state, reconnect-before-stats ordering, atomic React listener replacement, and blocker shutdown before tunnel disconnect.