import { z } from 'zod';
const randomUUID = () => globalThis.crypto.randomUUID();

const dimension = z.number().finite().positive().max(2000);
const position = z.number().finite().min(-10).max(2000);
const textStyle = z.object({ sizePt: z.number().min(6).max(96), lineHeight: z.number().min(1).max(3), background: z.boolean() }).strict();
const imageView=z.object({crop:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).strict(),mirrorX:z.boolean(),mirrorY:z.boolean()}).strict().refine(v=>v.crop.x+v.crop.width<=1.0000001&&v.crop.y+v.crop.height<=1.0000001,'Ritaglio fuori immagine');
const node = z.discriminatedUnion('type', [
  z.object({ id: z.string().uuid(), type: z.literal('text'), x: position, y: position, width: dimension, height: dimension, text: z.string().max(200000), style: textStyle, flowId: z.string() }).strict(),
  z.object({ id: z.string().uuid(), type: z.literal('image'), x: position, y: position, width: dimension, height: dimension, asset: z.string().regex(/^[a-f0-9]{64}\.(png|jpg)$/), alt: z.string().max(5000),view:imageView.optional() }).strict()
]);
export const FontRefSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), family: z.string().min(1).max(200), postscriptName: z.string().min(1).max(200) }).strict();
const PdfSourceSchema=z.object({file:z.string().regex(/^[a-f0-9]{64}\.pdf$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive(),widthPt:z.number().positive(),heightPt:z.number().positive(),configuration:z.string().max(2000)}).strict();
const projectShape = z.object({
  schemaVersion: z.literal(3), cover:z.object({artwork:PdfSourceSchema.optional(),template:PdfSourceSchema.optional()}).strict().optional(), font: FontRefSchema.optional(), id: z.string().uuid(), title: z.string().min(1).max(200), author: z.string().max(200), language: z.literal('it'),
  kind: z.enum(['romanzo', 'albo', 'bilingue']), revision: z.number().int().min(0), updatedAt: z.string().datetime(),
  geometry: z.object({ trimWidthMm: dimension, trimHeightMm: dimension, bleedMm: z.number().min(0).max(10), bleedMode:z.enum(['symmetric','kdp']).optional(), safeMm: z.number().min(0).max(50) }).strict(),
  kdp: z.object({ market:z.enum(['standard','jp']).optional(),binding: z.enum(['paperback','hardcover']), formatId: z.string().min(1).max(30), customWidthIn: z.number().positive().max(8.5).optional(), customHeightIn: z.number().positive().max(11.69).optional(), ink: z.enum(['black','standard','premium']), paper: z.enum(['white','cream','groundwood']), bleed: z.boolean() }).strict().optional(),
  flows: z.array(z.object({ id: z.string(), language: z.string(), pairedFlowId: z.string().nullable() }).strict()),
  pages: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(200), role: z.enum(['iniziale', 'corpo', 'finale', 'bianca']), nodes: z.array(node).max(500), includeEpub: z.boolean() }).strict()).max(5000),
  assets: z.record(z.string().regex(/^[a-f0-9]{64}\.(png|jpg)$/), z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), mime: z.enum(['image/png', 'image/jpeg']), width: z.number().int().positive(), height: z.number().int().positive(), bytes: z.number().int().positive() }).strict()),
  status: z.object({ value: z.literal('bozza'), source: z.literal('creazione locale'), date: z.string().datetime() }).strict()
}).strict();
export const ProjectSchema = projectShape.superRefine((p, ctx) => {
  const ids = p.pages.map(x => x.id).concat(p.pages.flatMap(x => x.nodes.map(n => n.id)));
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Identificativi duplicati' });
  for (const page of p.pages) for (const n of page.nodes) {
    if (n.type === 'image' && !p.assets[n.asset]) ctx.addIssue({ code: 'custom', message: 'Risorsa immagine mancante' });
    if (n.type === 'text' && !p.flows.some(f => f.id === n.flowId)) ctx.addIssue({ code: 'custom', message: 'Flusso testo mancante' });
  }
  for (const [key, a] of Object.entries(p.assets)) if (!key.startsWith(a.sha256 + '.')) ctx.addIssue({ code: 'custom', message: 'Hash risorsa incoerente' });
  for(const asset of Object.values(p.cover||{}).filter(Boolean))if(asset.file!==asset.sha256+'.pdf')ctx.addIssue({code:'custom',message:'Hash PDF copertina incoerente'});
});
const LegacyProjectSchema = projectShape.omit({ font: true,cover:true }).extend({ schemaVersion: z.literal(1) }).strict();
const Legacy2Schema=projectShape.omit({cover:true}).extend({schemaVersion:z.literal(2)}).strict();
export function parseProject(value) {
  if (value?.schemaVersion === 1) return ProjectSchema.parse({ ...LegacyProjectSchema.parse(value), schemaVersion: 3 });
  if(value?.schemaVersion===2)return ProjectSchema.parse({...Legacy2Schema.parse(value),schemaVersion:3});
  return ProjectSchema.parse(value);
}
export const mmToPt = mm => mm * 72 / 25.4;
export const ptToMm = pt => pt * 25.4 / 72;
export function newText() {
  return { id: randomUUID(), type: 'text', x: 18, y: 25, width: 115, height: 100, text: 'Scrivi qui la tua storia. Ogni pagina è tua: puoi modificarla, spostarla o eliminarla.', style: { sizePt: 14, lineHeight: 1.4, background: false }, flowId: 'it' };
}
export function newPage(name = 'Nuova pagina') {
  return { id: randomUUID(), name, role: 'corpo', nodes: [newText()], includeEpub: true };
}
export function createProject(title, kind = 'romanzo') {
  const now = new Date().toISOString();
  return ProjectSchema.parse({ schemaVersion: 3, id: randomUUID(), title, author: '', language: 'it', kind, revision: 0, updatedAt: now,
    geometry: { trimWidthMm: kind === 'albo' ? 215.9 : 152.4, trimHeightMm: kind === 'albo' ? 215.9 : 228.6, bleedMm: 0, safeMm: 12 },
    flows: [{ id: 'it', language: 'it', pairedFlowId: null }], pages: [newPage('Prima pagina')], assets: {}, status: { value: 'bozza', source: 'creazione locale', date: now } });
}

// Identico wrapping per anteprima ed export: nessuna variazione automatica del corpo.
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? line + ' ' + word : word;
      if (line && measure(candidate) > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}
