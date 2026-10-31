import sys, json
from pathlib import Path
import pymupdf as fitz
doc=fitz.open(sys.argv[1]); assert len(doc)==70
for p in doc:
    assert abs(p.mediabox.width-630)<.001
    assert abs(p.trimbox.width-612)<.001
    images=p.get_images(full=True); assert len(images)==1
    assert images[0][2:4]==(5201,640) and images[0][1]>0
last=doc[-1]; pix=last.get_pixmap(alpha=False)
# Punto all'interno del riquadro immagine ma nell'area alfa=0 della sorgente.
x=int(9+18*72/25.4+1); y=int(9+140*72/25.4+1)
assert pix.pixel(x,y)==(255,255,255), 'Rettangolo opaco spurio sulla pagina finale'
dest=Path(sys.argv[1]).parent/'pagina-70.png';pix.save(dest)
print(json.dumps({'alboPages':70,'allBoxesChecked':True,'allImageDimensionsChecked':True,'lastPageAlphaWhite':True,'render':str(dest)}))
