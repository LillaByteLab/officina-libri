const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function verifyWindows(context) {
  const root = context.appOutDir;
  const exe = await fs.readFile(path.join(root, 'Officina Libri Beta.exe'));
  assert.equal(exe.toString('ascii', 0, 2), 'MZ');
  const machine = exe.readUInt16LE(exe.readUInt32LE(0x3c) + 4);
  const arch = machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : null;
  assert.ok(arch, 'Architettura PE Windows non supportata');
  const app = path.join(root, 'resources/app');
  const allowed = new Set(['desktop', 'packages', 'dist', 'node_modules', 'package.json', 'LICENSE']);
  for (const name of await fs.readdir(app)) assert.ok(allowed.has(name), 'File inatteso nel pacchetto: '+name);
  for (const name of ['desktop/main.cjs', 'desktop/preload.cjs', 'dist/index.html', 'packages/novel-worker.mjs',
    `node_modules/@myriaddreamin/typst-ts-node-compiler-win32-${arch}-msvc/package.json`,
    `node_modules/@img/sharp-win32-${arch}/package.json`]) await fs.access(path.join(app, name));
  let count = 0;
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, {withFileTypes:true})) {
      const file = path.join(folder, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Link non ammesso nel pacchetto');
      if (entry.isDirectory()) await walk(file);
      else {
        count++;
        assert.ok(!/\.(?:docx|pdf|epub|ttf|otf|officinazip|keystore|key|p12)$/i.test(entry.name), 'File editoriale o chiave nel pacchetto: '+file);
        assert.ok(!/^\.env|^manifest\.json$|^romanzo\.json$/i.test(entry.name), 'Dati privati nel pacchetto: '+file);
      }
    }
  }
  await walk(app);
  const report = {architecture:arch, files:count, entrypoint:'desktop/main.cjs', privateFilesExcluded:true, nativeDependenciesPresent:true};
  await fs.writeFile(path.join(root, 'verifica-pacchetto.json'), JSON.stringify(report,null,2));
  console.log('Pacchetto Windows verificato: '+JSON.stringify(report));
};
