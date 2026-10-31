import json,sys
from pathlib import Path
import pymupdf
from PIL import Image
import io
folder=Path(sys.argv[1]); size=float(sys.argv[2]); baseline=float(sys.argv[3]); pdf=pymupdf.open(folder/'romanzo.pdf'); report=json.loads((folder/'verifica.json').read_text(encoding='utf-8'))
assert pdf.page_count==report['pages']
body=[];headers=[];labels=[];titles=[];folios=[];distances=[]
for page in pdf:
 spans=[]
 for block in page.get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   for span in line['spans']:
    spans.append(span)
    assert 'georgia' in span['font'].lower(),span
    if abs(span['size']-size)<.01:body.append(span)
    if span['origin'][1]<50:headers.append(span)
    if span['text'].startswith('CAPITOLO '):labels.append(span)
    if abs(span['size']-19)<.01:titles.append(span)
    if span['origin'][1]>600 and span['text'].isdigit():folios.append(span)
 for block in page.get_text('dict')['blocks']:
  lines=[line for line in block.get('lines',[]) if line['spans'] and all(abs(s['size']-size)<.01 for s in line['spans'])]
  for first,second in zip(lines,lines[1:]):
   d=second['spans'][0]['origin'][1]-first['spans'][0]['origin'][1]
   if 0<d<baseline+1:distances.append(d)
 for f in page.get_fonts(full=True):assert pdf.extract_font(f[0])[3]
assert body and labels and titles and headers and folios,([len(x) for x in [body,labels,titles,headers,folios]])
assert all(abs(s['size']-13)<.01 for s in labels)
assert all(abs(s['size']-9)<.01 for s in headers+folios)
assert all(s['origin'][1]>180 for s in labels),labels
assert distances and all(abs(d-baseline)<.05 for d in distances),distances[:20]
# Chapter title and number must be centered in the usable area.
for section in report['sections'][1:]:
 page=pdf[section['page']-1]; center=(20*72/25.4+page.rect.width-16*72/25.4)/2
 for block in page.get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   spans=line['spans']
   if any(abs(v['size']-19)<.01 or v['text'].startswith('CAPITOLO ') for v in spans):
    assert abs((line['bbox'][0]+line['bbox'][2])/2-center)<.1,line
for image in report['images']:
 expected=Image.open(folder.parent.parent/'assets'/image['asset']).convert('RGB')
 matches=[Image.open(io.BytesIO(pdf.extract_image(xref)['image'])).convert('RGB') for page in pdf for xref,*rest in page.get_images() if (pdf.extract_image(xref)['width'],pdf.extract_image(xref)['height'])==expected.size]
 assert any(im.tobytes()==expected.tobytes() for im in matches),'Pixel immagine cambiati'
chapter=report['sections'][1]['page'];assert chapter==3,report['sections']
assert '1' in pdf[chapter-1].get_text().splitlines()[-1:]
pdf[chapter-1].get_pixmap(matrix=pymupdf.Matrix(1.1,1.1)).save(folder/'apertura-capitolo.png')
result={'pages':len(pdf),'bodyPt':size,'baselinePt':baseline,'measuredGaps':len(distances),'labels':len(labels),'headers':len(headers),'folios':len(folios),'fontEmbeddingVerified':True,'physicalFirstChapter':chapter}
(folder/'verifica-modelli.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
