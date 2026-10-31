import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import fontkit from '@pdf-lib/fontkit';
import { FontRefSchema } from './model.mjs';

export const FONT_FEATURES = { kern: false, liga: false, clig: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function inspectFont(bytes) {
  if (bytes.length>20*1024*1024) throw new Error('Font oltre il limite iniziale di 20 MB.');
  const f = fontkit.create(bytes);
  if (!f.familyName || !f.postscriptName || !f.characterSet) throw new Error('Raccolte e font senza identificazione non supportati.');
  if (f.variationAxes && Object.keys(f.variationAxes).length) throw new Error('Font variabile non ancora collaudato. Scegli un font statico.');
  const flags=f['OS/2']?.fsType;
  if (!flags || flags.noEmbedding || flags.bitmapOnly) throw new Error('Il font non dichiara diritti tecnici compatibili con questo export. Scegli un altro font.');
  return { ref: FontRefSchema.parse({sha256:hash(bytes),family:f.familyName,postscriptName:f.postscriptName}), subset: !flags.noSubsetting, font:f };
}
export async function readFont(file, expected) {
  const bytes=await fs.readFile(file), info=inspectFont(bytes);
  if(expected && (info.ref.sha256!==expected.sha256 || info.ref.postscriptName!==expected.postscriptName)) throw new Error('Il file del font è cambiato. Nessuna sostituzione automatica: scegli esplicitamente un font oppure reinstalla quello originale.');
  return {bytes,...info};
}
export class FontCatalog {
  constructor(directories, defaultFile) { this.directories=directories;this.defaultFile=defaultFile;this.entries=new Map();this.scanned=false; }
  async list() {
    if(!this.scanned) {
      for(const directory of this.directories) {
        let names=[];try{names=await fs.readdir(directory);}catch{continue;}
        for(const name of names.filter(n=>/\.(ttf|otf)$/i.test(n))) {
          const file=path.join(directory,name);
          try {const info=await readFont(file); if(![...'Città perché più'].every(c=>info.font.hasGlyphForCodePoint(c.codePointAt(0))))continue;
            this.entries.set(info.ref.sha256,{file,ref:info.ref,label:info.ref.family+' · '+info.ref.postscriptName});
          } catch { /* File non compatibili non vengono proposti. Nessun fallback. */ }
        }
      }
      this.scanned=true;
    }
    return [...this.entries.values()].map(({ref,label})=>({...ref,label})).sort((a,b)=>a.label.localeCompare(b.label,'it'));
  }
  async resolve(reference) {
    if(!reference) {
      try {const info=await readFont(this.defaultFile);this.entries.set(info.ref.sha256,{file:this.defaultFile,ref:info.ref,label:info.ref.family});return {file:this.defaultFile,...info};}
      catch {throw new Error('Font iniziale Georgia non disponibile. Apri il progetto e scegli un font installato dal pannello Proprietà.');}
    }
    const ref=FontRefSchema.parse(reference);
    try {const initial=await readFont(this.defaultFile,ref);return {file:this.defaultFile,...initial};} catch { /* Could be another installed font. */ }
    await this.list();const entry=this.entries.get(ref.sha256);
    if(!entry) throw new Error(`Font ${ref.family} mancante o diverso su questo PC. Scegli esplicitamente un altro font oppure installa il file originale. Il testo non viene sostituito.`);
    return {file:entry.file,...await readFont(entry.file,ref)};
  }
  async payload(reference) {const result=await this.resolve(reference);return {ref:result.ref,base64:result.bytes.toString('base64')};}
}
