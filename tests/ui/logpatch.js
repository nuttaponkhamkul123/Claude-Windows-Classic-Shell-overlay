const fs = require('fs');
console.log = (...a) => fs.appendFileSync(__dirname + '/log.txt', a.join(' ') + '\n');
