import fs from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,PDFDict,PDFArray,PDFName,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {ProjectSchema,mmToPt} from './model.mjs';
import {sha256} from './storage.mjs';
import {readFont,FONT_FEATURES} from './fonts.mjs';
import {planKdp,configurationKey,KDP_OUTPUT_RULES,KDP_SOURCES,KDP_CHECKED_AT} from './kdp.mjs';

export function coverDimensions(project) {
  const p=ProjectSchema.parse(project),plan=planKdp({...p.kdp,pageCount:p.pages.length});
  if(!p.kdp)throw new Error('Scegli e applica prima il formato KDP.');
  if(plan.settingsErrors.length)throw new Error(plan.settingsErrors.join('\n'));
  if(p.kdp.binding==='paperback')return {widthPt:mmToPt(plan.coverMm[0]),heightPt:mmToPt(plan.coverMm[1]),source:'formula KDP brossura',plan};
  const template=p.cover?.template;
  if(!template)throw new Error('Per il rigido scarica e importa il PDF del modello dal calcolatore KDP. Risvolti e cerniere non si deducono con la formula della brossura.');
  if(template.configuration!==configurationKey(p))throw new Error('Il modello rigido è riferito a opzioni o pagine diverse. Scarica e importa un nuovo modello KDP.');
  return {widthPt:template.widthPt,heightPt:template.heightPt,source:'dimensioni del modello scelto dall’utente; provenienza da confermare',plan};
}
function inspectResources(doc,resources,visited=new Set()) {
  const warnings=[];if(!resources)return warnings;
  const r=doc.context.lookup(resources);if(!(r instanceof PDFDict)||visited.has(r))return warnings;visited.add(r);
  if(visited.size>10000)throw new Error('PDF troppo complesso per la verifica iniziale.');
  const fonts=doc.context.lookup(r.get(PDFName.of('Font')));
  if(fonts instanceof PDFDict)for(const key of fonts.keys()) {
    const f=doc.context.lookup(fonts.get(key));if(!(f instanceof PDFDict))continue;
    let descriptor=f.get(PDFName.of('FontDescriptor'));
    const descendants=doc.context.lookup(f.get(PDFName.of('DescendantFonts')));
    if(descendants instanceof PDFArray){const child=doc.context.lookup(descendants.get(0));if(child instanceof PDFDict)descriptor=child.get(PDFName.of('FontDescriptor'));}
    const d=doc.context.lookup(descriptor);
    if(!(d instanceof PDFDict)||!['FontFile','FontFile2','FontFile3'].some(n=>d.has(PDFName.of(n))))warnings.push('Uno o più font non risultano incorporati nelle risorse controllate.');
  }
  const states=doc.context.lookup(r.get(PDFName.of('ExtGState')));
  if(states instanceof PDFDict)for(const key of states.keys()) {
    const state=doc.context.lookup(states.get(key));if(!(state instanceof PDFDict))continue;
    if(['ca','CA'].some(n=>{const v=doc.context.lookup(state.get(PDFName.of(n)));return v?.asNumber&&v.asNumber()<1;}))warnings.push('Trasparenze presenti: occorre un file appiattito prima dell’invio.');
    const mask=state.get(PDFName.of('SMask'));if(mask&&mask.toString()!=='/None')warnings.push('Maschera di trasparenza presente: verificare appiattimento.');
  }
  const objects=doc.context.lookup(r.get(PDFName.of('XObject')));
  if(objects instanceof PDFDict)for(const key of objects.keys()) {
    const object=doc.context.lookup(objects.get(key)),dict=object?.dict;
    if(dict instanceof PDFDict){if(dict.has(PDFName.of('SMask'))||dict.has(PDFName.of('Mask')))warnings.push('Immagine con alfa o maschera: verificare appiattimento.');warnings.push(...inspectResources(doc,dict.get(PDFName.of('Resources')),visited));}
  }
  return [...new Set(warnings)];
}
async function inspectBytes(bytes) {
  if(bytes.length>KDP_OUTPUT_RULES.cover.maxBytes)throw new Error('PDF oltre il limite KDP di 650 MB.');
  let doc;try{doc=await PDFDocument.load(bytes);}catch{throw new Error('Il PDF non è leggibile o è protetto. Esporta dalla sorgente un PDF di stampa senza password.');}if(doc.getPageCount()!==1)throw new Error('La copertina deve essere un PDF di una pagina con quarta, dorso e prima.');
  const page=doc.getPage(0),box=page.getMediaBox();
  if(![page.getWidth(),page.getHeight()].every(n=>Number.isFinite(n)&&n>0&&n<=5000))throw new Error('Dimensioni PDF non valide o oltre il limite del verificatore iniziale.');
  if(page.getRotation().angle!==0||Math.abs(box.x)>.01||Math.abs(box.y)>.01||page.node.has(PDFName.of('UserUnit')))throw new Error('PDF con rotazione, origine o unità non standard: esportalo dalla sorgente con misure fisiche esplicite.');
  if(doc.catalog.has(PDFName.of('OpenAction'))||doc.catalog.has(PDFName.of('AA')))throw new Error('Il PDF contiene azioni automatiche: usa un PDF di stampa senza azioni.');
  const warnings=inspectResources(doc,page.node.Resources());
  const annotations=doc.context.lookup(page.node.get(PDFName.of('Annots')));if(annotations instanceof PDFArray&&annotations.size())warnings.push('Annotazioni presenti: rimuoverle dalla sorgente di stampa.');
  if(bytes.length>KDP_OUTPUT_RULES.cover.recommendedBytes)warnings.push('Copertina oltre i 40 MB raccomandati: nessuna compressione automatica.');
  return {widthPt:page.getWidth(),heightPt:page.getHeight(),warnings};
}
export async function importCoverPdf(store,project,source,role='artwork') {
  if(!['artwork','template'].includes(role))throw new Error('Tipo di documento non riconosciuto.');
  const p=ProjectSchema.parse(project);if(!p.kdp)throw new Error('Scegli prima il formato KDP.');
  const stat=await fs.stat(source);if(stat.size>KDP_OUTPUT_RULES.cover.maxBytes)throw new Error('File oltre 650 MB: importazione interrotta.');
  const bytes=await fs.readFile(source),info=await inspectBytes(bytes),hash=sha256(bytes),name=hash+'.pdf';
  if(role==='template') {
    const plan=planKdp({...p.kdp,pageCount:p.pages.length});
    if(p.kdp.binding!=='hardcover')throw new Error('Il modello PDF è richiesto qui per la copertina rigida. Per la brossura le dimensioni sono calcolate.');
    if(info.widthPt<mmToPt(plan.trimMm[0]*2)||info.heightPt<mmToPt(plan.trimMm[1]))throw new Error('Il modello non contiene le dimensioni minime della copertina scelta.');
  }
  try{await fs.writeFile(store.file('assets',name),bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(sha256(await fs.readFile(store.file('assets',name)))!==hash)throw new Error('PDF già archiviato ma corrotto.');}
  return {file:name,sha256:hash,bytes:bytes.length,widthPt:info.widthPt,heightPt:info.heightPt,configuration:configurationKey(p)};
}
export async function checkCover(store,project) {
  const p=ProjectSchema.parse(project),expected=coverDimensions(p),asset=p.cover?.artwork;
  if(!asset)throw new Error('Importa il PDF completo della copertina da verificare.');
  if(p.cover?.template){const bytes=await fs.readFile(store.file('assets',p.cover.template.file));if(sha256(bytes)!==p.cover.template.sha256)throw new Error('Modello copertina corrotto.');}
  const bytes=await fs.readFile(store.file('assets',asset.file));if(sha256(bytes)!==asset.sha256)throw new Error('PDF copertina corrotto.');
  const actual=await inspectBytes(bytes),matches=Math.abs(actual.widthPt-expected.widthPt)<=.1&&Math.abs(actual.heightPt-expected.heightPt)<=.1;
  return {geometricMatch:matches,blockingIssues:actual.warnings.filter(s=>!s.includes('40 MB')),actualPt:[actual.widthPt,actual.heightPt],expectedPt:[expected.widthPt,expected.heightPt],source:expected.source,configuration:configurationKey(p),warnings:[...actual.warnings,...expected.plan.issues],manualChecks:['Titolo e autore coerenti con la scheda', 'Qualità e PPI di ogni immagine', 'Colori, appiattimento, margini, barcode e testo del dorso nel Previewer', 'Nessuna certificazione automatica di conformità'],checkedAt:KDP_CHECKED_AT,sources:KDP_SOURCES,sha256:asset.sha256};
}
export async function exportCover(store,project) {
  const report=await checkCover(store,project);
  if(!report.geometricMatch)throw new Error('Dimensioni copertina diverse da quelle richieste dal formato e dalla carta. Correggi la sorgente; nessun ridimensionamento automatico.');
  if(report.blockingIssues.length)throw new Error(report.blockingIssues.join('\n')+' Correggi il PDF sorgente prima di copiarlo nell’output.');
  const plan=planKdp({...project.kdp,pageCount:project.pages.length});if(plan.settingsErrors.length||plan.submissionErrors.length)throw new Error(plan.issues.join('\n'));
  const bytes=await fs.readFile(store.file('assets',project.cover.artwork.file));if(sha256(bytes)!==report.sha256)throw new Error('La copertina è cambiata dopo la verifica.');
  const name='copertina-'+new Date().toISOString().replace(/[:.]/g,'-')+'.pdf';await store.atomic(path.join('outputs',name),bytes);
  await store.atomic(path.join('outputs',name+'.json'),JSON.stringify({...report,status:'originale copiato; geometria verificata; controlli manuali pendenti'},null,2));
  return {path:store.file('outputs',name),report};
}
export async function exportCoverGuide(store,project,fontPath) {
  const expected=coverDimensions(project);if(project.kdp.binding!=='paperback')throw new Error('Per il rigido usa il modello scaricato da KDP; non viene generato uno schema approssimato.');
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const info=await readFont(fontPath,project.font),font=await doc.embedFont(info.bytes,{subset:info.subset,features:FONT_FEATURES});
  const page=doc.addPage([expected.widthPt,expected.heightPt]),b=9,w=mmToPt(expected.plan.trimMm[0]),s=mmToPt(expected.plan.spineMm),h=expected.heightPt;
  page.drawRectangle({x:0,y:0,width:expected.widthPt,height:h,color:rgb(.96,.96,.94)});
  const line=(x1,y1,x2,y2,color)=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:.5,color});
  for(const x of [b,b+w,b+w+s,b+2*w+s])line(x,0,x,h,rgb(.7,.2,.2));
  for(const y of [b,h-b])line(0,y,expected.widthPt,y,rgb(.7,.2,.2));
  for(const x of [b,b+w+s])page.drawRectangle({x:x+9,y:b+9,width:w-18,height:h-2*b-18,borderColor:rgb(.2,.5,.3),borderWidth:.5});
  for(const [text,x] of [['QUARTA',b+20],['PRIMA',b+w+s+20]])page.drawText(text,{x,y:h/2,size:14,font});
  page.drawText('SCHEMA TECNICO - NON CARICARE SU KDP',{x:18,y:h-25,size:10,font,color:rgb(.7,.15,.15)});
  page.drawText(`Dorso ${expected.plan.spineMm} mm - ${expected.plan.countedPages} pagine KDP`,{x:18,y:20,size:9,font});
  const bytes=await doc.save(),name='SCHEMA-NON-CARICARE-copertina-'+Date.now()+'.pdf';
  await store.atomic(path.join('outputs',name),bytes);await store.atomic(path.join('outputs',name+'.json'),JSON.stringify({purpose:'guida tecnica, non copertina finale',...expected,sha256:sha256(bytes),sources:KDP_SOURCES},null,2));return {path:store.file('outputs',name)};
}
