---
name: Expo publish startup
description: Why the mobile artifact’s production server should start directly rather than through a package script.
---

Run the Expo artifact’s dependency-free production HTTP server directly with Node instead of routing production startup through pnpm.

**Why:** Replit’s publish build prunes build-time packages after generating the static Expo bundles. A pnpm-mediated production command can then fail before binding its port, causing Autoscale promotion health checks to time out even though the build succeeded.

**How to apply:** Keep the production startup probe on a route that returns HTTP 200 and preserve a direct Node production run command when adjusting this mobile artifact’s publish configuration.