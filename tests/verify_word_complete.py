import sys,json
from pathlib import Path
import pymupdf
folder=Path(sys.argv[1]);pdf=pymupdf.open(folder/'romanzo.pdf');text='\n'.join(page.get_text() for page in pdf)
for term in ['felice','Nota a piè di pagina','Nota finale con','Cronologia della storia','Prima tappa','Il viaggio continua','Riga proposta']:
 assert term in text,(term,text)
assert 'triste' not in text
assert 'Commento editoriale' not in text
fonts=set()
for i,page in enumerate(pdf):
 for f in page.get_fonts(full=True):
  fonts.add(f[3]);assert pdf.extract_font(f[0])[3]
 page.get_pixmap(matrix=pymupdf.Matrix(1.4,1.4)).save(folder/f'note-tabelle-{i+1}.png')
result={'pages':len(pdf),'requiredContentsFound':True,'deletedTextAbsent':True,'editorialCommentsExcluded':True,'embeddedFonts':list(fonts)}
(folder/'verifica-note-tabelle.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
