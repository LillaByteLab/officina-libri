# Verifiche della prima beta pubblica

Verificate il 31 ottobre 2026 sul pacchetto Windows ARM64 `0.0.17-beta.1`.

- 105/105 test Node di unità e integrazione superati su fixture sintetiche: modelli, Word con font/note/tabelle/revisioni, immagini, PDF/EPUB, percorso, backup e sincronizzazione simulata.
- Lint JavaScript/TypeScript e build superati.
- Pacchetto effettivo: 2065 file applicativi verificati; allowlist dei componenti, dipendenze native e architettura ARM64. Nessun formato editoriale, font commerciale o chiave distribuiti.
- Scansione dei sorgenti selezionati e dei file nel pacchetto: nessun riferimento personale noto o segreto riconosciuto. Controllo euristico, non certificazione universale.
- Primo avvio reale del pacchetto pubblico: archivio `officina-libri-public`, libreria vuota, nessuna configurazione OAuth e nessun account Google collegato. L’edizione personale usa identità e archivio separati.
- Prove UI sul pacchetto: Percorso del libro e persistenza, quattro revisioni, approvazioni per versione, ricerca/sostituzione, immagini reversibili e originali conservati. Motore romanzi, PDF effettivo, EPUB e EPUBCheck reale superati con strumenti esterni configurati solo per il collaudo.
- Audit npm delle dipendenze di produzione: zero vulnerabilità note nel risultato ricevuto. La toolchain di sviluppo segnala 18 avvisi moderati; non è stata aggiornata automaticamente con modifiche incompatibili.

I test richiedono strumenti e font installati legittimamente. Python usa le dipendenze di `requirements-qa.txt`. Java ed EPUBCheck vengono indicati da variabili d’ambiente per i collaudi completi; non sono distribuiti.

Non verificati in questa edizione: Windows Intel/AMD/x64, firma digitale, progetti reali grandi, stampa fisica e prova colore calibrata, audit assistivo completo, servizio Drive pubblico pronto all’uso senza configurazione, APK pubblica. La compatibilità di una fixture non garantisce importazione universale o idoneità KDP. Le prove cloud simulate non sono test reali di tutte le interruzioni o conflitti.

Il repository parte da una nuova cronologia contenente solo questa selezione pubblica; nessuna cronologia privata viene inviata. Gli output dei test, documenti e log locali restano esclusi.

## Correzioni editor — verifica sorgenti Windows x64, 1 novembre 2026

Su Windows 11 x64, Node 24.22.2 e Electron del lockfile:

- `npm test`: 105/105 test superati.
- `npm run lint` e `npm run build`: superati.
- `npm run test:desktop`: editor, backup/ripristino, PDF, KDP e due nuove regressioni superati.
- `node tests/templates-desktop.mjs`: modelli, persistenza, PDF e annullamento superati.
- Le nuove regressioni fallivano entrambe prima delle correzioni. Verificano il cambio verso un capitolo più corto senza perdere la bozza e l'assenza di spostamenti della pagina quando una freccia viene premuta in un dialogo modale; la scorciatoia continua a funzionare nell'editor.

Questa verifica riguarda l'app avviata dai sorgenti su x64, non l'installer ARM64 né un nuovo installer x64. Upscayl e collegamento a un account Google reale non sono inclusi nel collaudo delle correzioni.
