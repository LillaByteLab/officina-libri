import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName, rgb,pushGraphicsState,popGraphicsState,rectangle,clip,endPath } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { ProjectSchema, mmToPt, wrapText } from './model.mjs';
import { sha256 } from './storage.mjs';
import { assertImagePolicy } from './image-policy.mjs';
import { readFont, FONT_FEATURES } from './fonts.mjs';
import {planKdp,KDP_OUTPUT_RULES,KDP_SOURCES,KDP_CHECKED_AT} from './kdp.mjs';
import {pageGeometry,safeInsets} from './geometry.mjs';
import {imageView,imagePpi} from './page-tools.mjs';

export async function layoutText(node, font) {
  const measure = s => font.widthOfTextAtSize(s, node.style.sizePt);
  const lines = wrapText(node.text, mmToPt(node.width), measure);
  const linePt = node.style.sizePt * node.style.lineHeight;
  const positions=lines.map(line=>{let advance=0;return [...line].map(char=>{const at=advance;advance+=measure(char);return at;});});
  return { lines, widths: lines.map(measure), positions, linePt, overflow: lines.length * linePt > mmToPt(node.height) || lines.some(l => measure(l) > mmToPt(node.width)) };
}
export async function loadFont(fontPath, expected) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const info=await readFont(fontPath,expected);
  const embedded=await doc.embedFont(info.bytes, { subset: info.subset, features: FONT_FEATURES });
  embedded.officinaSourceHash=info.ref.sha256;return embedded;
}
export async function preflight(project, fontPath) {
  const p = ProjectSchema.parse(project), font = await loadFont(fontPath,p.font), issues = [], layouts = {};
  const supported=new Set(font.getCharacterSet());
  const kdp=p.kdp?planKdp({...p.kdp,pageCount:p.pages.length}):null,kdpIssues=kdp?[...kdp.issues]:[];
  if(kdp&&(p.geometry.bleedMode!=='kdp'||Math.abs(p.geometry.trimWidthMm-kdp.format.widthIn*25.4)>.001||Math.abs(p.geometry.trimHeightMm-kdp.format.heightIn*25.4)>.001||Math.abs(p.geometry.bleedMm-(kdp.bleed?3.175:0))>.001))kdpIssues.push('Le misure del progetto non corrispondono al profilo KDP. Applica formato e smarginatura.');
  for (const [index,page] of p.pages.entries()) for (const n of page.nodes) {
    const geom=pageGeometry(p.geometry,index),safe=safeInsets(p,index,kdp);
    const outside=n.type==='image'?n.x < -geom.left || n.y < -geom.top || n.x+n.width>p.geometry.trimWidthMm+geom.right+.001 || n.y+n.height>p.geometry.trimHeightMm+geom.bottom+.001:n.x<0||n.y<0||n.x+n.width>p.geometry.trimWidthMm+.001||n.y+n.height>p.geometry.trimHeightMm+.001;
    if (outside) issues.push({ severity: 'errore', page: page.name, node: n.id, message: 'Oggetto oltre il rifilo o l’abbondanza consentita' });
    if (n.type==='text'&&(n.x < safe.left || n.y < safe.top || n.x+n.width > p.geometry.trimWidthMm-safe.right || n.y+n.height > p.geometry.trimHeightMm-safe.bottom)) {
      issues.push({ severity: 'avviso', page: page.name, node: n.id, message: 'Testo fuori area sicura'+(kdp?' o margine di rilegatura KDP':'') });
      if(kdp)kdpIssues.push(page.name+': testo fuori margine di sicurezza/rilegatura.');
    }
    if (n.type === 'text') {
      layouts[n.id] = await layoutText(n, font);
      const missing=[...new Set([...n.text].filter(c=>!['\n','\r','\t'].includes(c)&&!supported.has(c.codePointAt(0))))];
      layouts[n.id].unsupported=missing.length>0;
      if(missing.length)issues.push({severity:'errore',page:page.name,node:n.id,message:'Caratteri non presenti nel font scelto: '+missing.join(' ')+'. Scegli un font adatto; nessun carattere sostitutivo viene esportato.'});
      if (layouts[n.id].overflow) issues.push({ severity: 'errore', page: page.name, node: n.id, message: 'Testo in overflow: amplia il box o aggiungi una pagina. Il corpo non viene ridotto.' });
      if(kdp&&n.style.sizePt<7)kdpIssues.push(page.name+': corpo inferiore a 7 pt.');
      if(kdp&&n.style.background)kdpIssues.push(page.name+': effetto semitrasparente da appiattire prima dell’invio; nessuna conversione automatica.');
    } else {
      const a = p.assets[n.asset], ppi = Math.min(...imagePpi(n,a));
      if (ppi < 300) issues.push({ severity: 'avviso', page: page.name, node: n.id, message: `Immagine a ${ppi.toFixed(0)} PPI effettivi; dettaglio nativo non verificato` });
      if(kdp&&ppi<300)kdpIssues.push(page.name+': immagine sotto 300 PPI effettivi.');
      if(kdp&&a.mime==='image/png')kdpIssues.push(page.name+': verificare l’assenza di trasparenze PNG nel file da inviare. Il profilo fedele conserva l’alfa.');
    }
  }
  return { issues, layouts, kdp:kdp?{plan:kdp,submissionIssues:[...new Set(kdpIssues)],status:'geometria e controlli parziali; Previewer e revisione necessari'}:null, fontSha256:font.officinaSourceHash, matrix: { tecnica: issues.some(x => x.severity==='errore') ? 'bloccata' : 'controlli iniziali eseguiti', composizione: 'revisione umana necessaria', narrativa: 'non verificata', autrice: 'approvazione non acquisita' } };
}
export async function exportPdf(store, project, fontPath) {
  const p = ProjectSchema.parse(project);
  if (!p.pages.length) throw new Error('Aggiungi almeno una pagina prima di esportare.');
  const check = await preflight(p, fontPath);
  if (check.issues.some(i => i.severity === 'errore')) throw new Error(check.issues.filter(i=>i.severity==='errore').map(i=>`${i.page}: ${i.message}`).join('\n'));
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const fontInfo=await readFont(fontPath,p.font),fontBytes=fontInfo.bytes, font = await doc.embedFont(fontBytes, { subset: fontInfo.subset, features:FONT_FEATURES });
  doc.setTitle(p.title); doc.setAuthor(p.author); doc.setLanguage('it-IT'); doc.setCreator('Officina Libri 0.0.3');
  const g = p.geometry, first=pageGeometry(g),width=mmToPt(first.widthMm),height=mmToPt(first.heightMm), images = [], embeddedAssets = new Map(),pageBoxes=[];
  for (const [index,source] of p.pages.entries()) {
    const geometry=pageGeometry(g,index),left=mmToPt(geometry.trimX),topBleed=mmToPt(geometry.trimY),bottom=mmToPt(geometry.bottom);
    const page = doc.addPage([width, height]);
    page.setTrimBox(left, bottom, mmToPt(g.trimWidthMm), mmToPt(g.trimHeightMm)); page.setBleedBox(0,0,width,height);
    pageBoxes.push({page:index+1,mediaPt:[0,0,width,height],trimPt:[left,bottom,left+mmToPt(g.trimWidthMm),bottom+mmToPt(g.trimHeightMm)]});
    for (const n of source.nodes) {
      const x = left + mmToPt(n.x), top = height - topBleed - mmToPt(n.y);
      if (n.type === 'text') {
        const l = check.layouts[n.id], size = n.style.sizePt;
        for (let i=0; i<l.lines.length; i++) {
          const baseline = top-size-i*l.linePt;
          if (n.style.background && l.lines[i]) page.drawRectangle({ x: x-2, y: baseline-3, width: l.widths[i]+4, height: size+6, color: rgb(1,1,1), opacity: .6 });
          page.drawText(l.lines[i], { x, y: baseline, size, font, color: rgb(.13,.16,.15) });
        }
      } else {
        const a = p.assets[n.asset];
        let embedded = embeddedAssets.get(n.asset);
        if (!embedded) {
          const bytes = await fs.readFile(store.file('assets', n.asset));
          if (sha256(bytes) !== a.sha256) throw new Error('Integrità immagine non valida');
          const color=assertImagePolicy(bytes);
          embedded = a.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          if(color.renderingIntent){await embedded.embed();doc.context.lookup(embedded.ref).dict.set(PDFName.of('Intent'),PDFName.of(color.renderingIntent));}
          embeddedAssets.set(n.asset, embedded);
        }
        if (embedded.width!==a.width || embedded.height!==a.height) throw new Error('Dimensioni risorsa incoerenti');
        const v=imageView(n),c=v.crop,fw=mmToPt(n.width),fh=mmToPt(n.height),iw=fw/c.width,ih=fh/c.height,bottom=top-fh;
        page.pushOperators(pushGraphicsState(),rectangle(x,bottom,fw,fh),clip(),endPath());
        page.drawImage(embedded,{x:v.mirrorX?x+fw+c.x*iw:x-c.x*iw,y:v.mirrorY?bottom+fh+(1-c.y-c.height)*ih:bottom-(1-c.y-c.height)*ih,width:v.mirrorX?-iw:iw,height:v.mirrorY?-ih:ih});
        page.pushOperators(popGraphicsState());
        images.push({ page: source.id, asset: n.asset, pixels: [embedded.width,embedded.height], ppi: imagePpi(n,a),view:v, sourceSha256: a.sha256 });
      }
    }
  }
  const bytes = await doc.save();
  // Riapertura reale dell'output; ulteriori prove indipendenti in tests/verify_pdf.py.
  const reopened = await PDFDocument.load(bytes);
  for (const [index,page] of reopened.getPages().entries()) {
    const trim=page.getTrimBox(),expected=pageBoxes[index].trimPt;
    if (Math.abs(page.getWidth()-width)>0.001 || Math.abs(page.getHeight()-height)>0.001||Math.abs(trim.x-expected[0])>.001||Math.abs(trim.y-expected[1])>.001||Math.abs(trim.width-mmToPt(g.trimWidthMm))>.001||Math.abs(trim.height-mmToPt(g.trimHeightMm))>.001) throw new Error('Dimensioni o TrimBox PDF inattesi');
  }
  if(p.kdp&&bytes.length>KDP_OUTPUT_RULES.interior.maxBytes)throw new Error('PDF oltre il limite KDP di 650 MB. Nessuna riduzione automatica: esportazione interrotta.');
  const stamp = new Date().toISOString().replace(/[:.]/g,'-'), filename = `stampa-${stamp}.pdf`;
  await store.atomic(path.join('outputs',filename), bytes);
  const report = { profile: p.geometry.bleedMode==='kdp'?'misure-kdp-senza-ricampionamento':'iniziale-senza-ricampionamento', schemaVersion: 3, pageBoxes, kdpSources:p.kdp?{checkedAt:KDP_CHECKED_AT,urls:KDP_SOURCES,rules:KDP_OUTPUT_RULES}:undefined, projectId: p.id, revision: p.revision, outputSha256: sha256(bytes), pages: reopened.getPageCount(), mediaPt: [width,height], trimMm: [g.trimWidthMm,g.trimHeightMm], bleedMm: g.bleedMm, font: { file: path.basename(fontPath), ...fontInfo.ref, sourceSha256: sha256(fontBytes), embedded: true, features: FONT_FEATURES }, images, check, limits: ['Non certificato KDP o PDF/X', 'RGB: ICC e CMYK non gestiti; non usare come prova colore', 'Nessuna sillabazione né flusso automatico', 'Immagini con orientamento EXIF o profili ICC: resa da verificare; originali conservati', 'Sfondo per riga rettangolare iniziale; raccordi e arrotondamento non implementati'] };
  await store.atomic(path.join('outputs',filename+'.json'), JSON.stringify(report,null,2));
  return { path: store.file('outputs',filename), report };
}
