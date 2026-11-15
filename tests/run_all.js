'use strict';

// Ejecuta cada prueba unitaria (tests/extension/*.test.js) en su propio proceso de Node
// y termina con código 1 si alguna falla. No usa las pruebas de navegador.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'extension');
const files = fs.readdirSync(dir).filter(name => name.endsWith('.test.js')).sort();

let failures = 0;
for (const file of files) {
  console.log(`\n== ${path.posix.join('tests/extension', file)}`);
  const result = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
  if (result.status !== 0) {
    failures++;
    console.error(`FALLO: ${file} (código ${result.status === null ? result.signal : result.status})`);
  }
}

console.log(`\n${files.length - failures}/${files.length} archivos de prueba superados.`);
process.exit(failures === 0 ? 0 : 1);
