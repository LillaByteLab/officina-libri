import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),color=z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const RunStyleSchema=z.object({font:hash.optional(),sizePt:z.number().min(6).max(96).optional(),underline:z.boolean().optional(),color:color.optional(),highlight:color.optional(),vertical:z.enum(['super','sub']).optional(),strike:z.boolean().optional()}).strict();
const revisionFields={id:z.string().uuid(),wordId:z.string().max(200),author:z.string().max(500),date:z.string().max(100),decision:z.enum(['pending','accepted','rejected'])};
export const RevisionSchema=z.object({...revisionFields,kind:z.enum(['insert','delete'])}).strict();
export const FormatRevisionSchema=z.object({...revisionFields,kind:z.literal('format'),before:RunStyleSchema}).strict();
export const ContentRunSchema=RunStyleSchema.extend({text:z.string().max(200000),image:z.object({asset:z.string().regex(/^[a-f0-9]{64}\.(png|jpg)$/),widthMm:z.number().min(5).max(500),alt:z.string().max(5000)}).strict().optional(),noteId:z.string().uuid().optional(),comments:z.array(z.string().max(200)).max(500).optional(),revision:RevisionSchema.optional(),formatRevision:FormatRevisionSchema.optional()}).strict();
export const ParagraphStyleSchema=z.object({align:z.enum(['left','right','center','justify']).optional(),beforePt:z.number().min(0).max(200).optional(),afterPt:z.number().min(0).max(200).optional(),leftMm:z.number().min(0).max(100).optional(),rightMm:z.number().min(0).max(100).optional(),firstLineMm:z.number().min(-100).max(100).optional()}).strict();
const border=z.object({color,pt:z.number().min(0).max(12)}).strict();
export const CellStyleSchema=z.object({fill:color.optional(),vertical:z.enum(['top','center','bottom']).optional(),borders:z.object({top:border.optional(),bottom:border.optional(),left:border.optional(),right:border.optional()}).strict().optional()}).strict();
export const ParagraphFormatRevisionSchema=z.object({...revisionFields,kind:z.literal('format'),before:ParagraphStyleSchema}).strict();
export const ContentParagraphSchema=z.lazy(()=>z.object({runs:z.array(ContentRunSchema).min(1).max(5000),style:ParagraphStyleSchema.optional(),revision:RevisionSchema.optional(),formatRevision:ParagraphFormatRevisionSchema.optional(),table:ContentTableSchema.optional()}).strict());
export const ContentTableSchema=z.object({columns:z.array(z.number().positive().max(1000)).min(1).max(50),headerRows:z.number().int().min(0).max(100),rows:z.array(z.object({revision:RevisionSchema.optional(),cells:z.array(z.object({column:z.number().int().min(0).max(49),colspan:z.number().int().min(1).max(50),rowspan:z.number().int().min(1).max(5000),paragraphs:z.array(ContentParagraphSchema).min(1).max(5000),style:CellStyleSchema.optional()}).strict()).max(50)}).strict()).min(1).max(5000),borders:z.object({outer:border.optional(),inner:border.optional(),top:border.optional(),bottom:border.optional(),left:border.optional(),right:border.optional(),insideH:border.optional(),insideV:border.optional()}).strict().optional()}).strict();
export const ContentNoteSchema=z.object({id:z.string().uuid(),wordId:z.string().max(200),kind:z.enum(['footnote','endnote']),paragraphs:z.array(ContentParagraphSchema).min(1).max(5000)}).strict();
export const ContentCommentSchema=z.object({id:z.string().max(200),author:z.string().max(500),date:z.string().max(100),paragraphs:z.array(ContentParagraphSchema).min(1).max(5000)}).strict();
export const ReviewIssueSchema=z.object({id:z.string().uuid(),message:z.string().max(2000),xml:z.string().max(2_000_000)}).strict();

