import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {_electron as electron} from 'playwright';

async function withEditor(run){
 const base=await fs.mkdtemp(path.resolve('output/editor-regression-'));
 const root=path.join(base,'book.officinalibri');
 const env={...process.env,OFFICINA_TEST_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:['.'],cwd:process.cwd(),env});
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByLabel('Titolo nuovo libro').fill('Regressione editor');
  await page.getByRole('button',{name:'Scegli cartella e crea',exact:true}).click();
  await page.getByLabel('Autosave',{exact:true}).uncheck();
  await run(page,root,errors);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
}
await fs.mkdir('output',{recursive:true});
test('Il cambio a un capitolo più corto conserva editor e modifiche non salvate',()=>withEditor(async(page,root,errors)=>{
 await page.evaluate(async()=>{
  const n=await window.officina.novelLoad(),first=n.sections[0];
  first.paragraphs=[1,2,3].map(i=>({runs:[{text:'Paragrafo '+i}]}));first.text='Paragrafo 1\nParagrafo 2\nParagrafo 3';
  n.sections.push({...first,id:crypto.randomUUID(),title:'Capitolo breve',paragraphs:[{runs:[{text:'Primo'}]},{runs:[{text:'Secondo'}]}],text:'Primo\nSecondo'});
  await window.officina.novelSave(n);
 });
 await page.getByRole('button',{name:'Romanzo a flusso',exact:true}).click();
 await page.getByLabel('Paragrafo formattato',{exact:true}).selectOption('2');
 await page.getByLabel('Tratto formattato 1',{exact:true}).fill('Modifica da conservare');
 await page.getByRole('button',{name:/2\. Capitolo breve/}).click();
 await page.getByLabel('Paragrafo formattato',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 await page.getByRole('button',{name:/1\. Capitolo 1/}).click();
 await page.getByLabel('Paragrafo formattato',{exact:true}).selectOption('2');
 assert.equal(await page.getByLabel('Tratto formattato 1',{exact:true}).inputValue(),'Modifica da conservare');
 await page.getByRole('button',{name:'Salva capitoli',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Capitoli salvati'}).waitFor();
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'romanzo.json'))).sections[0].paragraphs[2].runs[0].text,'Modifica da conservare');
}));
test('Le frecce nei dialoghi non spostano il testo della pagina sottostante',()=>withEditor(async(page,root,errors)=>{
 await page.locator('.layers button').first().click();
 const before=Number(await page.getByLabel('X (mm)',{exact:true}).inputValue());
 await page.getByRole('button',{name:'Cerca e sostituisci',exact:true}).click();
 await page.getByRole('button',{name:'Chiudi ricerca',exact:true}).focus();
 await page.keyboard.press('ArrowRight');
 await page.getByRole('button',{name:'Chiudi ricerca',exact:true}).click();
 assert.equal(Number(await page.getByLabel('X (mm)',{exact:true}).inputValue()),before);
 await page.locator('.layers button').first().focus();await page.keyboard.press('ArrowRight');
 assert.equal(Number(await page.getByLabel('X (mm)',{exact:true}).inputValue()),before+0.5);
 await page.getByRole('button',{name:'Salva',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Salvato su disco'}).waitFor();
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'manifest.json'))).pages[0].nodes[0].x,before+0.5);
 assert.deepEqual(errors,[]);
}));
