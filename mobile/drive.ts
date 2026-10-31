import {native} from './bridge';
import {mobileBook} from '../packages/mobile-model.mjs';
import {checkCommit,inventoryDigest,SyncSummary,syncHeads,syncPlan,checkResolution} from '../packages/sync-model.mjs';

async function commits(raw:any[]){const result:any[]=[];for(const c of raw)result.push(c.files?await checkCommit(c):SyncSummary.parse(c));return result;}
export async function mobileDriveCall(method:string,args:any={},book:any=null){
 if(method==='driveLibrary'||method==='driveHistory'){
  const all=await commits(await native('driveCommits'));
  if(method==='driveHistory')return all.filter(c=>c.projectId===book?.project.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(c=>({id:c.id,date:c.createdAt,device:c.device,title:c.title}));
  const groups=new Map<string,any[]>();for(const c of all)groups.set(c.projectId,[...(groups.get(c.projectId)||[]),c]);return [...groups].map(([id,cs])=>{const heads=syncHeads(cs);return {id,title:heads[0].title,heads:heads.map((c:any)=>({id:c.id,date:c.createdAt,device:c.device})),conflict:heads.length>1};});
 }
 return native(method,{...args,...(book?{id:book.id}:{})});
}
async function receive(c:any){const checked=await checkCommit(c),preview=await native('driveReceive',{commit:checked});try{mobileBook(preview);}catch(e){await native('discard',{id:preview.id});throw e;}return preview;}
export async function openMobileDrive(remote:string){const c=await checkCommit(await native('driveVersion',{version:remote})),p=await receive(c),book=mobileBook(await native('accept',{id:p.id}));const prepared=await native('drivePrepare',{id:book.id});await native('driveBind',{id:book.id,account:prepared.account,head:c.id,digest:c.digest,automatic:false});return {action:'received',book};}
export async function syncMobileDrive(source:any,options:any={}){
 let book=source;const prepared=await native('drivePrepare',{id:book.id}),snapshot=prepared.snapshot,account=prepared.account;
 if(snapshot.projectId!==book.project.id||await inventoryDigest(snapshot.files)!==snapshot.digest)throw new Error('Inventario locale non valido.');
 const all=await commits(prepared.commits),history=all.filter(c=>c.projectId===snapshot.projectId),heads=syncHeads(history);let base=prepared.base;
 if(!base){if(!options.enable)throw new Error('Attiva prima la sincronizzazione di questa copia.');const p=await native('driveClone',{id:book.id,expectedDigest:snapshot.digest});mobileBook(p);book=mobileBook(await native('accept',{id:p.id}));base={head:null,digest:snapshot.digest,account,automatic:false};await native('driveBind',{id:book.id,...base});}
 let plan:any=syncPlan({digest:snapshot.digest,commits:history,base,account}),head:any,digest=snapshot.digest;
 if(options.resolution){checkResolution(heads,options.resolution.expectedHeads);if(options.resolution.expectedDigest!==snapshot.digest)throw new Error('Copia locale cambiata: aggiorna prima il confronto.');const parents=heads.map((c:any)=>c.id);
  if(options.resolution.use!=='local'){const selected=heads.find((c:any)=>c.id===options.resolution.use);if(!selected)throw new Error('Scegli una versione corrente.');if(!history.some((c:any)=>c.digest===snapshot.digest)){const branch=await checkCommit(await native('drivePublish',{id:book.id,parents:history.some((c:any)=>c.id===base.head)?[base.head]:[],expectedDigest:snapshot.digest}));parents.push(branch.id);}const p=await receive(selected);book=mobileBook(await native('accept',{id:p.id}));digest=selected.digest;}
  plan={action:'publish',parents};
 }
 if(plan.action==='conflict')return {action:'conflict',book,heads:heads.map((c:any)=>({id:c.id,date:c.createdAt,device:c.device})),expectedHeads:heads.map((c:any)=>c.id),expectedDigest:snapshot.digest};
 if(plan.action==='receive'){
  if(options.publishOnly)return {action:'updateAvailable'};
  const p=await receive(plan.head),current=await native('driveSnapshot',{id:book.id});if(current.digest!==snapshot.digest)throw new Error('La copia locale è cambiata durante il download. Nessuna sostituzione effettuata.');book=mobileBook(await native('accept',{id:p.id}));head=plan.head;
 }else if(plan.action==='publish')head=await checkCommit(await native('drivePublish',{id:book.id,parents:plan.parents,expectedDigest:digest}));else head=plan.head;
 await native('driveBind',{id:book.id,head:head.id,digest:head.digest,account,automatic:!!base.automatic});
 const latest=syncHeads((await commits(await native('driveCommits'))).filter(c=>c.projectId===head.projectId));return {action:latest.length>1?'conflict':'synced',book,heads:latest.map((c:any)=>({id:c.id,date:c.createdAt,device:c.device})),expectedHeads:latest.map((c:any)=>c.id),expectedDigest:head.digest};
}
