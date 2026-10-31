import {z} from 'zod';
import {transferPath,TRANSFER_LIMIT} from './mobile-model.mjs';

const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const SyncFile=z.object({path:z.string().refine(transferPath),bytes:z.number().int().min(0).max(100*1024*1024),sha256:hash,blob:z.string().regex(/^[\w-]{1,200}$/).optional()});
export const SyncCommit=z.object({format:z.literal('officina-sync-1'),id:uuid,projectId:uuid,device:uuid,title:z.string().min(1).max(200),createdAt:z.string().datetime(),parents:z.array(uuid).max(16),digest:hash,files:z.array(SyncFile.extend({blob:z.string().regex(/^[\w-]{1,200}$/)})).min(2).max(10000)}).superRefine((v,ctx)=>{
 if(new Set(v.parents).size!==v.parents.length||v.parents.includes(v.id)||new Set(v.files.map(f=>f.path)).size!==v.files.length||!['manifest.json','romanzo.json'].every(n=>v.files.some(f=>f.path===n))||v.files.reduce((a,f)=>a+f.bytes,0)>TRANSFER_LIMIT)ctx.addIssue({code:'custom',message:'Inventario o genitori della versione non validi.'});
});
export const SyncSummary=z.object({format:z.literal('officina-sync-1'),id:uuid,projectId:uuid,device:uuid,title:z.string().min(1).max(200),createdAt:z.string().datetime(),parents:z.array(uuid).max(16),digest:hash});
export function commitProperties(c){let title=c.title;while(new TextEncoder().encode(title).length>100)title=[...title].slice(0,-1).join('');return {kind:'officina-commit-1',version:c.id,project:c.projectId,device:c.device,title,date:c.createdAt,digest:c.digest,parentCount:String(c.parents.length),...Object.fromEntries(c.parents.map((p,i)=>['p'+i,p]))};}
export function summaryProperties(p){if(!/^\d{1,2}$/.test(p?.parentCount)||Number(p.parentCount)>16)throw new Error('Cronologia Drive non valida.');return SyncSummary.parse({format:'officina-sync-1',id:p.version,projectId:p.project,device:p.device,title:p.title,createdAt:p.date,digest:p.digest,parents:Array.from({length:Number(p.parentCount)},(_,i)=>p['p'+i])});}
export function matchesSummary(c,s){for(const key of ['id','projectId','device','createdAt','digest'])if(c[key]!==s[key])throw new Error('Versione Drive diversa dalla cronologia dichiarata.');if(JSON.stringify(c.parents)!==JSON.stringify(s.parents))throw new Error('Cronologia Drive non integra.');return c;}
export async function inventoryDigest(files){
 const checked=files.map(f=>SyncFile.parse(f)).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(new Set(checked.map(f=>f.path)).size!==checked.length)throw new Error('Inventario duplicato.');
 const bytes=new TextEncoder().encode(JSON.stringify(checked.map(f=>[f.path,f.bytes,f.sha256])));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function checkCommit(value){const c=SyncCommit.parse(value);if(await inventoryDigest(c.files)!==c.digest)throw new Error('Inventario Drive non integro.');return c;}
export function syncHeads(commits){
 if(commits.length>2000)throw new Error('Cronologia Drive oltre il limite iniziale di 2000 versioni. Nessuna versione eliminata.');
 const map=new Map();for(const c of commits){if(map.has(c.id)&&JSON.stringify(map.get(c.id))!==JSON.stringify(c))throw new Error('Identità della versione ambigua.');map.set(c.id,c);}
 const done=new Set(),visiting=new Set(),parents=new Set();
 function visit(c){if(done.has(c.id))return;if(visiting.has(c.id))throw new Error('Ciclo nella cronologia Drive.');visiting.add(c.id);for(const p of c.parents){parents.add(p);if(!map.has(p))throw new Error('Cronologia Drive incompleta: nessun allineamento automatico.');visit(map.get(p));}visiting.delete(c.id);done.add(c.id);}
 for(const c of map.values())visit(c);
 return [...map.values()].filter(c=>!parents.has(c.id)).sort((a,b)=>a.id<b.id?-1:1);
}
export function syncPlan({digest,commits,base,account}){
 if(base?.account&&base.account!==account)throw new Error('Questa copia è associata a un altro account Drive.');
 const heads=syncHeads(commits),ids=heads.map(c=>c.id);
 if(!heads.length){if(base?.head)throw new Error('La cronologia Drive precedente non è disponibile. Copia locale conservata.');return {action:'publish',parents:[]};}
 if(heads.length>1)return {action:'conflict',heads,expectedHeads:ids};
 const head=heads[0];
 if(digest===head.digest)return {action:'ack',head};
 if(base?.head===head.id)return {action:'publish',parents:ids};
 if(base?.head&&base.digest===digest){
   const map=new Map(commits.map(c=>[c.id,c])),todo=[head.id],seen=new Set();
   while(todo.length){const id=todo.pop();if(id===base.head)return {action:'receive',head};if(seen.has(id))continue;seen.add(id);todo.push(...(map.get(id)?.parents||[]));}
 }
 return {action:'conflict',heads,expectedHeads:ids};
}
export function checkResolution(heads,expected){if(!Array.isArray(expected)||JSON.stringify(heads.map(c=>c.id).sort())!==JSON.stringify([...expected].sort()))throw new Error('Ci sono nuove modifiche su Drive. Aggiorna prima di scegliere una versione.');}
