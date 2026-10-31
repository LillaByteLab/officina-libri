import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {summaryProperties,syncHeads,checkCommit,matchesSummary} from './sync-model.mjs';

const API='https://www.googleapis.com/drive/v3/';
const fileId=v=>{if(!/^[\w-]{1,200}$/.test(v))throw new Error('Identificativo Drive non valido.');return v;};
export class DriveApi {
 constructor(auth,fetcher=fetch){this.auth=auth;this.fetcher=fetcher;this.blobIndex=null;}
 async request(url,options={}){
  const u=new URL(url);if(u.origin!=='https://www.googleapis.com'||!/^\/(?:upload\/)?drive\/v3\//.test(u.pathname))throw new Error('Indirizzo Drive non consentito.');
  let r;try{r=await this.fetcher(u,{...options,redirect:'error',headers:{...options.headers,Authorization:'Bearer '+await this.auth.token()},signal:AbortSignal.timeout(60000)});}catch(e){if(/Google|Collega/.test(e.message))throw e;throw new Error('Drive non raggiungibile. I dati locali sono conservati; riprova quando torna la connessione.');}
  if(r.status===401)throw new Error('Accesso Google scaduto: ricollega l’account.');
  if(!r.ok&&r.status!==308)throw new Error('Drive non ha completato l’operazione (HTTP '+r.status+'). Nessuna copia locale sostituita.');return r;
 }
 async json(url,options){const r=await this.request(url,options);const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>8*1024*1024)throw new Error('Risposta Drive oltre 8 MiB.');return JSON.parse(bytes.toString('utf8'));}
 async account(){const value=await this.json(API+'about?fields=user(permissionId,displayName,emailAddress)');if(!value.user?.permissionId)throw new Error('Account Drive non riconosciuto.');return {id:value.user.permissionId,label:value.user.emailAddress||value.user.displayName||'Google Drive'};}
 async list(query){let token='',files=[];do{const p=new URLSearchParams({spaces:'appDataFolder',q:'trashed = false and ('+query+')',fields:'nextPageToken,files(id,name,size,sha256Checksum,appProperties)',pageSize:'100',...(token?{pageToken:token}:{})});const r=await this.json(API+'files?'+p);files.push(...(r.files||[]));if(files.length>10000)throw new Error('Archivio Drive oltre il limite iniziale di 10.000 file per ricerca.');token=r.nextPageToken||'';}while(token);return files;}
 async read(id,max=8*1024*1024){const r=await this.request(API+'files/'+fileId(id)+'?alt=media'),parts=[];let size=0;for await(const part of r.body){size+=part.length;if(size>max)throw new Error('Documento Drive troppo grande.');parts.push(part);}return Buffer.concat(parts);}
 async upload(file,record,properties){
  const init=await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,sha256Checksum',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(record.bytes)},body:JSON.stringify({name:properties.kind+'-'+record.sha256,mimeType:'application/octet-stream',parents:['appDataFolder'],appProperties:properties})});
  const location=init.headers.get('location');if(!location)throw new Error('Drive non ha aperto il caricamento.');
  const handle=await fs.open(file,'r');let offset=0,final;
  try{
   do{const count=Math.min(8*1024*1024,record.bytes-offset),buffer=Buffer.alloc(count);let got=0;while(got<count){const r=await handle.read(buffer,got,count-got,offset+got);if(!r.bytesRead)throw new Error('File locale cambiato durante il caricamento.');got+=r.bytesRead;}
    const r=await this.request(location,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(count),'Content-Range':record.bytes?`bytes ${offset}-${offset+count-1}/${record.bytes}`:'bytes */0'},body:buffer});
    if(r.status===308){const range=r.headers.get('range'),match=/^bytes=0-(\d+)$/.exec(range||'');if(!match||Number(match[1])+1!==offset+count)throw new Error('Caricamento Drive parziale: riprova la sincronizzazione.');}
    else{final=await r.json();if(offset+count!==record.bytes)throw new Error('Caricamento Drive terminato prima del previsto.');}
    offset+=count;
   }while(offset<record.bytes);
  }finally{await handle.close();}
  if(!final?.id||Number(final.size)!==record.bytes)throw new Error('Dimensione ricevuta da Drive non corretta.');
  if(final.sha256Checksum!==record.sha256){const actual=createHash('sha256').update(await this.read(final.id,record.bytes)).digest('hex');if(actual!==record.sha256)throw new Error('File ricevuto da Drive non integro.');}
  return fileId(final.id);
 }
 beginUpload(){this.blobIndex=null;}
 async blob(file,record){if(!this.blobIndex){this.blobIndex=new Map();for(const f of await this.list("appProperties has { key='kind' and value='officina-blob-1' }"))if(f.sha256Checksum&&f.sha256Checksum===f.appProperties?.sha256)this.blobIndex.set(f.sha256Checksum+':'+f.size,fileId(f.id));}const key=record.sha256+':'+record.bytes;if(this.blobIndex.has(key))return this.blobIndex.get(key);const id=await this.upload(file,record,{kind:'officina-blob-1',sha256:record.sha256});this.blobIndex.set(key,id);return id;}
 async download(id,target,record){
  const r=await this.request(API+'files/'+fileId(id)+'?alt=media');let size=0;const hash=createHash('sha256');
  const check=new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>record.bytes){cb(new Error('File Drive oltre la dimensione dichiarata.'));return;}hash.update(chunk);cb(null,chunk);}});
  await pipeline(Readable.fromWeb(r.body),check,createWriteStream(target,{flags:'wx'}));if(size!==record.bytes||hash.digest('hex')!==record.sha256)throw new Error('File Drive non integro. Copia precedente conservata.');
 }
 async version(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Versione non riconosciuta.');const found=await this.list(`appProperties has { key='kind' and value='officina-commit-1' } and appProperties has { key='version' and value='${id}' }`);if(found.length!==1)throw new Error('Versione Drive assente o ambigua.');return matchesSummary(await checkCommit(JSON.parse((await this.read(found[0].id)).toString('utf8'))),summaryProperties(found[0].appProperties));}
 async commits(){const found=await this.list("appProperties has { key='kind' and value='officina-commit-1' }");if(found.length>2000)throw new Error('Cronologia oltre il limite iniziale di 2000 versioni.');const summaries=found.map(f=>summaryProperties(f.appProperties)),heads=new Set(syncHeads(summaries).map(c=>c.id)),result=[];for(let i=0;i<found.length;i++){const s=summaries[i];result.push(heads.has(s.id)?matchesSummary(await checkCommit(JSON.parse((await this.read(found[i].id)).toString('utf8'))),s):s);}return result;}
}
