import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sha256} from './storage.mjs';

export async function detectPreviewer(roots,aliases){
  aliases??=roots?[]:[path.join(process.env.LOCALAPPDATA||'','Microsoft','WindowsApps','kindlepreviewer4.exe')];
  roots??=[path.join(process.env.LOCALAPPDATA||'','Amazon'),path.join(process.env.LOCALAPPDATA||'','Programs'),path.join(process.env.ProgramFiles||'C:/Program Files','Amazon'),process.env.ProgramFiles||'C:/Program Files'];
  for(const alias of aliases){try{const info=await fs.lstat(alias);await fs.access(alias);if(info.isFile()||info.isSymbolicLink())return alias;}catch{}}
  for(const root of roots){let dirs=[];try{dirs=await fs.readdir(root,{withFileTypes:true});}catch{continue;}
    for(const dir of dirs.filter(d=>d.isDirectory()&&/^kindle ?previewer(?: ?[34])?$/i.test(d.name)).sort((a,b)=>b.name.localeCompare(a.name))){const folder=path.join(root,dir.name);let files=[];try{files=await fs.readdir(folder,{withFileTypes:true});}catch{continue;}const executable=files.find(f=>f.isFile()&&/^kindle ?previewer(?: ?[34])?\.exe$/i.test(f.name));if(executable)return path.join(folder,executable.name);}
  }return null;
}
export async function loadTools(config){let tools={};try{tools=JSON.parse(await fs.readFile(config,'utf8'));}catch{}if(!tools.previewer)tools.previewer=await detectPreviewer();return {...tools,java:process.env.OFFICINA_JAVA||tools.java,epubcheck:process.env.OFFICINA_EPUBCHECK||tools.epubcheck};}
export async function toolStatus(tools){const exists=async(file,alias=false)=>{if(!file)return false;try{await fs.access(file);const info=await(alias?fs.lstat(file):fs.stat(file));return info.isFile()||(alias&&info.isSymbolicLink());}catch{return false;}};return {validator:await exists(tools.java)&&await exists(tools.epubcheck),previewer:await exists(tools.previewer,true)};}
export async function validateEpub(file,tools,output,{signal}={}){
  if(signal?.aborted)throw new Error('Verifica annullata.');
  if(!(await toolStatus(tools)).validator)return {status:'non disponibile',message:'Configura Java ed EPUBCheck per la verifica ufficiale.'};
  const before=sha256(await fs.readFile(file));await fs.mkdir(output,{recursive:true});const stem=path.join(output,'epubcheck-'+randomUUID()),jsonFile=stem+'.json';let log='';
  const code=await new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('Verifica annullata.'));return;}
    const child=spawn(tools.java,['-Djavax.xml.accessExternalDTD=','-Djavax.xml.accessExternalSchema=','-jar',tools.epubcheck,file,'--json',jsonFile],{shell:false,windowsHide:true});
    const stop=()=>child.kill(),timer=setTimeout(stop,180000);signal?.addEventListener('abort',stop,{once:true});
    const collect=data=>{log+=data.toString();if(log.length>2_000_000)child.kill();};child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(signal?.aborted)reject(new Error('Verifica annullata.'));else resolve(code);});
  });
  await fs.writeFile(stem+'.log',log,{flag:'wx'});let raw;try{raw=JSON.parse(await fs.readFile(jsonFile,'utf8'));}catch{throw new Error('EPUBCheck non ha prodotto un rapporto leggibile. Log: '+stem+'.log');}
  if(sha256(await fs.readFile(file))!==before)throw new Error('L’eBook è cambiato durante la verifica. Ripeti sul file attuale.');
  if(!raw.checker||![raw.checker.nFatal,raw.checker.nError,raw.checker.nWarning].every(Number.isInteger))throw new Error('Rapporto EPUBCheck senza conteggi verificabili: '+jsonFile);
  const messages=raw.messages||[],errors=raw.checker.nFatal+raw.checker.nError,warnings=raw.checker.nWarning;
  return {status:errors?'errori':code===0?(warnings?'conforme con avvisi':'conforme'):'esito da verificare',exitCode:code,errors,warnings,checkedSha256:before,messages:messages.slice(0,100),log:stem+'.log',report:jsonFile,version:raw.checker.checkerVersion||null};
}
export function previewerArguments(file,executable,output){const modern=/kindle ?previewer ?4|KindlePreviewerCLI\.exe$/i.test(executable),dash=modern?'--':'-';return [file,dash+'showpreview',dash+'output',output,dash+'locale','it'];}
export async function launchPreviewer(file,tools,{outputRoot}={}){
  if(!(await toolStatus(tools)).previewer)throw new Error('Kindle Previewer non configurato: scegli il programma ufficiale già installato oppure apri la pagina Amazon.');
  if(!outputRoot)throw new Error('Destinazione anteprima non configurata.');
  const output=path.join(outputRoot,'kindle-'+randomUUID());await fs.mkdir(output,{recursive:true});const bytes=await fs.readFile(file),sourceHash=sha256(bytes),input=path.join(output,'anteprima.epub');await fs.writeFile(input,bytes,{flag:'wx'});
  const args=previewerArguments(input,tools.previewer,output);const pid=await new Promise((resolve,reject)=>{const child=spawn(tools.previewer,args,{shell:false,windowsHide:false,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve(child.pid);});});
  const result={status:'avvio richiesto',pid,source:file,sourceSha256:sourceHash,input,output,executable:tools.previewer,args,createdAt:new Date().toISOString(),message:'Apertura richiesta a Kindle Previewer sulla copia locale. Controlla la conversione e la pagina nel programma Amazon: l’avvio non certifica l’esito.'};await fs.writeFile(path.join(output,'officina-avvio.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
}
