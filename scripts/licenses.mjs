import fs from 'node:fs/promises';
import path from 'node:path';
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));
const list=[];
for(const [location,meta] of Object.entries(lock.packages)) {
  if(!location)continue;
  const file=path.join(location,'package.json');
  try {const p=JSON.parse(await fs.readFile(file,'utf8'));list.push({name:p.name,version:p.version,license:p.license||'SCONOSCIUTA',dev:!!meta.dev,repository:typeof p.repository==='string'?p.repository:p.repository?.url});}
  catch(e) {if(!meta.optional)throw e;}
}
list.sort((a,b)=>a.name.localeCompare(b.name));
await fs.mkdir('docs',{recursive:true});await fs.writeFile('docs/dependency-licenses.json',JSON.stringify({generatedAt:new Date().toISOString(),scope:'Pacchetti npm installati; binario Chromium/FFmpeg richiede audit separato prima di distribuire',packages:list},null,2));
// Specifico pacchetto nativo riesaminato: avvisi/obblighi in docs/LABORATORIO_IMMAGINI.md.
const auditedSharp=x=>x.name==='@img/sharp-win32-arm64'&&x.version==='0.35.5'&&x.license==='Apache-2.0 AND LGPL-3.0-or-later';
const unknown=list.filter(x=>!['MIT','Apache-2.0','BSD-3-Clause','BSD-2-Clause','ISC','(MIT OR CC0-1.0)','0BSD','MPL-2.0','(MIT AND Zlib)','BlueOak-1.0.0'].includes(x.license)&&!auditedSharp(x));
console.log(`${list.length} pacchetti inventariati. Da approfondire: ${JSON.stringify(unknown)}`);
if(unknown.length)process.exitCode=1;
