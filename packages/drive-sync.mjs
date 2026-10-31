import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {ProjectStore,sha256} from './storage.mjs';
import {mobileBook,transferPath} from './mobile-model.mjs';
import {readFont} from './fonts.mjs';
import {checkCommit,inventoryDigest,syncHeads,syncPlan,checkResolution,SyncSummary,commitProperties} from './sync-model.mjs';

export async function fileDigest(file){const h=createHash('sha256');let bytes=0;for await(const b of createReadStream(file)){h.update(b);bytes+=b.length;}return {bytes,sha256:h.digest('hex')};}
async function walk(root,prefix=''){const names=[];for(const e of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){if(e.isSymbolicLink())throw new Error('Link esclusi dalla sincronizzazione.');const n=prefix?prefix+'/'+e.name:e.name;if(e.isDirectory()){if(['assets','novel-fonts','imports','snapshots'].includes(n))names.push(...await walk(root,n));}else if(transferPath(n))names.push(n);}return names;}
export class DriveSync {
 constructor(root,api){this.root=path.resolve(root);this.api=api;this.running=false;this.progress='';}
 file(name){return path.join(this.root,name);}
 async settings(){try{const s=JSON.parse(await fs.readFile(this.file('drive-state.json'),'utf8'));if(!s.device||!s.books||typeof s.books!=='object')throw new Error();return s;}catch(e){if(e.code!=='ENOENT')throw new Error('Impostazioni di sincronizzazione non leggibili: nessuna copia sostituita.');return {device:randomUUID(),books:{}};}}
 async saveSettings(s){const file=this.file('drive-state.json'),tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(s,null,2),{flag:'wx'});await fs.rename(tmp,file);}
 async exclusive(fn){
  if(this.running)throw new Error('Sincronizzazione già in corso.');this.running=true;
  let lock;try{await fs.mkdir(this.root,{recursive:true});lock=await fs.open(this.file('drive-write.lock'),'wx');return await fn();}
  catch(e){if(e.code==='EEXIST')throw new Error('Un’altra istanza sta sincronizzando, oppure è rimasto un lock dopo un arresto. Le copie sono conservate.');throw e;}
  finally{if(lock){await lock.close();await fs.unlink(this.file('drive-write.lock'));}this.running=false;this.progress='';}
 }
 async cache(record,source){
  const folder=this.file('drive-blobs');await fs.mkdir(folder,{recursive:true});const target=path.join(folder,record.sha256+'.blob');
  try{const d=await fileDigest(target);if(d.sha256!==record.sha256||d.bytes!==record.bytes)throw new Error('Cache locale non integra: sincronizzazione fermata.');return target;}catch(e){if(e.code!=='ENOENT')throw e;}
  const temp=target+'.'+randomUUID()+'.tmp';
  if(source){if(Buffer.isBuffer(source))await fs.writeFile(temp,source,{flag:'wx'});else await fs.copyFile(source,temp,fs.constants.COPYFILE_EXCL);}
  else await this.api.download(record.blob,temp,record);
  const d=await fileDigest(temp);if(d.sha256!==record.sha256||d.bytes!==record.bytes)throw new Error(source?'Il file è cambiato durante la copia: sincronizzazione non completata.':'File Drive non integro. Nessuna copia sostituita.');
  await fs.rename(temp,target);return target;
 }
 async snapshot(store,fontFile){return store.exclusive(async()=>{
  const project=await store.read();let raw;try{raw=await fs.readFile(store.file('romanzo.json'));}catch(e){if(e.code==='ENOENT')throw new Error('Apri e salva prima i capitoli del romanzo.');throw e;}
  const state=mobileBook({project,novel:JSON.parse(raw)}),files=[],names=await walk(store.root),extras=new Map();
  if(project.font&&fontFile){const f=await readFont(fontFile,project.font);extras.set('novel-fonts/'+f.ref.sha256+path.extname(fontFile).toLowerCase(),f.bytes);}
  for(const name of [...new Set([...names,...extras.keys()])].sort()){
   const b=extras.get(name),d=b?{bytes:b.length,sha256:sha256(b)}:await fileDigest(store.file(name));
   if(d.bytes>100*1024*1024||((name==='manifest.json'||name==='romanzo.json')&&d.bytes>32*1024*1024))throw new Error('File oltre il limite di sincronizzazione.');
   const r={path:name,...d};files.push(r);await this.cache(r,b||store.file(name));
  }
  if(files.length>10000||files.reduce((n,f)=>n+f.bytes,0)>1024**3)throw new Error('Copia oltre 1 GiB o 10.000 file: sincronizzazione fermata.');
  return {projectId:state.project.id,title:state.project.title,files,digest:await inventoryDigest(files)};
 });}
 async materialize(commit){
  const c=await checkCommit(commit),parent=this.file('drive-projects');await fs.mkdir(parent,{recursive:true});
  const root=path.join(parent,randomUUID()+'.officinalibri');await fs.mkdir(root);await fs.writeFile(path.join(root,'backup-incomplete.json'),'Download Drive non ancora verificato');
  for(const r of c.files){this.progress='Ricezione '+r.path;const source=await this.cache(r);const dest=path.join(root,...r.path.split('/'));await fs.mkdir(path.dirname(dest),{recursive:true});
   // Mutable JSON is always independent. Immutable resources share our private cache.
   if(['manifest.json','romanzo.json','percorso.json'].includes(r.path))await fs.copyFile(source,dest,fs.constants.COPYFILE_EXCL);
   else try{await fs.link(source,dest);}catch(e){if(!['EXDEV','EPERM','ENOTSUP','EACCES'].includes(e.code))throw e;await fs.copyFile(source,dest,fs.constants.COPYFILE_EXCL);}
  }
  for(const name of ['outputs','assets','snapshots'])await fs.mkdir(path.join(root,name),{recursive:true});
  const project=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')),novel=JSON.parse(await fs.readFile(path.join(root,'romanzo.json'),'utf8'));mobileBook({project,novel});if(project.id!==c.projectId)throw new Error('Il progetto Drive non corrisponde alla versione.');
  if(project.font&&!c.files.some(f=>f.path.startsWith('novel-fonts/'+project.font.sha256+'.')&&f.sha256===project.font.sha256))throw new Error('Font generale mancante nella copia Drive.');
  // Validate before removing the incomplete marker; no user folder is overwritten.
  for(const r of c.files){const d=await fileDigest(path.join(root,...r.path.split('/')));if(d.sha256!==r.sha256||d.bytes!==r.bytes)throw new Error('Copia Drive incompleta.');}
  await fs.unlink(path.join(root,'backup-incomplete.json'));const store=new ProjectStore(root);try{await store.read();}catch(e){await fs.writeFile(path.join(root,'backup-incomplete.json'),'Copia Drive non valida');throw e;}return store;
 }
 async commits(){const result=[];for(const raw of await this.api.commits())result.push(raw.files?await checkCommit(raw):SyncSummary.parse(raw));return result;}
 async library(){const commits=await this.commits(),groups=new Map();for(const c of commits){const g=groups.get(c.projectId)||[];g.push(c);groups.set(c.projectId,g);}return [...groups].map(([id,cs])=>{const heads=syncHeads(cs);return {id,title:heads[0].title,heads:heads.map(c=>({id:c.id,date:c.createdAt,device:c.device})),conflict:heads.length>1};});}
 async history(projectId){return (await this.commits()).filter(c=>c.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(c=>({id:c.id,date:c.createdAt,title:c.title,device:c.device}));}
 async status(store){const s=await this.settings(),auth=await this.api.auth.status(),binding=store?s.books[store.root]:null;return {...auth,bound:!!binding,automatic:!!binding?.automatic,running:this.running,progress:this.progress,lastSync:binding?.lastSync||null};}
 async automatic(store,enabled){return this.exclusive(async()=>{const s=await this.settings(),b=s.books[store.root];if(!b)throw new Error('Attiva prima la sincronizzazione di questa copia.');b.automatic=!!enabled;await this.saveSettings(s);return this.status(store);});}
 async publish(snapshot,parents,settings){this.api.beginUpload?.();const files=[];for(const f of snapshot.files){this.progress='Invio '+f.path;const blob=f.blob||await this.api.blob(await this.cache(f),f);files.push({...f,blob});}
  const c=await checkCommit({format:'officina-sync-1',id:randomUUID(),projectId:snapshot.projectId,device:settings.device,title:snapshot.title,createdAt:new Date().toISOString(),parents,digest:snapshot.digest,files});
  const bytes=Buffer.from(JSON.stringify(c)),r={bytes:bytes.length,sha256:sha256(bytes)},file=await this.cache(r,bytes);await this.api.upload(file,r,commitProperties(c));return c;
 }
 async run(source,fontFile,options={}){return this.exclusive(async()=>{
  const settings=await this.settings(),account=await this.api.account();settings.account=account;
  let store=source,base=store?settings.books[store.root]:null,snapshot;
  if(!source&& !options.remote)throw new Error('Apri prima un romanzo.');
  const all=await this.commits();
  if(options.remote){let chosen=all.find(c=>c.id===options.remote);if(!chosen)throw new Error('Versione Drive non più disponibile.');if(!chosen.files)chosen=await this.api.version(chosen.id);store=await this.materialize(chosen);settings.books[store.root]={account:account.id,head:chosen.id,digest:chosen.digest,automatic:false,lastSync:new Date().toISOString()};await this.saveSettings(settings);return {action:'received',store};}
  snapshot=await this.snapshot(store,fontFile);
  if(!base){if(!options.enable)throw new Error('Attiva prima la sincronizzazione per questo romanzo.');
   // The first activation always starts from a separate managed copy of PC originals.
   const local={format:'officina-sync-1',id:randomUUID(),device:settings.device,createdAt:new Date().toISOString(),parents:[],...snapshot,files:snapshot.files.map(f=>({...f,blob:f.sha256}))};
   store=await this.materialize(local);base={account:account.id,head:null,digest:snapshot.digest,automatic:false};settings.books[store.root]=base;
  }
  const commits=all.filter(c=>c.projectId===snapshot.projectId),heads=syncHeads(commits);let plan=syncPlan({digest:snapshot.digest,commits,base,account:account.id});
  if(options.resolution){checkResolution(heads,options.resolution.expectedHeads);if(options.resolution.expectedDigest!==snapshot.digest)throw new Error('La copia locale è cambiata: aggiorna il confronto.');const parents=heads.map(c=>c.id);
   if(options.resolution.use!=='local'){const c=heads.find(h=>h.id===options.resolution.use);if(!c)throw new Error('Scegli una versione corrente.');if(!commits.some(v=>v.digest===snapshot.digest)){const branch=await this.publish(snapshot,commits.some(v=>v.id===base.head)?[base.head]:[],settings);parents.push(branch.id);}store=await this.materialize(c);snapshot={projectId:c.projectId,title:c.title,files:c.files,digest:c.digest};}
   plan={action:'publish',parents};
  }
  if(plan.action==='conflict'){await this.saveSettings(settings);return {action:'conflict',heads:plan.heads.map(c=>({id:c.id,date:c.createdAt,device:c.device,title:c.title})),expectedHeads:plan.expectedHeads,expectedDigest:snapshot.digest,store};}
  let head;
  if(plan.action==='receive'){if(options.publishOnly)return {action:'updateAvailable',store};const incoming=await this.materialize(plan.head);if((await this.snapshot(store,fontFile)).digest!==snapshot.digest)throw new Error('La copia locale è cambiata durante il download. Nessuna sostituzione effettuata.');store=incoming;head=plan.head;}
  else if(plan.action==='publish')head=await this.publish(snapshot,plan.parents,settings);
  else head=plan.head;
  const old=base;settings.books[store.root]={account:account.id,head:head.id,digest:head.digest,automatic:!!old.automatic,lastSync:new Date().toISOString()};
  await this.saveSettings(settings);
  // A second concurrent writer may have committed since our scan. Never hide that fork.
  const current=syncHeads((await this.commits()).filter(c=>c.projectId===head.projectId));
  return {action:current.length>1?'conflict':'synced',heads:current.map(c=>({id:c.id,date:c.createdAt,device:c.device,title:c.title})),expectedHeads:current.map(c=>c.id),expectedDigest:head.digest,store};
 });}
}