export const paragraphText=p=>p.table?p.table.rows.map(row=>row.cells.map(c=>c.paragraphs.map(paragraphText).join('\n')).join('\t')).join('\n'):p.runs.map(r=>r.text).join('');
export const sectionText=s=>(s.paragraphs||[]).map(paragraphText).join('\n');
export function* contentRuns(paragraphs,depth=0){if(depth>8)throw new Error('Tabelle annidate oltre otto livelli.');for(const p of paragraphs||[]){yield* p.runs;if(p.table)for(const row of p.table.rows)for(const c of row.cells)yield* contentRuns(c.paragraphs,depth+1);}}
export function* sectionRuns(s){yield* contentRuns(s.paragraphs||[{runs:[{text:s.text}]}]);for(const note of s.notes||[])yield* contentRuns(note.paragraphs);for(const comment of s.comments||[])yield* contentRuns(comment.paragraphs);}
export function* revisionInstances(s){
 for(const r of sectionRuns(s))for(const change of [r.revision,r.formatRevision])if(change)yield change;
 function* blocks(ps){for(const p of ps||[]){if(p.revision)yield p.revision;if(p.formatRevision)yield p.formatRevision;if(p.table)for(const row of p.table.rows){if(row.revision)yield row.revision;for(const c of row.cells)yield* blocks(c.paragraphs);}}}
 yield* blocks(s.paragraphs);for(const note of s.notes||[])yield* blocks(note.paragraphs);for(const comment of s.comments||[])yield* blocks(comment.paragraphs);for(const im of s.images||[])if(im.revision)yield im.revision;
}
export function revisions(s){return [...new Map([...revisionInstances(s)].map(r=>[r.id,r])).values()];}
export function decideRevision(s,id,decision){if(!['pending','accepted','rejected'].includes(decision))throw new Error('Decisione non valida.');for(const r of revisionInstances(s))if(r.id===id)r.decision=decision;}
export const retained=revision=>!revision||(revision.kind==='insert'?revision.decision==='accepted':revision.decision==='rejected');
export function effectiveRun(r){if(!retained(r.revision))return null;return r.formatRevision?.decision==='rejected'?{text:r.text,noteId:r.noteId,...r.formatRevision.before}:r;}
export function assertReviewed(n){const pending=n.sections.flatMap(revisions).filter(r=>r.decision==='pending');if(pending.length)throw new Error(`${pending.length} revisioni Word da decidere. Apri Revisioni Word e scegli Accetta o Rifiuta prima dell’export; nessuna decisione automatica.`);const issues=n.sections.flatMap(s=>s.reviewIssues||[]);if(issues.length)throw new Error('Il Word contiene revisioni strutturali non ancora applicabili: '+issues.map(i=>i.message).join('; ')+'. Contenuti e XML conservati; export sospeso.');}

export function splitSectionAt(section,index,title='Nuovo capitolo'){
 if(!Number.isInteger(index)||index<=0||index>=section.paragraphs.length)throw new Error('Scegli un paragrafo dopo il primo per dividere il capitolo.');
 const allNotes=section.notes||[],allComments=section.comments||[],images=section.images||[],next={...structuredClone(section),id:crypto.randomUUID(),title,role:'capitolo',right:true,outline:true,paragraphs:section.paragraphs.splice(index)};
 next.images=images.filter(im=>im.afterParagraph>index).map(im=>({...im,afterParagraph:im.afterParagraph-index}));section.images=images.filter(im=>im.afterParagraph<=index);
 const references=paragraphs=>{const ids=new Set([...contentRuns(paragraphs)].map(r=>r.noteId).filter(Boolean));let previous=-1;while(previous!==ids.size){previous=ids.size;for(const note of allNotes.filter(n=>ids.has(n.id)))for(const r of contentRuns(note.paragraphs))if(r.noteId)ids.add(r.noteId);}return ids;},left=references(section.paragraphs),right=references(next.paragraphs);
 next.notes=structuredClone(allNotes.filter(note=>right.has(note.id)));section.notes=allNotes.filter(note=>left.has(note.id)||!right.has(note.id));
 const commentRefs=s=>new Set([...sectionRuns(s)].flatMap(r=>r.comments||[])),leftComments=commentRefs(section),rightComments=commentRefs(next);
 next.comments=structuredClone(allComments.filter(c=>rightComments.has(c.id)));section.comments=allComments.filter(c=>leftComments.has(c.id)||!rightComments.has(c.id));
 section.text=sectionText(section);next.text=sectionText(next);return next;
}

export function revisionText(section,id){const result=[];const visit=ps=>{for(const p of ps||[]){if(p.revision?.id===id||p.formatRevision?.id===id)result.push(paragraphText(p));else for(const r of p.runs)if(r.revision?.id===id||r.formatRevision?.id===id)result.push(r.text|| (r.image?'Illustrazione':''));if(p.table)for(const row of p.table.rows){if(row.revision?.id===id)result.push(row.cells.map(c=>c.paragraphs.map(paragraphText).join(' ')).join(' | '));for(const c of row.cells)visit(c.paragraphs);}}};visit(section.paragraphs);for(const note of section.notes||[])visit(note.paragraphs);return result.join('');}
