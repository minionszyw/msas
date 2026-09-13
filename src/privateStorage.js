const fs = require('fs');

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('private directory is not a regular directory');
  fs.chmodSync(directory, 0o700);
}

module.exports = { ensurePrivateDirectory };
