import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import sharp from 'sharp';
const require=createRequire(import.meta.url);
if(process.platform!=='win32')throw new Error('Questo script prepara il pacchetto sul PC Windows.');
const arch=process.argv[2]||process.arch;
if(!['arm64','x64'].includes(arch))throw new Error('Architettura supportata: arm64 oppure x64.');
if(arch!==process.arch)throw new Error('Usa una toolchain Node/Electron della stessa architettura del pacchetto; nessuna conversione implicita dei moduli nativi.');
const disk=await fs.statfs('.');
let incremental=false;try{const prior=JSON.parse(await fs.readFile(`release/windows/win-${arch}-unpacked/verifica-pacchetto.json`,'utf8'));incremental=prior.architecture===arch&&prior.privateFilesExcluded===true&&prior.nativeDependenciesPresent===true;}catch{}
const needed=(incremental?1:2)*1024**3;
if(disk.bavail*disk.bsize<needed)throw new Error(`Spazio insufficiente: occorrono almeno ${incremental?1:2} GiB liberi per questa build Windows. Nessun file rimosso.`);
const electronExe=path.join('node_modules/electron/dist/electron.exe');
const pe=await fs.readFile(electronExe),machine=pe.readUInt16LE(pe.readUInt32LE(0x3c)+4);
if(machine!==(arch==='arm64'?0xaa64:0x8664))throw new Error('Il runtime Electron non corrisponde all’architettura richiesta.');
execFileSync(process.execPath,[path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc'),'--noEmit'],{stdio:'inherit',windowsHide:true});
execFileSync(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'build'],{stdio:'inherit',windowsHide:true});
await fs.mkdir('output/windows-build',{recursive:true});
// The existing book mark, in the author's lilac/coral/petrol palette.
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="54" fill="#b59bd9"/><g transform="translate(32 30) scale(8)" fill="none" stroke="#155e70" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path fill="#fff8f2" d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15M6 8h3M6 12h3M15 8h3M15 12h3"/><path stroke="#ed7971" stroke-width="2" d="M17 4v5"/></g></svg>';
const png=await sharp(Buffer.from(svg)).png().toBuffer(),header=Buffer.alloc(22);
header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
await fs.writeFile('output/windows-build/icon.ico',Buffer.concat([header,png]));
execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--win','nsis','--'+arch,'--publish','never','--config','electron-builder.cjs'],{stdio:'inherit',windowsHide:true});
