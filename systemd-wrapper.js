#!/usr/bin/env node
/**
 * Systemd wrapper for the auto-resume daemon.
 *
 * Solves two problems when running under systemd (Type=simple, no TTY):
 * 1. Node's event loop can drain before async handles register — the TCP
 *    server anchor below keeps it alive.
 * 2. The daemon module has `if (require.main === module)` guard, so we
 *    must call main() explicitly after require().
 */
'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');

// Create an event loop anchor FIRST, before loading the daemon
const keepAlive = net.createServer();
keepAlive.listen(0, '127.0.0.1');

// Prevent unhandled rejections from killing the process
process.on('unhandledRejection', (reason) => {
  const msg = `[${new Date().toISOString()}] UNHANDLED_REJECTION: ${reason}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'daemon.log'), msg);
  } catch (e) { /* ignore */ }
});

// Load and run the daemon
// NOTE: require.main !== module when loaded via require(), so the daemon's
// `if (require.main === module) { main(); }` guard won't trigger.
// We must call main() explicitly.
process.argv[2] = process.argv[2] || 'monitor';
const daemon = require('./auto-resume-daemon.js');
daemon.main();
