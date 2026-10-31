import React,{useEffect,useRef} from 'react';
type Props={busy:boolean;hasProject:boolean;result:any;verified:any;progress:{phase:string;done:number;total:number}|null;onClose:()=>void;onCreate:()=>void;onVerify:()=>void;onRestore:()=>void;onCancel:()=>void};
export default function BackupDialog(p:Props) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  return <dialog ref={dialog} className="backup-dialog" aria-labelledby="backup-title" onCancel={e=>{e.preventDefault();if(!p.busy)p.onClose();}}>
    <div className="section-title"><h2 id="backup-title">Backup e ripristino</h2><button disabled={p.busy} onClick={p.onClose}>Chiudi backup</button></div>
    <p>Conserva una copia completa di progetto, immagini originali, cronologia e output nella destinazione che scegli.</p>
    <section><h3>1. Crea una copia</h3><p>Le modifiche vengono prima salvate. Sceglierai una cartella locale o esterna: verrà aggiunta una nuova sottocartella con data e identificativo.</p><button className="primary" disabled={p.busy||!p.hasProject} onClick={p.onCreate}>Scegli destinazione e crea copia</button><p><small>Nessuna copia precedente viene sovrascritta. I file dei font installati rimangono sul PC: sul dispositivo di ripristino occorre lo stesso font.</small></p></section>
    {p.result&&<div className="backup-success" role="status"><strong>Backup verificato</strong><p>{p.result.files} file · revisione {p.result.revision}</p><p className="path">{p.result.path}</p></div>}
    <section><h3>2. Controlla una copia esistente</h3><button disabled={p.busy} onClick={p.onVerify}>Scegli e verifica backup</button>{p.verified&&<div className="backup-success"><p>{p.verified.title} · revisione {p.verified.revision} · {p.verified.files.length} file verificati</p><p className="path">{p.verified.path}</p></div>}</section>
    <section><h3>3. Riprendi il lavoro da un backup</h3><button disabled={p.busy} onClick={p.onRestore}>Ripristina in una nuova cartella</button><p><small>Scegli il backup e poi la destinazione. La copia viene verificata nuovamente e aperta come nuovo progetto di lavoro. Il backup e il progetto precedente restano intatti.</small></p></section>
    {p.busy&&<div aria-live="polite"><p>{p.progress?`${p.progress.phase==='copia'?'Copia':'Verifica'}: ${p.progress.done} / ${p.progress.total} file`:'Preparazione…'}</p><progress value={p.progress?.done} max={p.progress?.total||1}/><button onClick={p.onCancel}>Annulla copia</button></div>}
  </dialog>;
}
