# Officina Libri — beta pubblica

Laboratorio editoriale locale in italiano per testi, romanzi illustrati e pagine grafiche. Palette lilla, corallo e petrolio.

## Installazione

Scarica l’installer dalla [pagina Releases](https://github.com/LillaByteLab/officina-libri/releases). Prima beta: **Windows ARM64**. Non è un pacchetto x64/Intel/AMD. L’EXE non è firmato digitalmente.

Il programma pubblico si chiama **Officina Libri Beta** e usa un archivio proprio `%APPDATA%/officina-libri-public`. Parte con libreria vuota e nessun account collegato. Una precedente installazione personale di Officina Libri rimane separata. Scegli esplicitamente quali progetti aprire; usa copie e backup verificati.

## Funzioni

- Editor grafico con font coerenti nel PDF, testi, immagini, crop e specchio reversibili, ricerca e sostituzione, conteggi e Annulla.
- Motore romanzi locale, capitoli, modelli tipografici duplicabili, import DOCX controllato con font, illustrazioni, note, tabelle e revisioni comuni.
- PDF ed EPUB, anteprima interna, verifiche di geometria e collegamento a EPUBCheck e Kindle Previewer installati separatamente.
- Percorso del libro: idea, canone, fonti, rilievi, quattro revisioni, approvazioni per versione, file con impronte e stati delle edizioni.
- Laboratorio immagini: ridimensionamento 2×/3×/4× e integrazione opzionale Upscayl locale. Originali e risultati separati.
- Backup verificato e ripristino in nuova cartella. Sincronizzazione Google Drive opzionale, con copie gestite, cronologia e conflitti espliciti.

La beta non garantisce importazione Word universale o idoneità KDP/PDF-X. CMYK/ICC avanzati, ritocco selettivo, pagine mastro e parità completa Android non sono disponibili. Verificare sempre il PDF reale prima di stampare o pubblicare. La pubblicazione su KDP non è automatica.

## Privacy e Google Drive

Non sono distribuiti libri, immagini personali, font commerciali, account, token o configurazioni Google. L’app non contiene un account condiviso. L’accesso Google resta disattivato fino all’importazione di una configurazione OAuth desktop dell’utente e al suo consenso. Lo scope richiesto è solo `drive.appdata`, distinto dai normali file del Drive. Credenziali protette localmente da Windows; nessuna cifratura end-to-end dei libri dichiarata. Il backup è distinto dalla sincronizzazione.

Chi vuole Drive deve creare il proprio progetto e client desktop Google, abilitare Drive API e autorizzare il proprio account. Questa beta pubblica non riutilizza configurazioni personali dello sviluppatore. I sorgenti Android sono sperimentali, con un identificativo distinto; **nessuna APK pubblica viene distribuita in questa release**. Per una build Android occorrono chiave di firma e registrazione OAuth proprie, mai da committare.

Georgia, altri font commerciali, Java, EPUBCheck, Kindle Previewer e Upscayl non sono inclusi: utilizzare installazioni e licenze legittime. La ricostruzione AI può alterare dettagli e richiede confronto con l’originale.

## Sviluppo e verifiche

Node.js 24 o successivo, npm, Windows per i collaudi PDF/font specifici. `npm ci`, `npm run lint`, `npm test`, `npm run build`. Per i test Python preparare un ambiente di QA e installare `requirements-qa.txt`. I test eBook completi richiedono `OFFICINA_JAVA` e `OFFICINA_EPUBCHECK` puntati agli strumenti ufficiali installati localmente; queste variabili non entrano nel pacchetto. I test generano fixture sintetiche e risultati sotto `output/`, esclusa da Git. Il font di prova è Georgia installato legittimamente in Windows; i percorsi possono essere configurati tramite variabili d’ambiente dove previsto.

Per il pacchetto: toolchain Node/Electron della stessa architettura, quindi `npm run build:windows`. Per Android usare `scripts/build-android.ps1 -ToolingRoot <cartella-toolchain>` con JDK/SDK/Gradle predisposti. Nessun SDK o chiave personale è incluso.

Prima della distribuzione: `node scripts/repo-check.mjs` e `node scripts/public-audit.mjs`. Leggere [VALIDATION.md](VALIDATION.md) e [SECURITY.md](SECURITY.md). Il codice è MIT; i componenti mantengono le rispettive licenze.
