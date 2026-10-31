import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const MODELS=['upscayl-standard-4x','digital-art-4x','upscayl-lite-4x','high-fidelity-4x','remacri-4x','ultramix-balanced-4x','ultrasharp-4x'];
const MAX_PIXELS=120_000_000;
export function enginePaths(){const root=path.join(process.env.ProgramFiles||'C:/Program Files','Upscayl','resources');return {executable:path.join(root,'bin','upscayl-bin.exe'),models:path.join(root,'models')};}
export async function engineStatus(){const paths=enginePaths();const models=[];for(const name of MODELS){try{await fs.access(path.join(paths.models,name+'.param'));await fs.access(path.join(paths.models,name+'.bin'));models.push(name);}catch{}}let installed=false;try{await fs.access(paths.executable);installed=true;}catch{}return {...paths,installed:installed&&models.length>0,models};}
async function readSource(file){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>100_000_000)throw new Error('Scegli un file immagine fino a 100 MB.');const bytes=await fs.readFile(file);const m=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();if(!['png','jpeg','webp'].includes(m.format)||m.pages>1)throw new Error('Sono supportate immagini singole PNG, JPEG o WebP.');return {bytes,m};}
export async function inspectImage(file){const {bytes,m}=await readSource(file);const preview=await sharp(bytes).autoOrient().resize({width:800,height:600,fit:'inside',withoutEnlargement:true}).png().toBuffer();return {name:path.basename(file),width:m.width,height:m.height,sha256:hash(bytes),format:m.format,hasAlpha:m.hasAlpha,hasProfile:!!m.icc,orientation:m.orientation||1,aiIssue:aiIssue(m),preview:'data:image/png;base64,'+preview.toString('base64')};}
function aiIssue(m){return m.icc||m.exif||m.orientation>1||m.hasAlpha||m.space!=='srgb'||m.depth!=='uchar'?'Per AI usa una copia RGB a 8 bit, senza trasparenza, profilo ICC o EXIF. Nessuna conversione viene applicata automaticamente.':null;}
export function validateOptions(o,width,height){if(!o||!['resize','ai'].includes(o.mode)||![2,3,4].includes(o.scale))throw new Error('Scegli metodo e scala 2×, 3× o 4×.');if(![0,90,180,270].includes(o.rotate)||typeof o.mirror!=='boolean'||!Number.isFinite(o.brightness)||o.brightness<0.5||o.brightness>1.5)throw new Error('Regolazioni non valide.');if(o.mode==='ai'&&(!MODELS.includes(o.model)||o.rotate!==0||o.mirror||o.brightness!==1))throw new Error('Per AI scegli un modello e azzera le regolazioni.');const rotated=o.rotate===90||o.rotate===270;const w=(rotated?height:width)*o.scale,h=(rotated?width:height)*o.scale;if(w*h>MAX_PIXELS)throw new Error('Il risultato supera 120 megapixel: scegli una scala inferiore.');return {width:w,height:h};}
function abort(signal){if(signal?.aborted)throw new Error('Elaborazione annullata.');}
async function executeEngine(args,{signal,onLog}){abort(signal);await new Promise((resolve,reject)=>{const child=spawn(enginePaths().executable,args,{shell:false,windowsHide:true});const stop=()=>child.kill();const timeout=setTimeout(()=>child.kill(),15*60*1000);signal?.addEventListener('abort',stop,{once:true});child.stdout.on('data',onLog);child.stderr.on('data',onLog);child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);signal?.removeEventListener('abort',stop);if(signal?.aborted)reject(new Error('Elaborazione annullata.'));else if(code!==0)reject(new Error('Upscayl non ha completato il lavoro. Consulta il log della lavorazione.'));else resolve();});});}
export async function processImage(file,destination,sourceHash,options,{signal,onProgress=()=>{}}={}){
  abort(signal);const {bytes,m}=await readSource(file);if(hash(bytes)!==sourceHash)throw new Error('Il sorgente è cambiato: selezionalo nuovamente.');const expected=validateOptions(options,m.width,m.height);
  if(m.orientation>1)throw new Error('Orientamento EXIF presente: prepara prima una copia con orientamento applicato.');
  if(m.depth!=='uchar'||m.space!=='srgb')throw new Error('Per questa versione prepara una copia RGB a 8 bit. Profondità e spazio colore non vengono convertiti automaticamente.');
  if(options.mode==='ai'&&aiIssue(m))throw new Error(aiIssue(m));
  const parent=await fs.realpath(destination),sourceParent=await fs.realpath(path.dirname(file));const rel=path.relative(sourceParent,parent);
  if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw new Error('Scegli una cartella di output esterna alla cartella del sorgente.');
  if(options.mode==='ai'&&!(await engineStatus()).installed)throw new Error('Upscayl Desktop o modelli non disponibili. Installa Upscayl nella cartella standard di Windows.');
  const folder=path.join(parent,'officina-immagine-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await fs.mkdir(folder);
  let log='',temp=null;const report={version:1,status:'in corso',source:{path:file,sha256:sourceHash,width:m.width,height:m.height,hasProfile:!!m.icc,hasAlpha:m.hasAlpha},options,expected,createdAt:new Date().toISOString()};
  try{
    onProgress({phase:options.mode==='ai'?'Upscayl AI in esecuzione':'Ridimensionamento in esecuzione'});
    const output=path.join(folder,'risultato.png');
    if(options.mode==='ai'){
      temp=await fs.mkdtemp(path.join(os.tmpdir(),'officina-ai-'));const input=path.join(temp,'input.'+(m.format==='jpeg'?'jpg':m.format)),working=path.join(temp,'output.png');await fs.writeFile(input,bytes,{flag:'wx'});const paths=enginePaths();
      await executeEngine(['-i',input,'-o',working,'-m',paths.models,'-n',options.model,'-z','4','-s',String(options.scale),'-t','128','-f','png'],{signal,onLog:data=>{log=(log+data.toString()).slice(-128000);}});
      abort(signal);await fs.copyFile(working,output,fs.constants.COPYFILE_EXCL);report.engine={...paths,model:options.model,modelScale:4,outputScale:options.scale};
    }else{
      let pipeline=sharp(bytes,{limitInputPixels:40_000_000});
      if(m.icc||m.exif||m.iptc||m.xmp)pipeline=pipeline.keepMetadata();
      if(options.rotate)pipeline=pipeline.rotate(options.rotate);
      if(options.mirror)pipeline=pipeline.flop();if(options.brightness!==1)pipeline=pipeline.modulate({brightness:options.brightness});
      const result=await pipeline.resize(expected.width,expected.height,{fit:'fill',kernel:sharp.kernel.lanczos3}).png().toBuffer();abort(signal);await fs.writeFile(output,result,{flag:'wx'});
    }
    abort(signal);onProgress({phase:'Verifica dimensioni e integrità'});const result=await fs.readFile(output),actual=await sharp(result).metadata();
    if(actual.width!==expected.width||actual.height!==expected.height)throw new Error(`Dimensioni inattese: ${actual.width} × ${actual.height}.`);
    if(options.mode==='resize'&&m.hasAlpha&&!actual.hasAlpha)throw new Error('La trasparenza non è stata conservata.');
    if(options.mode==='resize'&&m.icc&&!actual.icc)throw new Error('Il profilo colore non è stato conservato.');
    if(hash(await fs.readFile(file))!==sourceHash)throw new Error('Il sorgente è stato modificato da un altro programma durante il lavoro.');
    const preview=await sharp(result).resize({width:800,height:600,fit:'inside',withoutEnlargement:true}).png().toBuffer();
    Object.assign(report,{status:'verificato',output:{path:output,sha256:hash(result),width:actual.width,height:actual.height,hasAlpha:actual.hasAlpha,hasProfile:!!actual.icc},originalUnchanged:true});
    await fs.writeFile(path.join(folder,'verifica.json'),JSON.stringify(report,null,2),{flag:'wx'});await fs.writeFile(path.join(folder,'motore.log'),log||'Ridimensionamento Lanczos3 con sharp; nessun modello AI.\n',{flag:'wx'});
    return {...report,folder,preview:'data:image/png;base64,'+preview.toString('base64')};
  }catch(e){Object.assign(report,{status:signal?.aborted?'annullato':'errore',error:e.message});await fs.writeFile(path.join(folder,'verifica.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(folder,'motore.log'),log);throw new Error(e.message+' Cartella lavorazione: '+folder);}
  finally{if(temp){const resolved=path.resolve(temp),relative=path.relative(path.resolve(os.tmpdir()),resolved);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(resolved).startsWith('officina-ai-'))throw new Error('Percorso temporaneo inatteso: pulizia bloccata.');await fs.rm(resolved,{recursive:true,force:true});}}
}
