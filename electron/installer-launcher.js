const { spawn } = require('node:child_process');
function launchInstaller(installer, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(installer, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
module.exports = { launchInstaller };
