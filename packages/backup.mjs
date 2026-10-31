import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {z} from 'zod';
import {ProjectStore} from './storage.mjs';

const incomplete='backup-incomplete.json',reportName='backup-integrity.json';
const BackupSchema=z.object({format:z.literal('officina-backup-1'),complete:z.literal(true),createdAt:z.string().datetime(),projectId:z.string().uuid(),revision:z.number().int().nonnegative(),files:z.array(z.object({path:z.string().min(1),bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1)}).strict();
const normalized=p=>process.platform==='win32'?p.toLowerCase():p;
function inside(root,target) {const relative=path.relative(normalized(root),normalized(target));return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function cancelled(signal) {if(signal?.aborted)throw new Error('Copia annullata dall’utente.');}
async function inventory(root,relative='') {
  const result=[];
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error('Collegamento simbolico non supportato nel backup: '+entry.name);
    if(!relative && [incomplete,reportName,'.officina-write.lock'].includes(entry.name))continue;
    if(entry.name.endsWith('.tmp'))continue;
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())result.push(...await inventory(root,name));
    else if(entry.isFile())result.push(name);
    else throw new Error('Elemento speciale non supportato: '+name);
  }
  return result.sort();
}
async function digest(file,signal) {
  cancelled(signal);const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(file,{signal})) {hash.update(chunk);bytes+=chunk.length;}
  return {sha256:hash.digest('hex'),bytes};
}
function safeFile(root,name) {
  if(name.includes('\\') || name.split('/').some(part=>!part||part==='.'||part==='..') || name.includes(':') || path.isAbsolute(name))throw new Error('Percorso non sicuro nel rapporto di backup.');
  const target=path.resolve(root,...name.split('/'));if(!inside(root,target))throw new Error('Percorso fuori dal backup.');return target;
}
export async function verifyBackup(root,{signal,onProgress=()=>{}}={}) {
  try{await fs.access(path.join(root,incomplete));throw new Error('Backup incompleto: scegli un’altra copia.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const realRoot=await fs.realpath(root);
  const report=BackupSchema.parse(JSON.parse(await fs.readFile(path.join(realRoot,reportName),'utf8')));
  const paths=report.files.map(f=>f.path), actual=await inventory(realRoot);
  if(new Set(paths).size!==paths.length || JSON.stringify([...paths].sort())!==JSON.stringify(actual))throw new Error('Elenco file del backup diverso dal rapporto: copia incompleta o modificata.');
  let done=0;
  for(const record of report.files) {
    const file=safeFile(realRoot,record.path),actualHash=await digest(file,signal);
    if(actualHash.sha256!==record.sha256 || actualHash.bytes!==record.bytes)throw new Error('File del backup mancante o modificato: '+record.path);
    onProgress({phase:'verifica',done:++done,total:report.files.length});
  }
  const project=await new ProjectStore(realRoot).read();
  if(project.id!==report.projectId||project.revision!==report.revision)throw new Error('Il manifest non corrisponde alla revisione del backup.');
  return {root:realRoot,report,project};
}
async function copyProject(source,parent,{signal,onProgress=()=>{},restore=false,expectedReport}={}) {
  cancelled(signal);const sourceRoot=await fs.realpath(source.root),destinationParent=await fs.realpath(parent);
  const target=path.join(destinationParent,`${restore?'ripristino':'backup'}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.officinalibri`);
  if(inside(sourceRoot,target))throw new Error('Scegli una destinazione esterna alla cartella progetto: il backup non può contenere sé stesso.');
  const project=await source.read(),files=await inventory(sourceRoot);
  if(expectedReport && JSON.stringify(files)!==JSON.stringify(expectedReport.files.map(r=>r.path).sort()))throw new Error('Il backup è cambiato dopo la verifica. Ripeti la verifica.');
  await fs.mkdir(target);const marker=path.join(target,incomplete);
  await fs.writeFile(marker,JSON.stringify({complete:false,startedAt:new Date().toISOString(),projectId:project.id}));
  try {
    for(const directory of ['assets','snapshots','outputs'])await fs.mkdir(path.join(target,directory),{recursive:true});
    const records=[];let done=0;
    for(const name of files) {
      cancelled(signal);const from=safeFile(sourceRoot,name),to=safeFile(target,name);await fs.mkdir(path.dirname(to),{recursive:true});
      const hash=createHash('sha256');let bytes=0;
      const observer=new Transform({transform(chunk,encoding,cb){hash.update(chunk);bytes+=chunk.length;cb(null,chunk);}});
      await pipeline(createReadStream(from),observer,createWriteStream(to,{flags:'wx'}),{signal});
      const sourceHash={sha256:hash.digest('hex'),bytes},copied=await digest(to,signal),sourceAgain=await digest(from,signal);
      if(sourceHash.sha256!==copied.sha256||sourceAgain.sha256!==copied.sha256||sourceHash.bytes!==copied.bytes)throw new Error('Verifica della copia non riuscita: '+name);
      if(expectedReport){const expected=expectedReport.files.find(r=>r.path===name);if(expected.sha256!==copied.sha256||expected.bytes!==copied.bytes)throw new Error('Il backup sorgente è cambiato dopo la verifica: '+name);}
      records.push({path:name,...copied});onProgress({phase:'copia',done:++done,total:files.length});
    }
    cancelled(signal);
    const report={format:'officina-backup-1',complete:true,createdAt:new Date().toISOString(),projectId:project.id,revision:project.revision,files:records};
    // Il marker viene tolto soltanto dopo aver scritto il rapporto completo.
    await fs.writeFile(path.join(target,reportName),JSON.stringify(report,null,2),{flag:'wx'});
    await fs.unlink(marker);
    try{await verifyBackup(target,{signal,onProgress});}catch(e){await fs.writeFile(marker,JSON.stringify({complete:false,error:e.message}));throw e;}
    if(restore) {
      // La copia ripristinata diventa un progetto di lavoro; la copia di sicurezza rimane intatta.
      await fs.rename(path.join(target,reportName),path.join(target,'restored-from-'+randomUUID()+'.json'));
    }
    return {path:target,files:records.length,bytes:records.reduce((sum,r)=>sum+r.bytes,0),revision:project.revision,title:project.title};
  } catch(e) {await fs.writeFile(marker,JSON.stringify({complete:false,error:e.message})).catch(()=>{});throw new Error(`${signal?.aborted?'Backup annullato':e.message} Copia incompleta conservata in ${target}. Il progetto originale è intatto.`);}
}
export function createBackup(store,parent,options) {return store.exclusive(()=>copyProject(store,parent,options));}
export async function restoreBackup(backupRoot,parent,options) {
  const verified=await verifyBackup(backupRoot,options);
  return copyProject(new ProjectStore(backupRoot),parent,{...options,restore:true,expectedReport:verified.report});
}
