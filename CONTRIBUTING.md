# Contribuire

Usare branch piccoli e commit descrittivi. Installare con `npm ci`, `npx install-electron`; eseguire build, lint, test core e desktop prima di proporre modifiche. Le prove Python sono separate dal runtime.

Non inserire manoscritti, illustrazioni, export reali, font commerciali, credenziali o allegati privati. Usare fixture sintetiche generate da codice. Eseguire `node scripts/repo-check.mjs` sui file tracciati e ispezionare il diff: lo scanner è euristico.

Ogni dipendenza nuova richiede fonte upstream, versione, licenza e motivazione. Aggiornare lockfile, inventario licenze e ADR. Nessun motore copyleft, modello AI o binario esterno viene aggiunto al prodotto senza valutarne gli obblighi di distribuzione. Aggiornare ROADMAP e TEST_REPORT senza trasformare controlli parziali in PASS della milestone.
