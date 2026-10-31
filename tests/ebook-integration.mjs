import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ProjectStore,sha256} from '../packages/storage.mjs';
import {newPage} from '../packages/model.mjs';
import {exportEpub,openEpub} from '../packages/epub.mjs';
import {validateEpub,loadTools} from '../packages/ebook-tools.mjs';
import {zipSync,strToU8} from 'fflate';
const tools=await loadTools(path.join(process.env.APPDATA,'officina-libri-public','ebook-tools.json'));
const base=path.resolve('output/ebook-real-'+Date.now());await fs.mkdir(base,{recursive:true});const results=[];
for(const mode of ['reflowable','fixed']){
 const store=new ProjectStore(path.join(base,mode)),p=await store.create('Prova eBook — città & lettura',mode==='fixed'?'albo':'romanzo');p.author='Autrice sintetica';p.pages[0].name='Dedica modificabile';p.pages[0].nodes[0].text=mode==='fixed'?'Città, perché la storia continua.':'Il primo paragrafo è selezionabile.\n'+Array.from({length:80},(_,i)=>`Paragrafo ${i+1}. Una storia italiana sul viaggio di una piccola volpe e del suo amico.`).join('\n');
 const other=newPage('Colorabile escluso');other.includeEpub=false;p.pages.push(other,newPage('Capitolo secondo'));
 const r=await exportEpub(store,p,{mode},path.join(process.env.WINDIR,'Fonts','georgia.ttf'));const validation=await validateEpub(r.path,tools,path.join(base,'checks'));console.log(mode,JSON.stringify(validation));assert.equal(validation.status,'conforme');assert.equal(validation.errors,0);assert.equal(validation.checkedSha256,sha256(await fs.readFile(r.path)));r.report.validation=validation;await fs.writeFile(r.path+'.json',JSON.stringify(r.report,null,2));const book=await openEpub(r.path);assert.equal(book.chapters.length,2);results.push({mode,path:r.path,validation});
}
const valid=await openEpub(results[0].path),broken=path.join(base,'broken.epub'),files=Object.fromEntries(valid.files);files['EPUB/p1.xhtml']=strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Errore sintetico</title></head><body><img src="missing.png" alt="Immagine mancante"/></body></html>');files.mimetype=[files.mimetype,{level:0}];await fs.writeFile(broken,zipSync(files));const invalid=await validateEpub(broken,tools,path.join(base,'checks'));assert.equal(invalid.status,'errori');assert.ok(invalid.errors>0);results.push({mode:'invalid fixture',path:broken,validation:invalid});
await fs.writeFile(path.join(base,'result.json'),JSON.stringify({passed:true,results},null,2));await fs.writeFile('output/LATEST_EBOOK_REAL.txt',base);console.log('EPUBCheck reale PASS (2 validi, 1 errore rilevato): '+base);
