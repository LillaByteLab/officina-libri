import json,sys
from pathlib import Path
import pymupdf as fitz

pdf=Path(sys.argv[1]);spec=json.loads(Path(sys.argv[2]).read_text(encoding='utf8'))
doc=fitz.open(pdf);page=doc[0]
fonts=page.get_fonts(full=True)
assert any(spec['font'] in f[3] for f in fonts),fonts
for f in fonts: assert doc.extract_font(f[0])[3], 'Programma font non incorporato'
lines=[]
for block in page.get_text('dict')['blocks']:
    for line in block.get('lines',[]):
        spans=line['spans'];text=''.join(s['text'] for s in spans)
        lines.append((text,spans[0]['origin'],spans[0]['bbox'][0],spans[-1]['bbox'][2]))
assert [row[0] for row in lines]==spec['lines'],(lines,spec)
max_error=0
for i,(_text,origin,left,right) in enumerate(lines):
    assert abs(origin[0]-spec['xPt'])<.02
    assert abs(origin[1]-(spec['baselinePt']+i*spec['linePt']))<.02
    error=abs((right-left)-spec['widths'][i]);max_error=max(error,max_error)
    assert error<.05,(i,error,right-left,spec['widths'][i])
page.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(pdf.parent/'font-verificato.png')
result={'font':spec['font'],'fontEmbedded':True,'lineTextAndOriginsVerified':True,'maxWidthErrorPt':max_error}
pdf.with_suffix('.font-verification.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result))
