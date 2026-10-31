import sys,json
from pathlib import Path
import pymupdf as fitz
cases=json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
for case in cases:
    doc=fitz.open(case['file']);assert len(doc)==2
    for index,p in enumerate(doc):
        assert abs(p.mediabox.width-case['width'])<.002
        assert abs(p.mediabox.height-case['height'])<.002
        assert abs(p.trimbox.width-case['trimWidth'])<.002
        assert abs(p.trimbox.height-case['trimHeight'])<.002
        # PyMuPDF presenta la TrimBox con origine alto-sinistra.
        assert abs(p.trimbox.x0-(9 if case['bleed'] and index%2 else 0))<.002
        assert abs(p.trimbox.y0-(9 if case['bleed'] else 0))<.002
        assert abs(p.bleedbox.width-p.mediabox.width)<.002
        assert any(len(doc.extract_font(f[0])[3])>0 for f in p.get_fonts())
    if case['bleed'] and abs(case['trimWidth']-612)<.001 and abs(case['trimHeight']-612)<.001:
        doc[0].get_pixmap().save(Path(case['file']).parent/'kdp-pagina-dispari.png')
        doc[1].get_pixmap().save(Path(case['file']).parent/'kdp-pagina-pari.png')
print(json.dumps({'independentParser':'PyMuPDF','pdfFiles':len(cases),'pages':sum(2 for _ in cases),'allMediaTrimBleedBoxesVerified':True,'alternatingOuterBleedVerified':True}))
