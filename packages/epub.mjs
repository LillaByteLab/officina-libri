import fs from 'node:fs/promises';
import path from 'node:path';
import {zipSync,strToU8} from 'fflate';
import yauzl from 'yauzl';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {randomUUID} from 'node:crypto';
import {retained} from './novel-content.mjs';
import {htmlContent} from './novel-render.mjs';
import {ProjectSchema} from './model.mjs';
import {sha256} from './storage.mjs';
import {preflight} from './pdf.mjs';
import {readFont} from './fonts.mjs';
import {imageView} from './page-tools.mjs';

export const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const utf=strToU8,px=mm=>Math.round(mm*96/25.4*1e6)/1e6;
const XHTML='http://www.w3.org/1999/xhtml';
function pageDocument(title,body,head=''){return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="it" xml:lang="it"><head><meta charset="UTF-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="book.css"/>${head}</head><body>${body}</body></html>`;}
function pageImage(n,fixed){const v=imageView(n),c=v.crop,frame=fixed?`position:absolute;left:${px(n.x)}px;top:${px(n.y)}px;width:${px(n.width)}px;height:${px(n.height)}px`:`position:relative;width:${px(n.width)}px;max-width:100%;aspect-ratio:${n.width}/${n.height}`;return `<div style="${frame};overflow:hidden"><div style="position:absolute;width:100%;height:100%;transform:scale(${v.mirrorX?-1:1},${v.mirrorY?-1:1})"><img src="images/${n.asset}" alt="${xml(n.alt)}" style="position:absolute;max-width:none;left:${-c.x/c.width*100}%;top:${-c.y/c.height*100}%;width:${100/c.width}%;height:${100/c.height}%"/></div></div>`;}
export async function exportEpub(store,project,options,fontPath,flow){
  const p=ProjectSchema.parse(project);if(!['reflowable','fixed'].includes(options?.mode))throw new Error('Scegli EPUB adattabile oppure a impaginazione fissa.');
  const included=p.pages.filter(pg=>pg.includeEpub);if(!included.length)throw new Error('Includi almeno una pagina nell’eBook.');
  if(options.mode==='reflowable'&&p.kind!=='romanzo'&&!options.acceptReflow)throw new Error('Il testo adattabile cambia la composizione dell’albo: conferma la scelta nel pannello.');
  const warnings=[],files={mimetype:[utf('application/epub+zip'),{level:0}],'META-INF/container.xml':utf('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')};
  if(!p.author.trim())warnings.push('Autrice/autore non compilato.');
  const used=new Set(included.flatMap(pg=>pg.nodes.filter(n=>n.type==='image').map(n=>n.asset))),images=[];let total=0;
  for(const name of used){const a=p.assets[name],bytes=await fs.readFile(store.file('assets',name));if(sha256(bytes)!==a.sha256)throw new Error('Immagine cambiata: '+name);total+=bytes.length;if(total>80*1024*1024)throw new Error('Limite iniziale eBook: asset complessivi oltre 80 MB. Nessuna riduzione automatica.');files['EPUB/images/'+name]=bytes;images.push({asset:name,sha256:a.sha256,width:a.width,height:a.height});}
  let check,fontInfo,fontName='book.ttf';
  if(options.mode==='fixed'){
    const selected={...p,pages:included};check=await preflight(selected,fontPath);const errors=check.issues.filter(x=>x.severity==='errore');if(errors.length)throw new Error(errors.map(x=>x.page+': '+x.message).join('\n'));
    fontInfo=await readFont(fontPath,p.font);fontName=path.extname(fontPath).toLowerCase()==='.otf'?'book.otf':'book.ttf';files['EPUB/fonts/'+fontName]=fontInfo.bytes;
  }else warnings.push('Ordine di lettura: ordine delle pagine e dei livelli nel progetto. I nomi pagina diventano titoli delle sezioni; posizione, sfondi e geometria di stampa non sono conservati nel testo adattabile.');
  const css=options.mode==='fixed'?`@font-face{font-family:OfficinaEbook;src:url('fonts/${fontName}')}html,body{margin:0;padding:0;width:${px(p.geometry.trimWidthMm)}px;height:${px(p.geometry.trimHeightMm)}px;background:#fff;color:#243a34;overflow:hidden}.text{position:absolute;font-family:OfficinaEbook;font-kerning:none;font-variant-ligatures:none;white-space:pre}.line{position:absolute;display:block;white-space:pre}.char{position:absolute}.image{position:absolute}.back{position:absolute;background:rgba(255,255,255,.6)}`:'html{color:#202020;background:#fff}body{font-family:serif;line-height:1.5;margin:1em}h1{font-size:1.5em;line-height:1.2}p{margin:0 0 .8em;text-indent:0}img{max-width:100%;height:auto}figure{margin:1em 0}figcaption{font-size:.85em}';
  const flowFonts=flow?.fonts||[];
  for(const f of flowFonts)files['EPUB/fonts/'+f.file]=f.bytes;
  const flowCss=flowFonts.map(f=>`@font-face{font-family:F${f.ref.sha256};src:url('fonts/${f.file}')} .f${f.ref.sha256}{font-family:F${f.ref.sha256};font-weight:normal;font-style:normal;font-synthesis:none}`).join('\n');
  files['EPUB/book.css']=utf(css+'\n'+flowCss);const mapping=[];
  for(const [i,pg] of included.entries()){
    const href=`p${i+1}.xhtml`;let body='';
    if(options.mode==='reflowable'){
      body=`<section epub:type="chapter"><h1>${xml(pg.name)}</h1>`+pg.nodes.map(n=>n.type==='text'?n.text.split(/\r?\n/).map(t=>t?`<p>${xml(t)}</p>`:'<p><br/></p>').join(''):`<figure>${n.view?pageImage(n,false):`<img src="images/${n.asset}" alt="${xml(n.alt)}"/>`}</figure>`).join('')+'</section>';
    }else{
      body=pg.nodes.map(n=>{
        if(n.type==='image')return pageImage(n,true);
        const l=check.layouts[n.id];return `<div class="text" style="left:${px(n.x)}px;top:${px(n.y)}px;width:${px(n.width)}px;height:${px(n.height)}px;font-size:${n.style.sizePt*96/72}px;line-height:${n.style.lineHeight}">`+l.lines.map((line,j)=>`${n.style.background?`<span class="back" style="left:-2.67px;top:${j*l.linePt*96/72}px;width:${l.widths[j]*96/72+5.34}px;height:${l.linePt*96/72}px"></span>`:''}<span class="line" style="top:${j*l.linePt*96/72}px">${[...line].map((c,k)=>`<span class="char" style="left:${l.positions[j][k]*96/72}px">${xml(c)}</span>`).join('')}</span>`).join('\n')+'</div>';
      }).join('');
    }
    if(flow?.sections?.has(pg.id)){
      const s=flow.sections.get(pg.id),content=htmlContent(s),pictures=after=>(s.images||[]).filter(im=>im.afterParagraph===after&&retained(im.revision)).map(im=>`<figure style="text-align:${im.align}"><img src="images/${im.asset}" alt="${xml(im.alt)}" style="width:${Math.round(im.widthMm/25.4*96)}px;max-width:100%;height:auto"/>${im.caption?`<figcaption>${xml(im.caption)}</figcaption>`:''}</figure>`).join('');
      body=`<section epub:type="chapter"><h1>${xml(pg.name)}</h1>`+pictures(0)+s.paragraphs.map((p,i)=>content.paragraph(p)+pictures(i+1)).join('')+content.notes()+'</section>';
    }
    files['EPUB/'+href]=utf(pageDocument(pg.name,body,options.mode==='fixed'?`<meta name="viewport" content="width=${px(p.geometry.trimWidthMm)}, height=${px(p.geometry.trimHeightMm)}"/>`:''));
    mapping.push({sourceId:pg.id,sourceName:pg.name,sourceIndex:p.pages.indexOf(pg),href});
    for(const n of pg.nodes)if(n.type==='image'&&!n.alt.trim())warnings.push(pg.name+': immagine senza testo alternativo.');
  }
  warnings.push('Copertina digitale non generata: preparare e verificare separatamente il fronte JPEG/TIFF richiesto da KDP.');
  const nav=pageDocument('Indice',`<nav epub:type="toc" id="toc"><h1>Indice</h1><ol>${mapping.map(m=>`<li><a href="${m.href}">${xml(m.sourceName)}</a></li>`).join('')}</ol></nav>`);files['EPUB/nav.xhtml']=utf(nav);
  const fixed=options.mode==='fixed';const manifest=`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/>`+mapping.map((m,i)=>`<item id="p${i}" href="${m.href}" media-type="application/xhtml+xml"/>`).join('')+[...used].map((a,i)=>`<item id="img${i}" href="images/${a}" media-type="${p.assets[a].mime}"/>`).join('')+flowFonts.map((f,i)=>`<item id="flowfont${i}" href="fonts/${f.file}" media-type="${f.file.endsWith('.otf')?'font/otf':'font/ttf'}"/>`).join('')+(fixed?`<item id="font" href="fonts/${fontName}" media-type="${fontName.endsWith('.otf')?'font/otf':'font/ttf'}"/>`:'');
  files['EPUB/package.opf']=utf(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" prefix="rendition: http://www.idpf.org/vocab/rendition/#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${p.id}</dc:identifier><dc:title>${xml(p.title)}</dc:title><dc:language>it</dc:language>${p.author.trim()?`<dc:creator>${xml(p.author)}</dc:creator>`:''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/,'Z')}</meta><meta property="rendition:layout">${fixed?'pre-paginated':'reflowable'}</meta>${fixed?'<meta property="rendition:spread">none</meta>':''}</metadata><manifest>${manifest}</manifest><spine page-progression-direction="ltr">${mapping.map((m,i)=>`<itemref idref="p${i}"/>`).join('')}</spine></package>`);
  const bytes=zipSync(files,{level:6});if(bytes.length>100*1024*1024)throw new Error('EPUB oltre 100 MB: nessuna compressione delle immagini automatica.');
  const filename=`ebook-${options.mode}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.epub`;await store.atomic(path.join('outputs',filename),bytes);
  const report={format:'EPUB 3',mode:options.mode,projectId:p.id,revision:p.revision,outputSha256:sha256(bytes),mapping,excluded:p.pages.filter(pg=>!pg.includeEpub).map(pg=>({id:pg.id,name:pg.name})),images,fonts:flowFonts.map(f=>({ref:f.ref,file:f.file,embedded:true})),font:fontInfo?{sha256:fontInfo.ref.sha256,embedded:true}:null,warnings:[...new Set(warnings)],validation:{status:'non eseguita'},kindle:'Verifica nel Kindle Previewer ufficiale ancora necessaria',limits:['Nessuna certificazione KDP o accessibilità completa','Nessun DOCX/PDF importato o riconoscimento automatico di capitoli','Bilingue: flussi distinti ma lettura da verificare']};
  await store.atomic(path.join('outputs',filename+'.json'),JSON.stringify(report,null,2));return {path:store.file('outputs',filename),report};
}

export function parseXml(text){if(/<!ENTITY|<!DOCTYPE(?!\s+html\s*>)/i.test(text))throw new Error('Dichiarazioni XML esterne non consentite.');return new DOMParser({onError:(level,message)=>{if(level!=='warning')throw new Error('XML non valido: '+message);}}).parseFromString(text,'application/xml');}
const elements=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
export function localReference(base,href){if(typeof href!=='string'||/^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(href))throw new Error('Risorsa esterna non consentita.');const decoded=decodeURIComponent(href.split('#')[0]);if(/[\\\0]/.test(decoded)||decoded.startsWith('/'))throw new Error('Percorso risorsa non valido.');const name=path.posix.normalize(path.posix.join(path.posix.dirname(base),decoded));if(name==='..'||name.startsWith('../'))throw new Error('Risorsa fuori dal pacchetto.');return name;}
export async function openEpub(file){
  const stat=await fs.stat(file);if(stat.size>100*1024*1024)throw new Error('Anteprima iniziale: EPUB fino a 100 MB.');
  const zip=await yauzl.openPromise(file,{lazyEntries:true,validateEntrySizes:true}),files=new Map();let total=0,count=0;
  try{for await(const entry of zip.eachEntry()){
    const name=entry.fileName;if(++count>5000||entry.uncompressedSize>100*1024*1024||(total+=entry.uncompressedSize)>200*1024*1024)throw new Error('Pacchetto EPUB troppo grande.');
    if(name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').includes('..')||files.has(name))throw new Error('Nome ZIP ambiguo o non consentito.');if(name.endsWith('/'))continue;if(entry.isEncrypted())throw new Error('EPUB cifrato/DRM non supportato.');
    const stream=await zip.openReadStreamPromise(entry),parts=[];let actual=0;for await(const chunk of stream){actual+=chunk.length;if(actual>entry.uncompressedSize||actual>100*1024*1024){stream.destroy();throw new Error('Dimensioni ZIP incoerenti.');}parts.push(chunk);}files.set(name,Buffer.concat(parts));
  }}finally{zip.close();}
  if(files.get('mimetype')?.toString()!=='application/epub+zip')throw new Error('Non è un EPUB riconosciuto.');
  const text=name=>{const bytes=files.get(name);if(!bytes)throw new Error('Risorsa EPUB mancante: '+name);if(bytes.length>8*1024*1024)throw new Error('Documento XML oltre 8 MB.');return bytes.toString('utf8');};
  const container=parseXml(text('META-INF/container.xml')),opfName=elements(container,'rootfile')[0]?.getAttribute('full-path');if(!opfName)throw new Error('Package EPUB mancante.');const packageName=localReference('root',opfName),opf=parseXml(text(packageName));
  if(files.has('META-INF/encryption.xml'))throw new Error('EPUB con cifratura o font offuscati: anteprima non ancora supportata. Usa Kindle Previewer.');
  const manifest=new Map(elements(opf,'item').map(n=>[n.getAttribute('id'),{href:localReference(packageName,n.getAttribute('href')),mime:n.getAttribute('media-type'),properties:n.getAttribute('properties')||''}]));
  const globalFixed=elements(opf,'meta').some(n=>n.getAttribute('property')==='rendition:layout'&&n.textContent.trim()==='pre-paginated');
  const spine=elements(opf,'itemref').map(n=>{const item=manifest.get(n.getAttribute('idref'));if(!item||item.mime!=='application/xhtml+xml')throw new Error('Questa anteprima richiede capitoli XHTML. SVG autonomi, fallback e media overlay non ancora supportati.');const props=n.getAttribute('properties')||'';return {...item,fixed:props.includes('rendition:layout-reflowable')?false:props.includes('rendition:layout-pre-paginated')?true:globalFixed};});
  if(!spine.length||spine.length>1000)throw new Error('Spine EPUB vuota o oltre 1000 sezioni.');
  let toc=[];const nav=[...manifest.values()].find(n=>n.properties.split(/\s+/).includes('nav'));
  if(nav){const doc=parseXml(text(nav.href)),tocNav=elements(doc,'nav').find(n=>(n.getAttribute('epub:type')||'').split(/\s+/).includes('toc'));if(tocNav)toc=elements(tocNav,'a').map(n=>{try{return {label:n.textContent.trim(),href:localReference(nav.href,n.getAttribute('href'))};}catch{return null;}}).filter(Boolean);}
  const chapters=spine.map((item,index)=>{const doc=parseXml(text(item.href)),title=toc.find(n=>n.href===item.href)?.label||elements(doc,'title')[0]?.textContent||'Sezione '+(index+1);const viewport=elements(doc,'meta').find(n=>n.getAttribute('name')==='viewport')?.getAttribute('content')||'';const width=Number(/width\s*=\s*([\d.]+)/.exec(viewport)?.[1]),height=Number(/height\s*=\s*([\d.]+)/.exec(viewport)?.[1]);if(item.fixed&&(!(width>0&&width<=10000)||!(height>0&&height<=10000)))throw new Error('Viewport fisso assente o non supportato: '+title);return {title,href:item.href,fixed:item.fixed,width:item.fixed?width:null,height:item.fixed?height:null};});
  return {file,sha256:sha256(await fs.readFile(file)),title:elements(opf,'title')[0]?.textContent||path.basename(file),chapters,files,text,warnings:['Anteprima Chromium locale: non riproduce il motore Kindle.','Script, risorse esterne, audio/video e link interattivi disabilitati. DRM e font offuscati non supportati.']};
}
export function bookSummary(book){return {title:book.title,sha256:book.sha256,chapters:book.chapters,warnings:book.warnings};}
const SAFE_TAGS=new Set('html head body title meta style div span p br hr h1 h2 h3 h4 h5 h6 section article main header footer aside nav ol ul li dl dt dd a img figure figcaption strong b i em u s sub sup blockquote pre code table tbody thead tfoot tr td th caption colgroup col svg g path rect circle ellipse line polyline polygon text tspan defs clippath lineargradient radialgradient stop use image symbol'.split(' '));
export function previewChapter(book,index){
  if(!Number.isInteger(index)||!book.chapters[index])throw new Error('Sezione non valida.');const chapter=book.chapters[index],doc=parseXml(book.text(chapter.href));
  const resource=(base,href)=>{try{const name=localReference(base,href),bytes=book.files.get(name);if(!bytes)return '';const ext=path.posix.extname(name).toLowerCase(),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2'}[ext];return mime?'data:'+mime+';base64,'+bytes.toString('base64'):'';}catch{return '';}};
  const css=(text,base)=>text.replace(/@import[^;]*;?/gi,'').replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,(_m,a,b,c)=>{const ref=(a??b??c??'').trim();if(ref.startsWith('#'))return `url(${ref})`;return `url("${resource(base,ref)}")`;});
  const walk=node=>{for(const child of Array.from(node.childNodes||[])){
    if(child.nodeType===7||child.nodeType===10){node.removeChild(child);continue;}if(child.nodeType!==1)continue;const tag=child.localName.toLowerCase();
    if(tag==='link'&&child.getAttribute('rel')==='stylesheet'){try{const name=localReference(chapter.href,child.getAttribute('href'));const style=doc.createElementNS(XHTML,'style');style.textContent=css(book.text(name),name);node.replaceChild(style,child);}catch{node.removeChild(child);}continue;}
    if(!SAFE_TAGS.has(tag)||tag==='meta'){node.removeChild(child);continue;}
    for(const attr of Array.from(child.attributes)){
      const name=attr.name.toLowerCase();if(name.startsWith('on')||['srcset','formaction','action','target','srcdoc','xml:base'].includes(name)){child.removeAttribute(attr.name);continue;}
      if(name==='style')child.setAttribute(attr.name,css(attr.value,chapter.href));
      if(name==='src'||name==='href'||name==='xlink:href'){if(tag==='a'){child.removeAttribute(attr.name);}else if(attr.value.startsWith('#')){}else child.setAttribute(attr.name,resource(chapter.href,attr.value));}
    }
    if(tag==='style')child.textContent=css(child.textContent,chapter.href);else walk(child);
  }};walk(doc);
  const head=elements(doc,'head')[0];if(!head)throw new Error('Documento senza head.');const csp=doc.createElementNS(XHTML,'meta');csp.setAttribute('http-equiv','Content-Security-Policy');csp.setAttribute('content',"default-src 'none'; script-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'");head.insertBefore(csp,head.firstChild);const readerStyle=doc.createElementNS(XHTML,'style');readerStyle.setAttribute('id','officina-reader-style');head.appendChild(readerStyle);
  // srcdoc viene letto come HTML: le entità XML nei blocchi style non devono
  // cambiare selettori o URL. I segnaposto evitano la doppia codifica; '<'
  // rimane un escape CSS, quindi non può chiudere il tag style.
  const styles=elements(doc,'style').map((n,i)=>{const value=n.textContent,key='OFFICINA_STYLE_PAYLOAD_'+i+'_'+sha256(Buffer.from(value)).slice(0,12);n.textContent=key;return {key,value:value.replace(/</g,'\\3c ')};});
  let html=new XMLSerializer().serializeToString(doc).replace(/<([a-zA-Z][\w:.-]*)([^<>]*?)\/>/g,(all,tag,attrs)=>['meta','img','br','hr','col','link'].includes(tag.toLowerCase())?all:`<${tag}${attrs}></${tag}>`);for(const {key,value} of styles)html=html.replace(key,value);
  return {html:'<!doctype html>'+html,...chapter};
}
