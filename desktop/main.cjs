const { app, BrowserWindow, ipcMain, dialog, session, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
// Keep the development app's existing library/tools when the product name changes.
app.setPath('userData', path.join(app.getPath('appData'), 'officina-libri-public'));
if (process.platform === 'win32') app.setAppUserModelId('app.officinalibri.public');
let window, store, fontPath, catalog, lastBackupRoot, backupController, imageController, imageSource, imageResult, ebookController, ebook, ebookResult, novelController, novelResult, closing = false;
let driveSync;
const testRoot = process.env.OFFICINA_TEST_ROOT;
const mod = name => import(pathToFileURL(path.join(__dirname, '../packages', name+'.mjs')).href);
async function projectFont(ref){
  if(store&&ref?.sha256&&/^[a-f0-9]{64}$/.test(ref.sha256))for(const ext of ['.ttf','.otf']){const file=store.file('novel-fonts',ref.sha256+ext);try{await fs.access(file);const f=await (await mod('fonts')).readFont(file,ref);return {file,ref:f.ref};}catch(e){if(e.code!=='ENOENT')throw e;}}
  return catalog.resolve(ref);
}
async function choose(open) {
  if (testRoot) return testRoot;
  const r = await dialog.showOpenDialog(window, { title: open ? 'Apri cartella progetto' : 'Scegli cartella vuota del progetto', properties: ['openDirectory','createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}
async function chooseFolder(title) {
  if (testRoot) return path.join(testRoot,'..');
  const r = await dialog.showOpenDialog(window, { title, properties: ['openDirectory','createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}
async function recent(add) {
  const file = path.join(app.getPath('userData'), 'library.json');
  let list = []; try { list = JSON.parse(await fs.readFile(file,'utf8')); } catch {}
  if (add) { list = [add, ...list.filter(x=>x.path!==add.path)].slice(0,20); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,JSON.stringify(list,null,2)); }
  return list;
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Origine non consentita');
    try { return { ok: true, value: await fn(...args) }; } catch(e) { return { ok: false, error: e.message }; }
  });
}
async function document(p) { let binding;try{if(driveSync)binding=(await driveSync.settings()).books[store.root];}catch{}await recent({path:store.root,title:p.title,kind:p.kind,...(binding?{synced:true,projectId:p.id,syncAccount:binding.account,syncedAt:binding.lastSync}:{})}); return {project:p, root:store.root}; }
async function backupJob(action) {
  if(backupController)throw new Error('Un backup è già in corso.');
  backupController=new AbortController();
  try{return await action({signal:backupController.signal,onProgress:value=>window.webContents.send('backup-progress',value)});}
  finally{backupController=null;}
}
app.whenReady().then(async () => {
  const { ProjectStore } = await mod('storage');
  const journey=await mod('journey');
  handle('journeyLoad',()=>{if(!store)throw new Error('Apri prima un libro.');return journey.loadJourney(store);});
  handle('journeySave',value=>journey.saveJourney(store,value));
  handle('journeyApprove',value=>journey.approveJourney(store,value));
  handle('journeyReview',value=>journey.reviewJourney(store,value));
  handle('journeyArtifact',async kind=>{const file=testRoot?process.env.OFFICINA_TEST_ARTIFACT:(await dialog.showOpenDialog(window,{title:'Registra un file esterno senza modificarlo',properties:['openFile']})).filePaths[0];return file?journey.recordJourneyArtifact(store,{kind,path:file}):null;});
  handle('journeyDossier',async()=>{const file=await journey.exportJourneyDossier(store);if(!testRoot)shell.showItemInFolder(file);return file;});
  handle('journeyHistory',()=>journey.journeyHistory(store));
  handle('journeyRestore',(name,revision)=>journey.restoreJourney(store,name,revision));
  const { exportPdf, preflight } = await mod('pdf');
  const { FontCatalog } = await mod('fonts');
  const { createBackup, restoreBackup, verifyBackup } = await mod('backup');
  const {importCoverPdf,checkCover,exportCover,exportCoverGuide}=await mod('covers');
  const imageLab=await mod('image-lab');
  handle('imageStatus',()=>imageLab.engineStatus());
  handle('imageSelect',async()=>{
    if(imageController)throw new Error('Attendi o annulla il lavoro in corso.');
    const file=testRoot?path.join(testRoot,'..','lab-source','fixture.png'):(await dialog.showOpenDialog(window,{title:'Scegli immagine originale',properties:['openFile'],filters:[{name:'Immagini',extensions:['png','jpg','jpeg','webp']}]})).filePaths[0];
    if(!file)return null;const info=await imageLab.inspectImage(file);imageSource={file,sha256:info.sha256};return info;
  });
  handle('imageRun',async options=>{
    if(imageController)throw new Error('Un lavoro immagini è già in corso.');if(!imageSource)throw new Error('Scegli un originale.');
    imageController=new AbortController();imageResult=null;
    try{const destination=testRoot?path.join(testRoot,'..','lab-results'):await chooseFolder('Scegli output esterno alla cartella degli originali');if(!destination)return null;
      const result=await imageLab.processImage(imageSource.file,destination,imageSource.sha256,options,{signal:imageController.signal,onProgress:value=>window.webContents.send('image-progress',value)});imageResult=result;return result;
    }finally{imageController=null;}
  });
  handle('imageCancel',()=>{imageController?.abort();return null;});
  handle('imageReveal',async()=>{if(!imageResult)throw new Error('Nessun risultato verificato.');if(!testRoot)await shell.openPath(imageResult.folder);return imageResult.folder;});
  handle('imageImport',async()=>{if(!store||!imageResult)throw new Error('Apri un progetto e completa un risultato.');const bytes=await fs.readFile(imageResult.output.path);const {sha256}=await mod('storage');if(sha256(bytes)!==imageResult.output.sha256)throw new Error('Il risultato è cambiato: elabora nuovamente.');return store.importImage(imageResult.output.path);});
  // Nessun font viene distribuito. Il file deve essere installato legittimamente sul PC.
  fontPath = process.env.OFFICINA_FONT || path.join(process.env.WINDIR || 'C:\\Windows','Fonts','georgia.ttf');
  catalog = new FontCatalog([...new Set([path.dirname(fontPath),path.join(process.env.WINDIR || 'C:\\Windows','Fonts'),path.join(process.env.LOCALAPPDATA || '', 'Microsoft','Windows','Fonts')])],fontPath);
  if (testRoot) app.setPath('userData', path.join(testRoot,'..','electron-profile'));
  const epub=await mod('epub'),ebookTools=await mod('ebook-tools'),toolsConfig=path.join(app.getPath('userData'),'ebook-tools.json');
  const {DriveAuth}=await mod('drive-auth'),{DriveApi}=await mod('drive-api'),{DriveSync}=await mod('drive-sync');
  const secure={encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error('Protezione Windows non disponibile: nessun accesso Google salvato.');return safeStorage.encryptString(value);},decrypt:value=>safeStorage.decryptString(value)};
  const driveAuth=new DriveAuth(path.join(app.getPath('userData'),'drive-access.bin'),secure,url=>shell.openExternal(url)),driveApi=new DriveApi(driveAuth);
  driveSync=new DriveSync(app.getPath('userData'),driveApi);
  handle('driveStatus',()=>driveSync.status(store));
  handle('driveConfigure',async()=>{const file=testRoot?path.join(testRoot,'..','google-client.json'):(await dialog.showOpenDialog(window,{title:'Configurazione Google per Officina Libri — client App desktop',properties:['openFile'],filters:[{name:'Configurazione Google JSON',extensions:['json']}]})).filePaths[0];if(!file)return null;if((await fs.stat(file)).size>65536)throw new Error('Configurazione Google troppo grande.');return driveAuth.configure(JSON.parse(await fs.readFile(file,'utf8')));});
  handle('driveConnect',async()=>{await driveAuth.connect();await driveAuth.account(await driveApi.account());return driveSync.status(store);});
  handle('driveCancel',()=>driveAuth.cancel());
  handle('driveDisconnect',()=>driveAuth.disconnect());
  handle('driveLibrary',()=>driveSync.library());
  handle('driveHistory',async()=>store?driveSync.history((await store.read()).id):[]);
  handle('driveAutomatic',args=>{if(!store)throw new Error('Apri prima la copia del romanzo.');return driveSync.automatic(store,!!args?.enabled);});
  async function driveResult(result){const next=result.store;delete result.store;if(next){const changed=store?.root!==next.root;store=next;if(changed)result.document=await document(await store.read());}return result;}
  handle('driveOpen',async args=>driveResult(await driveSync.run(null,null,{remote:args.remote})));
  handle('driveSync',async args=>{if(!store)throw new Error('Apri prima il romanzo.');const editor=await window.webContents.executeJavaScript('({dirty:window.__officinaDirty === true,novel:window.__officinaNovelOpen === true})');if(editor.dirty){if(args?.automatic)return {action:'deferred'};throw new Error('Salva prima le modifiche.');}if(editor.novel&&!args?.automatic)throw new Error('Chiudi prima il pannello romanzo.');const p=await store.read();return driveResult(await driveSync.run(store,p.font?(await projectFont(p.font)).file:null,{...(args||{}),publishOnly:editor.novel}));});

  handle('ebookStatus',async()=>ebookTools.toolStatus(await ebookTools.loadTools(toolsConfig)));
  handle('ebookConfigure',async kind=>{
    if(!['java','epubcheck','previewer'].includes(kind))throw new Error('Strumento non riconosciuto.');
    const selected=(await dialog.showOpenDialog(window,{title:{java:'Scegli java.exe del tuo Java installato',epubcheck:'Scegli epubcheck.jar (conserva anche la sua cartella lib)',previewer:'Scegli Kindle Previewer ufficiale installato'}[kind],properties:['openFile'],filters:[{name:kind,extensions:kind==='epubcheck'?['jar']:['exe']}]})).filePaths[0];if(!selected)return null;
    if(kind==='epubcheck'&&path.basename(selected).toLowerCase()!=='epubcheck.jar')throw new Error('Scegli il file epubcheck.jar ufficiale.');if(kind==='java'&&path.basename(selected).toLowerCase()!=='java.exe')throw new Error('Scegli java.exe.');if(kind==='previewer'&&!/^kindle ?previewer( ?[34]|CLI)?\.exe$/i.test(path.basename(selected)))throw new Error('Scegli l’eseguibile Kindle Previewer ufficiale.');
    const tools=await ebookTools.loadTools(toolsConfig);tools[kind]=selected;await fs.mkdir(path.dirname(toolsConfig),{recursive:true});await fs.writeFile(toolsConfig,JSON.stringify(tools,null,2));return ebookTools.toolStatus(tools);
  });
  const summarize=()=>({...epub.bookSummary(ebook),path:ebook.file,result:ebookResult});
  handle('ebookCurrent',()=>ebook?summarize():null);
  const ebookJob=async action=>{if(ebookController)throw new Error('Un lavoro eBook è già in corso.');ebookController=new AbortController();try{return await action(ebookController.signal);}finally{ebookController=null;}};
  handle('ebookExport',async(p,options)=>ebookJob(async signal=>{
    if(!store)throw new Error('Apri e salva un progetto.');const disk=await store.read();if(disk.id!==p.id||disk.revision!==p.revision||JSON.stringify(disk)!==JSON.stringify(p))throw new Error('Salva il progetto prima di creare l’eBook.');
    const result=await epub.exportEpub(store,p,options,options.mode==='fixed'?(await projectFont(p.font)).file:null);if(signal.aborted)throw new Error('Creazione interrotta: il file generato resta nella cartella output, non verificato.');const next=await epub.openEpub(result.path);
    result.report.validation=await ebookTools.validateEpub(result.path,await ebookTools.loadTools(toolsConfig),path.dirname(result.path),{signal});await fs.writeFile(result.path+'.json',JSON.stringify(result.report,null,2));ebook=next;ebookResult=result;return summarize();
  }));
  handle('ebookOpen',async()=>ebookJob(async()=>{const file=testRoot?process.env.OFFICINA_TEST_EPUB:(await dialog.showOpenDialog(window,{title:'Apri EPUB per anteprima in sola lettura',properties:['openFile'],filters:[{name:'EPUB',extensions:['epub']}]})).filePaths[0];if(!file)return null;const next=await epub.openEpub(file);ebook=next;ebookResult=null;return summarize();}));
  handle('ebookChapter',index=>{if(!ebook)throw new Error('Apri un eBook.');return epub.previewChapter(ebook,index);});
  handle('ebookValidate',()=>ebookJob(async signal=>{if(!ebook)throw new Error('Apri un eBook.');if((await mod('storage')).sha256(await fs.readFile(ebook.file))!==ebook.sha256)throw new Error('L’eBook è cambiato: riaprilo.');const report=await ebookTools.validateEpub(ebook.file,await ebookTools.loadTools(toolsConfig),ebookResult?path.dirname(ebook.file):path.join(app.getPath('userData'),'ebook-checks'),{signal});if(ebookResult){ebookResult.report.validation=report;await fs.writeFile(ebookResult.path+'.json',JSON.stringify(ebookResult.report,null,2));}return report;}));
  handle('ebookCancel',()=>{ebookController?.abort();return null;});
  handle('ebookReveal',async()=>{if(!ebook)throw new Error('Apri un eBook.');if(!testRoot)shell.showItemInFolder(ebook.file);return ebook.file;});
  handle('ebookKindle',async()=>{if(!ebook)throw new Error('Apri un eBook.');if((await mod('storage')).sha256(await fs.readFile(ebook.file))!==ebook.sha256)throw new Error('L’eBook è cambiato: riaprilo.');return ebookTools.launchPreviewer(ebook.file,await ebookTools.loadTools(toolsConfig),{outputRoot:path.join(app.getPath('userData'),'kindle-previews')});});
  handle('ebookHelp',async()=>{if(!testRoot)await shell.openExternal('https://kdp.amazon.com/it_IT/help/topic/G202131170');return null;});
  const novel=await mod('novel');
  const portable=await mod('portable-project');
  handle('portableExport',async()=>{if(!store)throw new Error('Apri un romanzo.');const p=await store.read(),result=await portable.exportPortable(store,p.font?(await projectFont(p.font)).file:null);if(!testRoot)shell.showItemInFolder(result.path);return result;});
  handle('portableImport',async()=>{const file=testRoot?path.join(testRoot,'..','da-android.officinazip'):(await dialog.showOpenDialog(window,{title:'Importa una copia da Android',properties:['openFile'],filters:[{name:'Progetto Officina Libri',extensions:['officinazip','zip']}]})).filePaths[0];if(!file)return null;const parent=await chooseFolder('Destinazione della nuova copia da Android');if(!parent)return null;const result=await portable.importPortable(file,parent);store=new ProjectStore(result.root);return document(result.project);});
  const templates=await mod('book-templates'),templateFile=path.join(app.getPath('userData'),'book-templates.json');
  handle('templateList',async()=>({...(await templates.loadTemplateLibrary(templateFile)),builtin:templates.BUILTIN_TEMPLATES}));
  handle('templateSave',(value,revision)=>templates.saveTemplateVariant(templateFile,value,revision));
  handle('templatePlan',value=>templates.planTemplate(store,value,catalog));
  handle('templateApply',(value,token)=>templates.applyTemplate(store,value,token,catalog));
  const word=await mod('word-import');
  handle('novelImportWord',async()=>{if(!store)throw new Error('Apri un progetto Romanzo.');const file=testRoot?path.join(testRoot,'..','manoscritto.docx'):(await dialog.showOpenDialog(window,{title:'Importa una copia Word come nuova sezione, senza sostituire i capitoli',properties:['openFile'],filters:[{name:'Word DOCX (non DOC)',extensions:['docx']}]})).filePaths[0];return file?word.importWord(store,file,catalog):null;});
  handle('novelFontPayload',async fonts=>{const {NovelSchema}=novel,p=await store.read(),n=NovelSchema.parse({...novel.newNovel(p.id),fonts});const data=await word.novelResources(store,n);return data.fonts.map(f=>({key:f.ref.sha256,base64:Buffer.from(f.bytes).toString('base64')}));});
  handle('novelImage',async()=>{if(!store)throw new Error('Apri un progetto Romanzo.');const file=testRoot?path.join(testRoot,'..','illustrazione.png'):(await dialog.showOpenDialog(window,{title:'Aggiungi illustrazione originale al capitolo',properties:['openFile'],filters:[{name:'Originali PNG / JPEG',extensions:['png','jpg','jpeg']}]})).filePaths[0];return file?store.importImage(file):null;});
  handle('novelLoad',()=>{if(!store)throw new Error('Apri un progetto Romanzo.');return novel.loadNovel(store);});
  handle('novelPrintStatus',p=>store?novel.novelPrintStatus(store,p):{active:false,valid:false});
  handle('novelSave',value=>novel.saveNovel(store,value));
  handle('novelHistory',()=>novel.novelHistory(store));
  handle('novelRestore',(name,revision)=>novel.restoreNovel(store,name,revision));
  handle('novelImport',async()=>{const file=testRoot?path.join(testRoot,'..','manoscritto.txt'):(await dialog.showOpenDialog(window,{title:'Aggiungi un testo UTF-8 come nuova sezione',properties:['openFile'],filters:[{name:'Testo semplice UTF-8',extensions:['txt']}]})).filePaths[0];if(!file)return null;const stat=await fs.stat(file);if(stat.size>8_000_000)throw new Error('Limite import iniziale: 8 MB.');const text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file));return {...novel.novelSection(path.basename(file,path.extname(file)).slice(0,200)),text};});
  handle('novelRender',async()=>{if(novelController)throw new Error('Impaginazione già in corso');novelController=new AbortController();try{const p=await store.read(),n=await novel.loadNovel(store),digest=await journey.journeyDigest(store);novelResult=await novel.renderNovel(store,n,n.layout?store.file('novel-fonts',n.fonts[n.layout.font.sha256].file):(await projectFont(p.font)).file,{signal:novelController.signal});await journey.recordJourneyArtifact(store,{kind:'prova PDF',path:novelResult.pdf,digest,origin:'generato'});return {path:novelResult.pdf,report:novelResult.report};}finally{novelController=null;}});
  handle('novelCancel',()=>{novelController?.abort();return null;});
  handle('novelPage',index=>{if(!novelResult)throw new Error('Impagina prima il romanzo');return novel.novelPage(novelResult,index);});
  handle('novelPdf',async()=>{if(!novelResult)throw new Error('Impagina prima il romanzo');if(!testRoot)await shell.openPath(novelResult.pdf);return novelResult.pdf;});
  handle('novelEpub',()=>ebookJob(async signal=>{const n=await novel.loadNovel(store),result=await novel.novelEpub(store,n);result.report.validation=await ebookTools.validateEpub(result.path,await ebookTools.loadTools(toolsConfig),path.dirname(result.path),{signal});await fs.writeFile(result.path+'.json',JSON.stringify(result.report,null,2));ebook=await epub.openEpub(result.path);ebookResult=result;return summarize();}));
  session.defaultSession.webRequest.onBeforeRequest((details,callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') && !details.url.startsWith('devtools:') }));
  handle('library', () => recent());
  handle('create', async (title,kind,kdp) => { const root=await choose(false); if(!root) return null; const next=new ProjectStore(root); const initial=await catalog.resolve(); const p=await next.create(title,kind,initial.ref,kdp); store=next; return document(p); });
  handle('open', async root => { if(root && !(await recent()).some(x=>x.path===root)) throw new Error('Cartella non registrata'); root=root || await choose(true); if(!root)return null; const next=new ProjectStore(root); const p=await next.read(); store=next; return document(p); });
  handle('save', async p => { if(!store)throw new Error('Apri un progetto'); return store.save(p); });
  handle('importImage', async () => {
    if(!store)throw new Error('Apri un progetto');
    const selected=testRoot ? path.join(testRoot,'..','fixture.png') : (await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Immagini PNG e JPEG',extensions:['png','jpg','jpeg']}]})).filePaths[0];
    return selected ? store.importImage(selected) : null;
  });
  handle('asset', name => store.imageData(name));
  handle('assetInspect',async name=>{if(!(await store.read()).assets[name])throw new Error('Risorsa non presente.');const sharp=require('sharp');const {data,info}=await sharp(store.file('assets',name)).ensureAlpha().raw().toBuffer({resolveWithObject:true});return (await mod('page-tools')).inspectLineArt(data,info.width,info.height);});
  handle('assetExport',async name=>{const p=await store.read();if(!p.assets[name])throw new Error('Immagine non presente nel progetto.');const b=await fs.readFile(store.file('assets',name));if((await mod('storage')).sha256(b)!==p.assets[name].sha256)throw new Error('Originale non integro.');const file=testRoot?path.join(testRoot,'..','originale-'+name):(await dialog.showSaveDialog(window,{title:'Salva copia dell’immagine originale',defaultPath:'originale-'+name})).filePath;if(!file)return null;if(path.resolve(file)===path.resolve(store.file('assets',name)))throw new Error('Scegli una destinazione separata.');await fs.writeFile(file,b,{flag:'wx'});return file;});
  handle('fonts', () => catalog.list());
  handle('fontPayload', async ref => {const font=await projectFont(ref);return {ref:font.ref,base64:(await fs.readFile(font.file)).toString('base64')};});
  handle('preflight', async p => preflight(p,(await projectFont(p.font)).file));
  handle('export',async p=>{const digest=await journey.journeyDigest(store);const r=await exportPdf(store,p,(await projectFont(p.font)).file);await journey.recordJourneyArtifact(store,{kind:'prova PDF',path:r.path,digest,origin:'generato'});return r;});
  handle('coverImport',async(p,role)=>{if(!store)throw new Error('Apri un progetto');const source=testRoot?path.join(testRoot,'..',role==='template'?'template.pdf':'cover.pdf'):(await dialog.showOpenDialog(window,{title:role==='template'?'Importa modello PDF KDP per il rigido':'Importa PDF completo della copertina',properties:['openFile'],filters:[{name:'PDF',extensions:['pdf']}]})).filePaths[0];return source?importCoverPdf(store,await novel.novelCoverProject(store,p),source,role):null;});
  handle('coverCheck',async p=>checkCover(store,await novel.novelCoverProject(store,p)));
  handle('coverExport',async p=>exportCover(store,await novel.novelCoverProject(store,p)));
  handle('coverGuide',async p=>exportCoverGuide(store,await novel.novelCoverProject(store,p),(await projectFont(p.font)).file));
  handle('kdpHelp',async topic=>{const urls={calculator:'https://kdp.amazon.com/cover-calculator',trim:'https://kdp.amazon.com/it_IT/help/topic/GVBQ3CMEQW3W2VL6',paperback:'https://kdp.amazon.com/en_US/help/topic/G201953020',hardcover:'https://kdp.amazon.com/en_US/help/topic/GDTKFJPNQCBTMRV6',kindle:'https://kdp.amazon.com/it_IT/help/topic/G200645690'};if(!Object.hasOwn(urls,topic))throw new Error('Riferimento KDP non riconosciuto.');if(!testRoot)await shell.openExternal(urls[topic]);return null;});
  handle('backup', async () => {if(!store)throw new Error('Apri un progetto');const parent=await chooseFolder('Scegli la destinazione del backup');if(!parent)return null;const result=await backupJob(options=>createBackup(store,parent,options));lastBackupRoot=result.path;return result;});
  handle('verifyBackup', async () => {const root=testRoot?(lastBackupRoot||process.env.OFFICINA_TEST_BACKUP_SOURCE):await chooseFolder('Scegli la cartella del backup da verificare');if(!root)return null;const result=await backupJob(options=>verifyBackup(root,options));lastBackupRoot=root;return {...result.report,path:root,title:result.project.title};});
  handle('restoreBackup', async () => {const source=testRoot?(lastBackupRoot||process.env.OFFICINA_TEST_BACKUP_SOURCE):await chooseFolder('Scegli il backup verificato');if(!source)return null;const parent=await chooseFolder('Scegli dove creare il progetto ripristinato');if(!parent)return null;const result=await backupJob(options=>restoreBackup(source,parent,options));const next=new ProjectStore(result.path);const p=await next.read();store=next;return document(p);});
  handle('backupCancel',()=>{backupController?.abort();return null;});
  handle('snapshots', () => store.snapshots());
  handle('restore', name => store.restore(name));
  handle('confirmDiscard', async () => (await dialog.showMessageBox(window,{type:'question',buttons:['Resta qui','Scarta le modifiche'],defaultId:0,cancelId:0,message:'Ci sono modifiche non salvate. Vuoi scartarle?'})).response===1);
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 700, backgroundColor:'#f4f2ed', title:'Officina Libri · nome provvisorio', webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true} });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.on('will-prevent-unload', async e => { e.preventDefault(); });
  window.on('close',async e=>{
    if(closing)return;
    e.preventDefault();
    if(backupController||imageController||ebookController||novelController||driveSync?.running){await dialog.showMessageBox(window,{type:'info',message:'Lavoro in corso: attendi il termine oppure usa il pulsante Annulla.'});return;}
    const dirty=await window.webContents.executeJavaScript('window.__officinaDirty === true').catch(()=>true);
    if(dirty && (await dialog.showMessageBox(window,{type:'warning',buttons:['Resta qui','Chiudi senza salvare'],defaultId:0,cancelId:0,message:'Modifiche non salvate: attendi il salvataggio o salva prima di chiudere.'})).response!==1)return;
    closing=true; window.destroy();
  });
  await window.loadFile(path.join(__dirname,'../dist/index.html'));
});
app.on('window-all-closed',()=>app.quit());
