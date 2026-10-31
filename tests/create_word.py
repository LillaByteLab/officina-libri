import sys
from pathlib import Path
sys.path.insert(0,str(Path('tmp/word-tools').resolve()))
from docx import Document
from docx.shared import Mm,Pt
doc=Document()
doc.styles['Normal'].font.name='Georgia'
doc.styles['Normal'].font.size=Pt(12)
doc.add_paragraph('Un documento Word standard con stili ereditati e caratteri italiani: città, perché, più.')
p=doc.add_paragraph();p.add_run('Testo normale, ');p.add_run('grassetto').bold=True;p.add_run(' e corsivo.').italic=True
doc.add_picture(sys.argv[2],width=Mm(80))
doc.add_paragraph('Il testo prosegue dopo l’illustrazione.')
doc.save(sys.argv[1])
