---
"@pax8/cli": patch
---

Telemetry failure events now report the real `demo_mode`. It was hard-coded to `false` on every failure event (and read from `PAX8_DEMO` only on SIGINT), so demo-mode and test-suite failures showed up as live-API failures. Failure and SIGINT events now use the same resolved demo mode (env or `config.demo`) as success events; parse-time failures resolve it on the spot.
