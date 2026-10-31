import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectSchema, createProject, parseProject } from './model.mjs';
import { PDFDocument } from 'pdf-lib';
import { assertImagePolicy } from './image-policy.mjs';
import {applyKdp} from './kdp.mjs';
import {NovelSchema} from './novel-model.mjs';
import {JourneySchema} from './journey-model.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export class ProjectStore {
  constructor(root) { this.root = path.resolve(root); this.queue = Promise.resolve(); }
  file(...parts) { return path.join(this.root, ...parts); }
  async create(title, kind, font, kdp) {
    await fs.mkdir(this.root, { recursive: true });
    // Neppure una cartella non vuota viene trasformata in progetto di nascosto.
    if ((await fs.readdir(this.root)).length) throw new Error('Scegli una cartella vuota per il nuovo progetto.');
    await fs.mkdir(this.file('assets')); await fs.mkdir(this.file('snapshots')); await fs.mkdir(this.file('outputs'));
    const p = createProject(title, kind); if(font)p.font=font;
    if(kdp){Object.assign(p,applyKdp(p,kdp));const text=p.pages[0].nodes[0];text.width=Math.max(5,p.geometry.trimWidthMm-36);text.height=Math.min(100,p.geometry.trimHeightMm-50);}
    ProjectSchema.parse(p); await this.atomic('manifest.json', JSON.stringify(p, null, 2)); return p;
  }
  async atomic(name, content) {
    const temporary = this.file(name + '.' + randomUUID() + '.tmp');
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, this.file(name));
  }
  async read() {
    try { await fs.access(this.file('backup-incomplete.json')); throw new Error('Questa copia di backup è incompleta. Usa una copia verificata; la sorgente non è stata modificata.'); }
    catch(e) {if(e.code!=='ENOENT')throw e;}
    const p = parseProject(JSON.parse(await fs.readFile(this.file('manifest.json'), 'utf8')));
    for (const [name, a] of Object.entries(p.assets)) {
      const bytes = await fs.readFile(this.file('assets', name));
      if (sha256(bytes) !== a.sha256) throw new Error('Integrità immagine non valida: ' + name);
    }
    for(const asset of Object.values(p.cover||{}).filter(Boolean))if(sha256(await fs.readFile(this.file('assets',asset.file)))!==asset.sha256)throw new Error('Integrità PDF copertina o modello non valida.');
    let novel;try{novel=NovelSchema.parse(JSON.parse(await fs.readFile(this.file('romanzo.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(novel){if(novel.projectId!==p.id)throw new Error('I capitoli appartengono a un altro progetto.');for(const [name,a] of Object.entries(novel.assets||{}))if(sha256(await fs.readFile(this.file('assets',name)))!==a.sha256)throw new Error('Integrità immagine romanzo non valida: '+name);for(const f of Object.values(novel.fonts||{}))if(sha256(await fs.readFile(this.file('novel-fonts',f.file)))!==f.ref.sha256)throw new Error('Integrità font romanzo non valida: '+f.ref.family);}
    try{const raw=await fs.readFile(this.file('percorso.json'));if(raw.length>8*1024*1024)throw new Error('Percorso oltre 8 MiB.');const j=JourneySchema.parse(JSON.parse(raw));if(j.projectId!==p.id)throw new Error('Percorso di un altro libro.');}catch(e){if(e.code!=='ENOENT')throw e;}
    return p;
  }
  exclusive(action) {
    const operation = this.queue.catch(() => {}).then(async () => {
      let lock;
      try { lock = await fs.open(this.file('.officina-write.lock'), 'wx'); }
      catch (e) { if(e.code === 'EEXIST') throw new Error('Salvataggio occupato: un’altra istanza sta scrivendo oppure è rimasto un lock dopo un arresto. Consulta il README.'); throw e; }
      try {
        return await action();
      } finally { await lock.close(); await fs.unlink(this.file('.officina-write.lock')); }
    }); this.queue = operation; return operation;
  }
  save(project) {
    return this.exclusive(async () => {
      const p = ProjectSchema.parse(project), current = await this.read();
      if (p.id !== current.id || p.revision !== current.revision) throw new Error('Conflitto: progetto cambiato su disco. Riapri prima di salvare.');
      // Nuovi asset devono già esistere ed essere integri prima di aggiornare il manifest.
      for (const [name, asset] of Object.entries(p.assets)) if (sha256(await fs.readFile(this.file('assets', name))) !== asset.sha256) throw new Error('Asset corrotto');
      for(const asset of Object.values(p.cover||{}).filter(Boolean))if(sha256(await fs.readFile(this.file('assets',asset.file)))!==asset.sha256)throw new Error('PDF copertina o modello corrotto.');
      // Conserva i byte del vecchio schema: l'aggiornamento non elimina la via di ritorno.
      await this.atomic(path.join('snapshots', `${current.revision}-${randomUUID()}.json`), await fs.readFile(this.file('manifest.json')));
      p.revision++; p.updatedAt = new Date().toISOString();
      await this.atomic('manifest.json', JSON.stringify(p, null, 2)); return p;
    });
  }
  async importImage(source) {
    const bytes = await fs.readFile(source);
    if (bytes.length > 100 * 1024 * 1024) throw new Error('Limite iniziale: immagine oltre 100 MB.');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg = bytes[0] === 255 && bytes[1] === 216;
    if (!png && !jpg) throw new Error('In questa versione sono supportati PNG e JPEG.');
    assertImagePolicy(bytes);
    const doc = await PDFDocument.create();
    const image = png ? await doc.embedPng(bytes) : await doc.embedJpg(Uint8Array.from(bytes));
    const hash = sha256(bytes), name = hash + (png ? '.png' : '.jpg');
    // File immutabile: una risorsa esistente viene verificata, mai sovrascritta.
    try { await fs.writeFile(this.file('assets', name), bytes, { flag: 'wx' }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; if (sha256(await fs.readFile(this.file('assets', name))) !== hash) throw new Error('Asset esistente corrotto'); }
    return { name, metadata: { sha256: hash, mime: png ? 'image/png' : 'image/jpeg', width: image.width, height: image.height, bytes: bytes.length } };
  }
  async imageData(name) {
    if (!/^[a-f0-9]{64}\.(png|jpg)$/.test(name)) throw new Error('Nome risorsa non valido');
    const bytes = await fs.readFile(this.file('assets', name));
    if (sha256(bytes) !== name.split('.')[0]) throw new Error('Asset corrotto');
    return `data:image/${name.endsWith('.png') ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}`;
  }
  async snapshots() { return (await fs.readdir(this.file('snapshots'))).filter(n => /^\d+-[a-f0-9-]+\.json$/.test(n)).sort((a,b) => parseInt(b)-parseInt(a)); }
  async restore(name) {
    if (!(await this.snapshots()).includes(name)) throw new Error('Snapshot sconosciuto');
    const previous = parseProject(JSON.parse(await fs.readFile(this.file('snapshots', name), 'utf8')));
    const current = await this.read(); previous.revision = current.revision;
    return this.save(previous);
  }
}
