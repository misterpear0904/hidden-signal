const fs = require('fs');
const file = 'C:/Users/MisterPear/Development/hidden-signal/server/test_missileCommand.js';
let src = fs.readFileSync(file, 'utf8');

// Read replacement tests from file
const replacements = fs.readFileSync('C:/Users/MisterPear/Development/hidden-signal/server/replacements.txt', 'utf8');
const parts = replacements.split('===SPLIT===').filter(p => p.trim().length > 0);

// parts[0] = oldCheater, parts[1] = newCheater
// parts[2] = oldFire, parts[3] = newFire
// parts[4] = oldUpg, parts[5] = newUpg

if (parts.length !== 6) {
  console.error('Expected 6 parts, got', parts.length);
  process.exit(1);
}

for (let i = 0; i < 3; i++) {
  const old = parts[i * 2];
  const neu = parts[i * 2 + 1];
  if (!src.includes(old)) {
    console.error('Pattern', i, 'not found');
    process.exit(1);
  }
  src = src.replace(old, neu);
}

fs.writeFileSync(file, src);
console.log('done');
