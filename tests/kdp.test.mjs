import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {ProjectStore,sha256} from '../packages/storage.mjs';
import {createProject,newPage,parseProject} from '../packages/model.mjs';
import {PAPERBACK_FORMATS,HARDCOVER_FORMATS,planKdp,defaultKdp,applyKdp} from '../packages/kdp.mjs';
import {pageGeometry,safeInsets} from '../packages/geometry.mjs';
import {exportPdf,preflight} from '../packages/pdf.mjs';
import {importCoverPdf,checkCover,exportCover,exportCoverGuide,coverDimensions} from '../packages/covers.mjs';
import {readFont,FONT_FEATURES} from '../packages/fonts.mjs';
const root=path.resolve('output/kdp-'+Date.now()),fontPath=path.join(process.env.WINDIR||'C:/Windows','Fonts','georgia.ttf');
let info;
before(async()=>{await fs.mkdir(root,{recursive:true});info=await readFont(fontPath);});
async function fresh(name,settings=defaultKdp('albo'),pages=70){const store=new ProjectStore(path.join(root,name)),p=await store.create('Libro sintetico KDP','albo',info.ref,settings);p.pages=Array.from({length:pages},(_,i)=>{const page=newPage('Pagina '+(i+1));page.nodes[0].width=p.geometry.trimWidthMm-36;page.nodes[0].text='Pagina italiana sintetica '+(i+1);return page;});return [store,p];}
async function coverFile(file,width,height,{embedded=true,transparent=false}={}){const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const font=embedded?await doc.embedFont(info.bytes,{subset:true,features:FONT_FEATURES}):await doc.embedFont(StandardFonts.Helvetica);const page=doc.addPage([width,height]);page.drawRectangle({x:0,y:0,width,height,color:rgb(.9,.95,.9),...(transparent?{opacity:.5}:{})});page.drawText('COPERTINA SINTETICA',{x:30,y:height-50,size:16,font});const bytes=await doc.save();await fs.writeFile(file,bytes);return bytes;}
test('tabella standard: 16 brossure, 5 rigidi, minimi/massimi e carta verificati',()=>{
  assert.deepEqual(PAPERBACK_FORMATS.map(f=>f.id),['5x8','5.06x7.81','5.25x8','5.5x8.5','6x9','6.14x9.21','6.69x9.61','7x10','7.44x9.69','7.5x9.25','8x10','8.25x6','8.25x8.25','8.5x8.5','8.5x11','8.27x11.69']);
  assert.deepEqual(HARDCOVER_FORMATS.map(f=>f.id),['5.5x8.5','6x9','6.14x9.21','7x10','8.25x11']);
  assert.equal(planKdp({formatId:'8.5x8.5',ink:'black',paper:'cream'}).maximum,550);
  assert.equal(planKdp({formatId:'8.25x8.25',ink:'black',paper:'groundwood'}).maximum,784);
  assert.equal(planKdp({formatId:'8.27x11.69',ink:'standard'}).settingsErrors.length,1);
  assert.ok(planKdp({binding:'hardcover',formatId:'6x9',ink:'standard'}).settingsErrors.length);
  assert.equal(planKdp({binding:'hardcover',formatId:'6x9',pageCount:75}).countedPages,76);
  assert.ok(planKdp({formatId:'custom',customWidthIn:4,customHeightIn:6,ink:'premium',paper:'cream'}).settingsErrors.length);
});
test('dorso: standard, premium, crema e pastalegno hanno coefficienti distinti',()=>{
  const standard=planKdp({formatId:'6x9',ink:'standard',pageCount:100});
  assert.equal(standard.spineMm,5.720);assert.equal(planKdp({formatId:'6x9',ink:'premium',pageCount:100}).spineMm,5.961);
  assert.equal(planKdp({formatId:'6x9',ink:'black',paper:'cream',pageCount:100}).spineMm,6.35);
  assert.equal(planKdp({formatId:'6x9',ink:'black',paper:'groundwood',pageCount:100}).spineMm,5.969);
  assert.deepEqual(standard.coverMm,planKdp({formatId:'6x9',ink:'standard',pageCount:100,bleed:true}).coverMm);
});
test('tutti i formati: 42 PDF veri riaperti da parser indipendente con e senza smarginatura',async()=>{
  const cases=[];
  for(const [binding,formats] of [['paperback',PAPERBACK_FORMATS],['hardcover',HARDCOVER_FORMATS]])for(const format of formats)for(const bleed of [false,true]){
    const [store,p]=await fresh(`${binding}-${format.id}-${bleed}`,{binding,formatId:format.id,ink:'black',paper:'white',bleed},2);
    const result=await exportPdf(store,p,fontPath);cases.push({file:result.path,width:format.widthIn*72+(bleed?9:0),height:format.heightIn*72+(bleed?18:0),trimWidth:format.widthIn*72,trimHeight:format.heightIn*72,bleed});
    assert.equal(p.pages.length,2);assert.equal(p.pages[0].nodes[0].style.sizePt,14);
  }
  const spec=path.join(root,'geometry-cases.json');await fs.writeFile(spec,JSON.stringify(cases));execFileSync('python',['tests/verify_kdp.py',spec],{stdio:'inherit'});
  assert.equal(cases.length,42);await fs.writeFile('output/LATEST_KDP.txt',root);
});
test('smarginatura albo: 8,5 quadrato richiede 8,625 × 8,75, margini interni speculari',()=>{
  const p=applyKdp(createProject('Albo','albo'),{...defaultKdp('albo'),bleed:true});
  const odd=pageGeometry(p.geometry,0),even=pageGeometry(p.geometry,1);
  assert.ok(Math.abs(odd.widthMm/25.4-8.625)<.00001);assert.ok(Math.abs(odd.heightMm/25.4-8.75)<.00001);
  assert.equal(odd.trimX,0);assert.equal(even.trimX,3.175);
  const plan=planKdp({...p.kdp,pageCount:400});p.geometry.safeMm=0;assert.equal(safeInsets(p,0,plan).left,15.9);assert.equal(safeInsets(p,1,plan).right,15.9);
});
test('personalizzato: limiti geometrici e persistenza schema precedente',async()=>{
  const settings={...defaultKdp(),formatId:'custom',customWidthIn:4,customHeightIn:6,bleed:true};
  const [store,p]=await fresh('custom',settings,2);assert.ok(p.pages[0].nodes[0].width<p.geometry.trimWidthMm);
  const result=await exportPdf(store,p,fontPath),doc=await PDFDocument.load(await fs.readFile(result.path));assert.ok(Math.abs(doc.getPage(0).getWidth()-297)<.001);assert.ok(Math.abs(doc.getPage(0).getHeight()-450)<.001);
  const old={...createProject('Schema due'),schemaVersion:2};delete old.cover;const migrated=parseProject(old);assert.equal(migrated.schemaVersion,3);assert.deepEqual(migrated.pages,old.pages);
});
test('immagini a sbordo ammesse soltanto entro MediaBox, pixel preservati',async()=>{
  execFileSync('python',['tests/fixtures.py',root],{stdio:'inherit'});
  const [store,p]=await fresh('bleed-image',{...defaultKdp('albo'),bleed:true},2),asset=await store.importImage(path.join(root,'fixture.png'));p.assets[asset.name]=asset.metadata;
  for(const [index,page] of p.pages.entries()){const g=pageGeometry(p.geometry,index);page.nodes=[{id:crypto.randomUUID(),type:'image',asset:asset.name,alt:'Fixture geometrica a sbordo',x:-g.left,y:-g.top,width:g.widthMm,height:g.heightMm}];}
  const result=await exportPdf(store,p,fontPath);assert.deepEqual(result.report.images[0].pixels,[5201,640]);
  p.pages[0].nodes[0].x=-1;assert.ok((await preflight(p,fontPath)).issues.some(i=>i.severity==='errore'));
});
test('copertina brossura: dimensioni effettive, font e byte originali preservati',async()=>{
  const [store,p]=await fresh('cover'),expected=coverDimensions(p),source=path.join(root,'cover-source.pdf'),original=await coverFile(source,expected.widthPt,expected.heightPt);
  p.cover={artwork:await importCoverPdf(store,p,source)};const report=await checkCover(store,p);assert.equal(report.geometricMatch,true);assert.deepEqual(report.blockingIssues,[]);
  await store.save(p);const result=await exportCover(store,p);assert.equal(sha256(await fs.readFile(result.path)),sha256(original));assert.equal(sha256(await fs.readFile(source)),sha256(original));
  const guide=await exportCoverGuide(store,p,fontPath),doc=await PDFDocument.load(await fs.readFile(guide.path));assert.equal(doc.getPageCount(),1);assert.equal(doc.getPage(0).getWidth(),expected.widthPt);
  await fs.writeFile(path.join(root,'cover-sample-path.txt'),result.path);await fs.writeFile(path.join(root,'guide-sample-path.txt'),guide.path);
  p.pages.push(newPage('Pagina aggiunta'),newPage('Altra pagina'));assert.equal((await checkCover(store,p)).geometricMatch,false);await assert.rejects(exportCover(store,p),/Dimensioni copertina diverse/);
});
test('PDF copertina: errori noti bloccano la copia finale senza ridimensionare',async()=>{
  const [store,p]=await fresh('bad-cover'),expected=coverDimensions(p),source=path.join(root,'bad-cover.pdf');
  await coverFile(source,expected.widthPt-10,expected.heightPt);p.cover={artwork:await importCoverPdf(store,p,source)};await assert.rejects(exportCover(store,p),/Dimensioni/);
  await coverFile(source,expected.widthPt,expected.heightPt,{embedded:false});p.cover.artwork=await importCoverPdf(store,p,source);await assert.rejects(exportCover(store,p),/font non risultano incorporati/);
  await coverFile(source,expected.widthPt,expected.heightPt,{transparent:true});p.cover.artwork=await importCoverPdf(store,p,source);await assert.rejects(exportCover(store,p),/Trasparenze/);
});
test('rigido: modello necessario e vincolato alle opzioni; nessuna formula di brossura',async()=>{
  const [store,p]=await fresh('hardcover',{binding:'hardcover',formatId:'6x9',ink:'black',paper:'white',bleed:true},76);assert.throws(()=>coverDimensions(p),/importa il PDF del modello/);
  const template=path.join(root,'synthetic-template.pdf');await coverFile(template,1000,720);
  p.cover={template:await importCoverPdf(store,p,template,'template')};const source=path.join(root,'hardcover-source.pdf');await coverFile(source,1000,720);p.cover.artwork=await importCoverPdf(store,p,source);
  assert.equal((await checkCover(store,p)).geometricMatch,true);const result=await exportCover(store,p);assert.equal(sha256(await fs.readFile(result.path)),p.cover.artwork.sha256);
  p.pages.push(newPage('Cambio pagine'),newPage('Cambio pagine 2'));assert.throws(()=>coverDimensions(p),/opzioni o pagine diverse/);
});
