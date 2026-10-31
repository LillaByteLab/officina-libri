import {NodeCompiler} from '@myriaddreamin/typst-ts-node-compiler';
import {PDFDocument} from 'pdf-lib';
import {readFont} from './fonts.mjs';
import {inspectFont} from './fonts.mjs';
import path from 'node:path';
import {sectionRuns} from './novel-content.mjs';
import {buildNovelSource} from './novel.mjs';
import {lightenNovelPreview} from './novel-preview.mjs';
process.once('message',async workerData=>{try{
 const {project,novel,fontFile,resources={fonts:[],assets:{}}}=workerData,start=performance.now(),font=await readFont(fontFile,project.font);if(!font.subset)throw new Error('Il font vieta il subsetting: scegli un font compatibile con il motore romanzi.');
 const fontMap=new Map(resources.fonts.map(f=>[f.ref.sha256,inspectFont(Buffer.from(f.bytes))])),checks=[{text:novel.sections.map(s=>s.title+' '+(s.images||[]).map(im=>im.caption).join(' ')).join(' '),font}];
 const faces=new Map();for(const info of [font,...fontMap.values()]){const key=JSON.stringify([info.ref.family.toLowerCase(),info.font['OS/2']?.usWeightClass||400,!!info.font['OS/2']?.fsSelection?.italic]);if(faces.has(key)&&faces.get(key)!==info.ref.sha256)throw new Error('Due file diversi dichiarano la stessa variante di font: '+info.ref.family+'. Uniforma esplicitamente i font prima di impaginare.');faces.set(key,info.ref.sha256);}
 for(const s of novel.sections)for(const r of sectionRuns(s)){checks.push({text:r.text,font:r.font?fontMap.get(r.font):font});if(r.formatRevision)checks.push({text:r.text,font:r.formatRevision.before.font?fontMap.get(r.formatRevision.before.font):font});}
 for(const check of checks){if(!check.font)throw new Error('Font del paragrafo mancante');const missing=[...new Set([...check.text].filter(c=>!['\r','\n','\t'].includes(c)&&!check.font.font.hasGlyphForCodePoint(c.codePointAt(0))))];if(missing.length)throw new Error('Caratteri assenti nel font '+check.font.ref.family+': '+missing.slice(0,40).join(' '));}
 const source=buildNovelSource(project,novel,font.ref.family),compiler=NodeCompiler.create({workspace:process.cwd(),fontArgs:[{fontBlobs:[font.bytes,...resources.fonts.map(f=>Buffer.from(f.bytes))]}]});for(const [name,bytes] of Object.entries(resources.assets))compiler.mapShadow(path.join(process.cwd(),'officina-resources',name),Buffer.from(bytes));const compiled=compiler.compile({mainFileContent:source});
 if(compiled.hasError())throw new Error(JSON.stringify(compiler.fetchDiagnostics(compiled.takeError())));
 const warnings=compiled.takeWarnings(),diagnostics=warnings?compiler.fetchDiagnostics(warnings):[];if(diagnostics.some(d=>/font|glyph/i.test(JSON.stringify(d))))throw new Error('Avviso tipografico: '+JSON.stringify(diagnostics));if(diagnostics.some(d=>/does not fit|overflow|not enough space|cannot fit|layout did not converge/i.test(JSON.stringify(d))))throw new Error('Impaginazione da correggere: '+JSON.stringify(diagnostics));
 const doc=compiled.result;if(doc.numOfPages>1000)throw new Error('Limite iniziale: oltre 1000 pagine.');const map=compiler.query(doc,{selector:'metadata',field:'value'}),bytes=compiler.pdf(doc),svg=await lightenNovelPreview(compiler.plainSvg(doc));if(svg.length>80_000_000)throw new Error('Anteprima oltre il limite iniziale di 80 MB.');
 const pdf=await PDFDocument.load(bytes),w=project.geometry.trimWidthMm*72/25.4,h=project.geometry.trimHeightMm*72/25.4;for(const page of pdf.getPages()){if(Math.abs(page.getWidth()-w)>.01||Math.abs(page.getHeight()-h)>.01)throw new Error('Misure pagina inattese');page.setTrimBox(0,0,w,h);page.setBleedBox(0,0,w,h);}
 const result={ok:true,pdf:await pdf.save(),svg,map,pages:doc.numOfPages,diagnostics,font:font.ref,durationMs:Math.round(performance.now()-start),rssBytes:process.memoryUsage().rss};compiler.evictCache(0);process.send(result,()=>process.exit(0));
}catch(e){process.send({ok:false,error:e.message},()=>process.exit(0));}});
