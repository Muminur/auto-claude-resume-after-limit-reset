const path = require('path');
const { execSync, spawn } = require('child_process');
const fs = require('fs');

const snoretoastPath = path.join(
  require.resolve('node-notifier'),
  '..', 'vendor', 'snoreToast', 'snoretoast-x64.exe'
);

console.log('Snoretoast path:', snoretoastPath);
console.log('Exists:', fs.existsSync(snoretoastPath));

// Run snoretoast directly
const proc = spawn(snoretoastPath, [
  '-t', 'Auto-Resume Test',
  '-m', 'If you see this, notifications work!',
  '-p', path.join(__dirname, 'node_modules/node-notifier/vendor/snoreToast/Snoretoast.lnk')
], { stdio: 'inherit' });

proc.on('close', (code) => {
  console.log('Exit code:', code);
  if (code === 0) {
    console.log('SUCCESS: Notification sent');
  } else {
    console.log('Check Windows Action Center / Notification settings');
  }
});
