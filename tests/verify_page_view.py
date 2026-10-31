import json,sys
import fitz
from PIL import Image,ImageChops,ImageOps
doc=fitz.open(sys.argv[1]);original=Image.open(sys.argv[2]).convert('RGB');crop=original.crop((20,10,60,30))
assert len(doc)==4
for i,page in enumerate(doc):
    pix=page.get_pixmap(matrix=fitz.Matrix(20/72,20/72),alpha=False)
    rendered=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
    expected=crop.copy()
    if i&1: expected=ImageOps.mirror(expected)
    if i&2: expected=ImageOps.flip(expected)
    actual=rendered.crop((20,20,60,40))
    differences=ImageChops.difference(actual.crop((1,1,39,19)),expected.crop((1,1,39,19)))
    assert max(high for low,high in differences.getextrema())<=4,(i,differences.getextrema())
    assert rendered.getpixel((19,30))==(255,255,255)
    assert rendered.getpixel((60,30))==(255,255,255)
    images=page.get_images(full=True);assert len(images)==1
    assert images[0][2:4]==(80,40)
print(json.dumps({'pages':4,'cropAndBothMirrorsVerified':True,'originalPixelsEmbedded':True,'clippingVerified':True}))
