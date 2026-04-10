---
name: simulate
description: Simulate a rate limit to test the auto-resume daemon flow
---

Simulate a rate limit detection by creating a status.json with `detected: true` and `reset_time` set to 30 seconds from now.

This is useful for testing the full auto-resume flow without waiting for an actual rate limit.

Run the simulation script:

```bash
node scripts/simulate.js
```

The daemon will detect the simulated status and start a 30-second countdown, then attempt to send the resume keystroke.
