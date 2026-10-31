import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ProjectStore, sha256 } from '../packages/storage.mjs';
import { createProject, newPage, ProjectSchema, wrapText } from '../packages/model.mjs';
import { exportPdf, preflight } from '../packages/pdf.mjs';
import { createBackup, restoreBackup, verifyBackup } from '../packages/backup.mjs';
import { FontCatalog, readFont } from '../packages/fonts.mjs';
import { moveBox, resizeBox } from '../packages/box.mjs';
import { planKdp } from '../packages/kdp.mjs';
import { PDFDocument } from 'pdf-lib';
const output = path.resolve('output/test-'+Date.now());
const font = process.env.OFFICINA_FONT || path.join(process.env.WINDIR || 'C:\\Windows','Fonts','georgia.ttf');
before(async()=>{await fs.mkdir(output,{recursive:true});execFileSync('python',['tests/fixtures.py',output],{stdio:'inherit'});});
async function fresh(name) { const s=new ProjectStore(path.join(output,name));return [s,await s.create('Libro sintetico italiano','romanzo')]; }
test('schema: tre tipi, due flussi coordinati predisposti, versioni future rifiutate',()=>{
  const p=createProject('Prova','bilingue');p.flows.push({id:'en',language:'en',pairedFlowId:'it'});assert.ok(ProjectSchema.parse(p));
  assert.throws(()=>ProjectSchema.parse({...p,schemaVersion:99}));assert.throws(()=>ProjectSchema.parse({...p,unexpected:'x'}));
});
test('wrapping: parole intere e righe vuote, nessuna sillabazione fittizia',()=>{
  assert.deepEqual(wrapText('Una frase lunga\n\nFine',9,s=>s.length),['Una frase','lunga','','Fine']);
  assert.deepEqual(wrapText('lunghissimaparola',3,s=>s.length),['lunghissimaparola']);
});
test('T-Reedsy parziale: tutte le sezioni rinominate, riordinate, rimosse e riaperte',async()=>{
  const [s,p]=await fresh('sezioni');p.pages=[newPage('Dedica'),newPage('Capitolo'),newPage('Ringraziamenti')];p.pages[0].role='iniziale';p.pages[2].role='finale';
  let saved=await s.save(p);saved.pages.reverse();saved.pages[0].name='Saluto finale';saved=await s.save(saved);
  const reopened=await new ProjectStore(s.root).read();assert.equal(reopened.pages[0].name,'Saluto finale');
  reopened.pages=[];await s.save(reopened);assert.deepEqual((await s.read()).pages,[]);
  await assert.rejects(exportPdf(s,await s.read(),font),/almeno una pagina/);
});
test('snapshot e ripristino non distruttivo; salvataggio obsoleto respinto',async()=>{
  const [s,p]=await fresh('backup');let a=await s.save({...p,title:'Seconda versione'});
  await assert.rejects(s.save(p),/Conflitto/);
  const snapshot=(await s.snapshots())[0];const b=await s.restore(snapshot);assert.equal(b.title,p.title);assert.ok(b.revision>a.revision);assert.equal((await s.snapshots()).length,2);
  await fs.writeFile(s.file('manifest.json.interrotto.tmp'),'incompleto');assert.equal((await s.read()).title,p.title);
});
test('lock occupato e backup incompleto producono errori senza cancellare lo stato',async()=>{
  const [s,p]=await fresh('lock');
  await fs.writeFile(s.file('.officina-write.lock'),'altra istanza');await assert.rejects(s.save(p),/occupato/);assert.equal((await s.read()).revision,0);
  await fs.unlink(s.file('.officina-write.lock'));await s.save(p);
  const incomplete=new ProjectStore(path.join(output,'copia-incompleta'));await fs.mkdir(incomplete.root);
  const manifest=await s.read();const a=await s.importImage(path.join(output,'fixture.png'));manifest.assets[a.name]=a.metadata;
  await fs.writeFile(incomplete.file('manifest.json'),JSON.stringify(manifest));await assert.rejects(incomplete.read(),/ENOENT/);
  assert.equal((await s.read()).revision,1);
});
test('cartella non vuota, path traversal e asset mancante respinti',async()=>{
  const [s,p]=await fresh('sicurezza');await assert.rejects(s.create('Altro'),/vuota/);
  await assert.rejects(s.imageData('../manifest.json'),/non valido/);await assert.rejects(s.restore('../manifest.json'),/sconosciuto/);
  p.pages[0].nodes.push({id:randomUUID(),type:'image',x:1,y:1,width:10,height:10,asset:'a'.repeat(64)+'.png',alt:''});assert.throws(()=>ProjectSchema.parse(p));
});
test('immutabilità e integrità SHA degli asset, rifiuto file corrotto',async()=>{
  const [s,p]=await fresh('integrita');const a=await s.importImage(path.join(output,'fixture.png'));p.assets[a.name]=a.metadata;await s.save(p);
  assert.equal(sha256(await fs.readFile(s.file('assets',a.name))),sha256(await fs.readFile(path.join(output,'fixture.png'))));
  await fs.writeFile(s.file('assets',a.name),'rotto');await assert.rejects(s.read(),/Integrità/);await assert.rejects(s.importImage(path.join(output,'fixture.png')),/corrotto/);
});
test('profili colore non supportati sono bloccati prima di qualsiasi conversione',async()=>{
  const [s]=await fresh('colore');await assert.rejects(s.importImage(path.join(output,'profile-not-supported.png')),/profilo colore/);
  assert.deepEqual(await fs.readdir(s.file('assets')),[]);
});
test('overflow e oggetti fuori pagina bloccano export senza alterare font/interlinea',async()=>{
  const [s,p]=await fresh('overflow');const n=p.pages[0].nodes[0];n.height=1;
  await assert.rejects(exportPdf(s,p,font),/overflow/);assert.equal(n.style.sizePt,14);assert.equal(n.style.lineHeight,1.4);
  n.height=100;n.x=150;await assert.rejects(exportPdf(s,p,font),/oltre il rifilo/);
});
test('T-Immagini parziale: PNG alfa e JPEG >5000 px, PDF riaperto e verifica indipendente',async()=>{
  const [s,p]=await fresh('immagini');p.geometry.bleedMm=3.175;
  p.pages[0].nodes[0].text='Città, perché, più: una pagina italiana.';
  p.pages[0].nodes[0].style.background=true;
  for(const ext of ['png','jpg']) {
    const a=await s.importImage(path.join(output,'fixture.'+ext));p.assets[a.name]=a.metadata;
    p.pages[0].nodes.push({id:randomUUID(),type:'image',x:18,y:ext==='png'?135:170,width:115,height:115*a.metadata.height/a.metadata.width,asset:a.name,alt:'Forme geometriche sintetiche'});
  }
  const saved=await s.save(p), start=performance.now();const result=await exportPdf(s,saved,font);
  const report={...result.report,elapsedMs:performance.now()-start,rssBytes:process.memoryUsage().rss};
  await fs.writeFile(path.join(output,'measurements.json'),JSON.stringify(report,null,2));
  assert.equal(report.pages,1);assert.ok(Math.abs(report.mediaPt[0]-450)<.001);assert.ok(Math.abs(report.mediaPt[1]-666)<.001);
  assert.equal(report.images[0].pixels[0],5201);assert.ok(report.images[0].ppi[0]>1100);
  execFileSync('python',['tests/verify_pdf.py',result.path,path.join(output,'fixture.png'),path.join(output,'fixture.jpg')],{stdio:'inherit'});
  await fs.copyFile(result.path,path.join(output,'demo-verificata.pdf'));
  await fs.writeFile('output/LATEST.txt',output);
});
test('T-Albo geometrico parziale: 70 pagine con abbondanza, alfa e nessun ricampionamento',async()=>{
  const [s,p]=await fresh('albo70');p.geometry={trimWidthMm:215.9,trimHeightMm:215.9,bleedMm:3.175,safeMm:12};p.kind='albo';
  const a=await s.importImage(path.join(output,'fixture.png'));p.assets[a.name]=a.metadata;
  p.pages=Array.from({length:70},(_,i)=>{const page=newPage('Pagina sintetica '+(i+1));page.nodes[0].text='Scena sintetica '+(i+1);page.nodes[0].style.background=true;page.nodes.push({id:randomUUID(),type:'image',x:18,y:140,width:150,height:150*640/5201,asset:a.name,alt:'Geometria sintetica'});return page;});
  const start=performance.now(),result=await exportPdf(s,p,font),loaded=await PDFDocument.load(await fs.readFile(result.path));assert.equal(loaded.getPageCount(),70);assert.ok(Math.abs(loaded.getPage(69).getWidth()-630)<.001);
  execFileSync('python',['tests/verify_albo.py',result.path],{stdio:'inherit'});
  await fs.writeFile(path.join(output,'albo70-metrics.json'),JSON.stringify({pages:70,elapsedMs:performance.now()-start,rssBytes:process.memoryUsage().rss,bytes:(await fs.stat(result.path)).size}));
});
test('sfondo: larghezze per riga cambiano al cambio box senza alterare lo stile',async()=>{
  const p=createProject('Prova'),n=p.pages[0].nodes[0];n.text='Una frase abbastanza lunga da occupare più righe nel box.';n.style.background=true;
  const first=await preflight(p,font);n.width=60;const next=await preflight(p,font);assert.ok(next.layouts[n.id].lines.length>first.layouts[n.id].lines.length);assert.equal(n.style.sizePt,14);assert.equal(n.style.lineHeight,1.4);
});
test('backup completo: verifica byte, rifiuta manomissioni e ripristina in nuova cartella',async()=>{
  const [s,p]=await fresh('backup-esterno');
  const asset=await s.importImage(path.join(output,'fixture.png'));p.assets[asset.name]=asset.metadata;
  const saved=await s.save(p),parent=path.join(output,'copie');await fs.mkdir(parent);
  const copy=await createBackup(s,parent);const verified=await verifyBackup(copy.path);
  assert.equal(verified.project.revision,saved.revision);assert.equal(verified.report.files.length,3);
  const restoreParent=path.join(output,'ripristini');await fs.mkdir(restoreParent);
  const restored=await restoreBackup(copy.path,restoreParent);
  assert.equal((await new ProjectStore(restored.path).read()).revision,saved.revision);
  assert.equal(sha256(await fs.readFile(path.join(restored.path,'assets',asset.name))),asset.metadata.sha256);
  await fs.writeFile(path.join(copy.path,'manifest.json'),'alterato');
  await assert.rejects(verifyBackup(copy.path),/modificato/);
  assert.equal((await s.read()).revision,saved.revision);
});
test('font vincolato a file e box limitati alla pagina',async()=>{
  const catalog=new FontCatalog([path.dirname(font)],font),installed=await readFont(font);
  const payload=await catalog.payload(installed.ref);
  assert.equal(payload.ref.sha256,installed.ref.sha256);
  assert.equal(sha256(Buffer.from(payload.base64,'base64')),installed.ref.sha256);
  await assert.rejects(catalog.resolve({...installed.ref,sha256:'0'.repeat(64)}),/mancante|diverso/);
  const start={x:10,y:10,width:40,height:20};
  assert.deepEqual(moveBox(start,-100,100,100,100),{x:0,y:80,width:40,height:20});
  assert.deepEqual(resizeBox(start,'se',100,100,100,100),{x:10,y:10,width:90,height:90});
  assert.deepEqual(resizeBox(start,'nw',100,100,100,100),{x:45,y:25,width:5,height:5});
});
test('guida KDP calcola geometria standard e personalizzata senza certificare file',()=>{
  const p=planKdp({formatId:'8.5x8.5',ink:'premium',paper:'white',bleed:true,pageCount:70});
  assert.deepEqual(p.trimMm,[215.9,215.9]);assert.deepEqual(p.interiorMm,[219.075,222.25]);
  assert.equal(p.spineMm,4.173);assert.deepEqual(p.coverMm,[442.323,222.25]);assert.equal(p.maximum,590);
  assert.equal(p.minimumMarginsMm.outside,9.6);
  const custom=planKdp({formatId:'custom',customWidthIn:8.5,customHeightIn:8.5,pageCount:70});
  assert.equal(custom.maximum,null);assert.equal(custom.issues.some(x=>x.includes('Combinazione')),false);
  assert.ok(custom.issues.some(x=>x.includes('calcolatore KDP')));
  assert.ok(planKdp({formatId:'custom',customWidthIn:3,customHeightIn:12}).issues.some(x=>x.includes('tra 4')));
  assert.ok(planKdp({formatId:'8.5x8.5',ink:'standard',paper:'cream'}).issues.some(x=>x.includes('Combinazione')));
});
