import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {zipSync,strToU8} from 'fflate';
import {ProjectStore,sha256} from '../packages/storage.mjs';
import {newPage} from '../packages/model.mjs';
import {exportEpub,openEpub,previewChapter,parseXml,localReference} from '../packages/epub.mjs';
import {validateEpub} from '../packages/ebook-tools.mjs';
const font=path.join(process.env.WINDIR||'C:/Windows','Fonts','georgia.ttf');
const base=path.resolve('output/epub-test-'+Date.now());await fs.mkdir(base,{recursive:true});
async function fixture(kind='romanzo'){
 const store=new ProjectStore(path.join(base,randomUUID())),p=await store.create('Città & storie <inedite>',kind);p.author='Autrice sintetica';p.pages[0].name='Dedica libera';p.pages[0].nodes[0].text='Perché la città è più bella.\nSecondo paragrafo & finale.';
 const other=newPage('Colorabile escluso');other.includeEpub=false;other.nodes[0].text='SEGRETO_ESCLUSO';p.pages.push(other);const third=newPage('Capitolo finale');third.nodes[0].text='Ultima frase.';p.pages.push(third);
 const input=path.join(base,randomUUID()+'.png');await sharp({create:{width:5201,height:64,channels:4,background:{r:120,g:80,b:200,alpha:.7}}}).png().toFile(input);const a=await store.importImage(input);p.assets[a.name]=a.metadata;p.pages[0].nodes.push({id:randomUUID(),type:'image',asset:a.name,x:18,y:150,width:100,height:20,alt:'Illustrazione sintetica lilla'});return {store,p,a,input};
}
for(const mode of ['reflowable','fixed'])test(`EPUB ${mode}: archivio vero, testi, indice, esclusioni e immagini intatte`,async()=>{
 const {store,p,a,input}=await fixture(mode==='fixed'?'albo':'romanzo');if(mode==='fixed')p.pages[0].nodes[0].width=40;const result=await exportEpub(store,p,{mode},font),book=await openEpub(result.path),bytes=await fs.readFile(result.path);
 assert.equal(bytes.readUInt16LE(8),0);assert.equal(bytes.toString('ascii',30,38),'mimetype');assert.equal(bytes.readUInt16LE(28),0);
 assert.equal(book.chapters.length,2);assert.equal(book.title,p.title);assert.equal(book.chapters[0].title,'Dedica libera');assert.equal(book.chapters[0].fixed,mode==='fixed');assert.equal(sha256(book.files.get('EPUB/images/'+a.name)),sha256(await fs.readFile(input)));
 const text=book.text('EPUB/p1.xhtml'),doc=parseXml(text);assert.ok(doc.documentElement.textContent.includes('Perché'));if(mode==='fixed')assert.equal(doc.getElementsByTagName('body')[0].textContent.replace(/\s+/g,' ').trim(),p.pages[0].nodes[0].text.replace(/\s+/g,' ').trim());assert.ok(![...book.files.values()].some(b=>b.toString().includes('SEGRETO_ESCLUSO')));assert.equal(result.report.excluded.length,1);
 const preview=previewChapter(book,0);assert.ok(preview.html.includes('Content-Security-Policy'));assert.ok(preview.html.includes('data:image/png;base64,'));if(mode==='fixed'){assert.ok(book.files.has('EPUB/fonts/book.ttf'));assert.ok(preview.html.includes('data:font/ttf;base64,'));assert.equal(book.chapters[0].width,816);}else assert.ok(text.includes('<p>Secondo paragrafo &amp; finale.</p>'));
});
test('EPUB: nessuna pagina inclusa, overflow fisso e cambio composizione non confermato bloccati',async()=>{const {store,p}=await fixture('albo');await assert.rejects(exportEpub(store,p,{mode:'reflowable'},font),/conferma/);p.pages.forEach(pg=>pg.includeEpub=false);await assert.rejects(exportEpub(store,p,{mode:'fixed'},font),/almeno/);p.pages[0].includeEpub=true;p.pages[0].nodes[0].height=1;await assert.rejects(exportEpub(store,p,{mode:'fixed'},font),/overflow/);});
test('XML e risorse: entità esterne, traversal e URL di rete respinti',()=>{assert.throws(()=>parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///C:/Windows/win.ini">]><x>&e;</x>'));assert.throws(()=>localReference('EPUB/p.xhtml','../../escape'));assert.throws(()=>localReference('EPUB/p.xhtml','https://example.com'));assert.throws(()=>localReference('EPUB/p.xhtml','%2e%2e/%2e%2e/escape'));});
test('Anteprima importata rimuove script, eventi, iframe, collegamenti e risorse esterne',async()=>{const {store,p}=await fixture();const r=await exportEpub(store,p,{mode:'reflowable'},font),book=await openEpub(r.path);book.files.set('EPUB/p1.xhtml',Buffer.from('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Pericolo sintetico</title><style>@import "https://example.com/bad.css";p{background:url(file:///secret)}</style></head><body onload="alert(1)"><script>alert(1)</script><iframe src="file:///secret"></iframe><a href="javascript:alert(1)">Testo sicuro</a><img src="https://example.com/image.jpg" onerror="alert(1)"/><p>Contenuto leggibile</p></body></html>'));const html=previewChapter(book,0).html;assert.ok(!html.includes('<script'));assert.ok(!html.includes('<iframe'));assert.ok(!html.includes('onerror'));assert.ok(!html.includes('onload'));assert.ok(!html.includes('https://example.com'));assert.ok(!html.includes('file:///secret'));assert.ok(html.includes('Contenuto leggibile'));});
test('EPUB con nomi ZIP non sicuri rifiutato senza estrazione',async()=>{const file=path.join(base,'unsafe.epub');await fs.writeFile(file,zipSync({'mimetype':strToU8('application/epub+zip'),'../escape':strToU8('no')}));await assert.rejects(openEpub(file));});
test('Validatore assente non diventa un PASS',async()=>{const r=await validateEpub('non-letto.epub',{},base);assert.equal(r.status,'non disponibile');assert.equal(r.errors,undefined);});
