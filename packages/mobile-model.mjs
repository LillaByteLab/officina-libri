import {parseProject} from './model.mjs';
import {NovelSchema,novelParagraphs} from './novel-model.mjs';
import {sectionText} from './novel-content.mjs';
export const TRANSFER_LIMIT=1024*1024*1024;
export function transferPath(name){return /^(manifest\.json|romanzo\.json|percorso\.json|assets\/[a-f0-9]{64}\.(png|jpg|pdf)|novel-fonts\/[a-f0-9]{64}\.(ttf|otf)|imports\/([a-f0-9]{64}\.docx|word-[a-f0-9]{64}\.json)|snapshots\/[a-zA-Z0-9-]+\.json)$/.test(name);}
export function mobileBook(value){const project=parseProject(value.project),novel=NovelSchema.parse(value.novel);if(project.kind!=='romanzo')throw new Error('Questa prima APK modifica i romanzi a flusso. Le pagine grafiche si preparano sul PC.');if(novel.projectId!==project.id)throw new Error('Romanzo e progetto non corrispondono.');return {...value,project,novel};}
export function editMobileParagraph(novel,sectionId,index,paragraph){const next=structuredClone(novel),s=next.sections.find(s=>s.id===sectionId);if(!s)throw new Error('Capitolo non trovato');if(!s.paragraphs)s.paragraphs=novelParagraphs(s);s.paragraphs[index]=paragraph;s.text=sectionText(s);return NovelSchema.parse(next);}
export function mobileAssetUrl(id,file){if(!/^[a-f0-9-]{36}$/.test(id)||!transferPath(file))throw new Error('Risorsa mobile non riconosciuta.');return 'https://appassets.androidplatform.net/books/'+id+'/'+file;}
