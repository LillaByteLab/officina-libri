import sys, hashlib, json
from pathlib import Path
import pymupdf as fitz
from PIL import Image

pdf, png, jpeg = map(Path, sys.argv[1:])
doc=fitz.open(pdf); assert len(doc)==1
p=doc[0]
assert abs(p.mediabox.width-450)<.001 and abs(p.mediabox.height-666)<.001
assert abs(p.trimbox.width-432)<.001 and abs(p.trimbox.height-648)<.001
assert abs(p.bleedbox.width-450)<.001
fonts=p.get_fonts(full=True)
assert any('Georgia' in f[3] for f in fonts), fonts
for f in fonts:
    assert len(doc.extract_font(f[0])[3])>0, 'Font non incorporato'
assert 'perché' in p.get_text()
images=p.get_images(full=True)
assert len(images)==2, images
found_png=found_jpg=False
for info in images:
    xref, mask, width, height=info[:4]
    assert (width,height)==(5201,640)
    pix=fitz.Pixmap(doc,xref)
    if mask:
        source=Image.open(png).convert('RGBA')
        rgb=Image.frombytes('RGB',(width,height),pix.samples)
        alpha=fitz.Pixmap(doc,mask)
        rgba=rgb.convert('RGBA');rgba.putalpha(Image.frombytes('L',(width,height),alpha.samples))
        # RGB dei pixel trasparenti rimane confrontato: nessun resampling/flatten.
        assert rgba.tobytes()==source.tobytes(), 'Matrice RGBA modificata'
        found_png=True
    else:
        assert doc.xref_stream_raw(xref)==jpeg.read_bytes(), 'JPEG ricodificato'
        assert pix.samples==Image.open(jpeg).convert('RGB').tobytes(), 'Pixel JPEG modificati'
        found_jpg=True
    rects=p.get_image_rects(xref)
    assert len(rects)==1
    assert abs(rects[0].width-115*72/25.4)<.01
assert found_png and found_jpg
image_path=pdf.parent/'render-verificato.png'
p.get_pixmap(matrix=fitz.Matrix(1.5,1.5), alpha=False).save(image_path)
result={'parser':'PyMuPDF','pages':len(doc),'mediaPt':list(p.mediabox),'trimPt':list(p.trimbox),'fontEmbedded':True,'pngRgbaExact':True,'jpegStreamExact':True,'jpegDecodedPixelsExact':True,'imagePositionWidthVerified':True,'render':str(image_path)}
pdf.with_suffix('.verification.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result,indent=2))
