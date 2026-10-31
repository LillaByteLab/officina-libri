import sys,json,hashlib
from pathlib import Path
import pymupdf
from PIL import Image
folder=Path(sys.argv[1]);fixture=json.loads((folder/'fixture.json').read_text());pdf=pymupdf.open(folder/'romanzo.pdf');fonts={};images={}
for p in pdf:
 for f in p.get_fonts(full=True):
  fonts[f[3]]=True
  assert pdf.extract_font(f[0])[3],f
 for info in p.get_images(full=True):
  xref=info[0];im=pdf.extract_image(xref);images[xref]=im
  if info[1]:
   rgb=Image.open(__import__('io').BytesIO(im['image'])).convert('RGBA');mask=Image.open(__import__('io').BytesIO(pdf.extract_image(info[1])['image'])).convert('L');rgb.putalpha(mask);im['rgba']=rgb
expected=['Georgia','Georgia-Bold','Georgia-Italic','ArialMT']
for f in expected:assert any(name.split('+')[-1]==f for name in fonts),(f,fonts)
jpg=Path(fixture['jpg']).read_bytes();assert any(im['image']==jpg for im in images.values()),'JPEG non identico nel PDF'
original=Image.open(fixture['png']).convert('RGBA');assert any((im.get('rgba') or Image.open(__import__('io').BytesIO(im['image'])).convert('RGBA')).tobytes()==original.tobytes() for im in images.values()),'Pixel PNG/alfa diversi nel PDF'
for i,p in enumerate(pdf):p.get_pixmap(matrix=pymupdf.Matrix(1,1)).save(folder/f'verifica-word-{i+1}.png')
result={'pages':len(pdf),'fonts':list(fonts),'allFontsEmbedded':True,'jpegBytesIdentical':True,'pngPixelsAndAlphaIdentical':True,'images':len(images)}
(folder/'verifica-word.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
