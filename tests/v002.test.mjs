import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ProjectStore,sha256} from '../packages/storage.mjs';
import {createProject,parseProject} from '../packages/model.mjs';
import {createBackup,restoreBackup,verifyBackup} from '../packages/backup.mjs';
import {readFont,inspectFont} from '../packages/fonts.mjs';
import {preflight,exportPdf} from '../packages/pdf.mjs';
const base=path.resolve('output/v002-'+Date.now()),fonts=path.join(process.env.WINDIR||'C:\\Windows','Fonts');
const georgia=path.join(fonts,'georgia.ttf'),arial=path.join(fonts,'arial.ttf');
before(async()=>{await fs.mkdir(base,{recursive:true});});
async function fresh(name){const s=new ProjectStore(path.join(base,name));return [s,await s.create('Prova 0.0.2','romanzo')];}
test('schema 1: apertura senza scritture e snapshot originale conservato al primo salvataggio',async()=>{
  const [s,p]=await fresh('schema');p.schemaVersion=1;const raw=JSON.stringify(p,null,2);await fs.writeFile(s.file('manifest.json'),raw);
  const upgraded=await s.read();assert.equal(upgraded.schemaVersion,3);assert.equal(await fs.readFile(s.file('manifest.json'),'utf8'),raw);
  const saved=await s.save(upgraded);assert.equal(saved.schemaVersion,3);
  assert.equal(await fs.readFile(s.file('snapshots',(await s.snapshots())[0]),'utf8'),raw);
  assert.throws(()=>parseProject({...createProject('Futuro'),schemaVersion:99}));
});
test('backup annullato: marker incompleto, apertura negata e sorgente intatta',async()=>{
  const [s,p]=await fresh('cancel');await s.save(p);await fs.writeFile(s.file('outputs','prova.txt'),'output sintetico');
  const before=sha256(await fs.readFile(s.file('manifest.json'))),parent=path.join(base,'cancel-copies');await fs.mkdir(parent);
  const controller=new AbortController();await assert.rejects(createBackup(s,parent,{signal:controller.signal,onProgress:()=>controller.abort()}),/annullato|incompleta/);
  const names=await fs.readdir(parent);assert.equal(names.length,1);const copy=path.join(parent,names[0]);
  await assert.rejects(verifyBackup(copy),/incompleto/);await assert.rejects(new ProjectStore(copy).read(),/incompleta/);
  assert.equal(sha256(await fs.readFile(s.file('manifest.json'))),before);
  await assert.rejects(fs.access(s.file('.officina-write.lock')));
});
test('backup: destinazione interna respinta, file extra e risorse mancanti rilevati',async()=>{
  const [s]=await fresh('inside');await assert.rejects(createBackup(s,s.root),/esterna/);
  const parent=path.join(base,'extra-copies');await fs.mkdir(parent);const copy=await createBackup(s,parent);
  await fs.writeFile(path.join(copy.path,'extra.txt'),'non inventariato');await assert.rejects(verifyBackup(copy.path),/Elenco/);
  await fs.unlink(path.join(copy.path,'extra.txt'));await fs.unlink(path.join(copy.path,'manifest.json'));await assert.rejects(verifyBackup(copy.path),/Elenco/);
});
test('ripristino di progetto senza snapshot: nuova cartella subito salvabile, backup invariato',async()=>{
  const [s]=await fresh('empty-folders'),parent=path.join(base,'empty-copies');await fs.mkdir(parent);const copy=await createBackup(s,parent);
  const original=sha256(await fs.readFile(path.join(copy.path,'manifest.json'))),dest=path.join(base,'restored');await fs.mkdir(dest);
  const result=await restoreBackup(copy.path,dest),restored=new ProjectStore(result.path),p=await restored.read();p.title='Nuovo lavoro';await restored.save(p);
  assert.equal((await s.read()).title,'Prova 0.0.2');assert.equal((await verifyBackup(copy.path)).project.title,'Prova 0.0.2');
  assert.equal(sha256(await fs.readFile(path.join(copy.path,'manifest.json'))),original);
});
test('font diversi: mismatch respinto e caratteri mancanti bloccano il PDF',async()=>{
  const [s,p]=await fresh('font-ref');p.font=(await readFont(georgia)).ref;
  await assert.rejects(exportPdf(s,p,arial),/font è cambiato/);
  p.pages[0].nodes[0].text='Testo 🧬';const result=await preflight(p,georgia);assert.ok(result.issues.some(i=>i.message.includes('Caratteri non presenti')));
  await assert.rejects(exportPdf(s,p,georgia),/Caratteri non presenti/);
});
test('font con embedding vietato: rifiuto tecnico prima di caricare o incorporare',async()=>{
  const bytes=Buffer.from(await fs.readFile(georgia));let offset;
  for(let i=0;i<bytes.readUInt16BE(4);i++){const record=12+i*16;if(bytes.toString('ascii',record,record+4)==='OS/2')offset=bytes.readUInt32BE(record+8);}
  assert.ok(offset);bytes.writeUInt16BE(2,offset+8);assert.throws(()=>inspectFont(bytes),/diritti tecnici/);
});
test('Arial: PDF riaperto da parser indipendente, righe e posizioni confrontate',async()=>{
  const [s,p]=await fresh('arial');p.font=(await readFont(arial)).ref;const n=p.pages[0].nodes[0];
  n.text='AVATAR office fi ffi Città, perché, più.\nUna seconda riga italiana.';n.style.background=true;
  const result=await exportPdf(s,p,arial),layout=result.report.check.layouts[n.id];
  const spec=path.join(base,'font-spec.json');await fs.writeFile(spec,JSON.stringify({font:p.font.postscriptName,xPt:n.x*72/25.4,baselinePt:n.y*72/25.4+n.style.sizePt,sizePt:n.style.sizePt,linePt:layout.linePt,lines:layout.lines,widths:layout.widths}));
  execFileSync('python',['tests/verify_font.py',result.path,spec],{stdio:'inherit'});
  assert.equal(result.report.font.sourceSha256,p.font.sha256);await fs.writeFile('output/LATEST_V002.txt',base);
});
