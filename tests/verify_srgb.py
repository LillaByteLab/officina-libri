import sys,json
from pathlib import Path
import pymupdf
from PIL import Image
pdf=pymupdf.open(sys.argv[1]);source=Image.open(sys.argv[2]).convert('RGBA');assert len(pdf)==4
for p in pdf:
 images=p.get_images(full=True);assert len(images)==1
 xref,mask,w,h=images[0][:4];assert (w,h)==source.size
 rgb=pymupdf.Pixmap(pdf,xref);rgba=Image.frombytes('RGB',(w,h),rgb.samples).convert('RGBA')
 assert mask
 alpha=pymupdf.Pixmap(pdf,mask);rgba.putalpha(Image.frombytes('L',(w,h),alpha.samples))
 assert rgba.tobytes()==source.tobytes(),'Pixel o alfa modificati'
 rect=p.get_image_rects(xref)[0];assert abs(rect.width-96*72/25.4)<.01
result={'pages':len(pdf),'allRgbaPixelsIdentical':True,'dimensionsAndPlacementVerified':True,'calibratedPrintColorProof':False}
Path(sys.argv[1]+'.srgb-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
