const fs = require('fs');
const s = fs.readFileSync('test_missileCommand.js', 'utf8');
const idx = s.indexOf("test('AI: fires missiles");
console.log('found at:', idx);
if (idx >= 0) console.log(s.slice(idx, idx + 100));
