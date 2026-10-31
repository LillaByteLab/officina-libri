import json,re,sys
from pathlib import Path
import pymupdf
folder=Path(sys.argv[1]); report=json.loads((folder/'verifica.json').read_text(encoding='utf-8')); pdf=pymupdf.open(folder/'romanzo.pdf')
assert len(pdf)==report['pages']; w,h=[v*72/25.4 for v in report['trimMm']]
fonts=set();hyphens=0;blank=[]
for i,page in enumerate(pdf):
 assert abs(page.rect.width-w)<.02 and abs(page.rect.height-h)<.02
 assert abs(page.trimbox.width-w)<.02 and abs(page.bleedbox.height-h)<.02
 text=page.get_text();hyphens+=len(re.findall(r'[A-Za-zÀ-ÿ][-‐\u00ad]\s*\n',text))
 if re.fullmatch(r'\s*\d*\s*',text):blank.append(i+1)
 for f in page.get_fonts(full=True):
  fonts.add(f[3]);assert 'georgia' in f[3].lower(),f
  assert pdf.extract_font(f[0])[3],f
starts=report['sections'];toc=pdf.get_toc();assert len(toc)==len(starts)
for s,t in zip(starts,toc):
 assert s['page']%2==1 and s['page']==t[2],(s,t)
 assert t[1] in pdf[s['page']-1].get_text()
assert hyphens>20,hyphens
assert blank, 'Attesa almeno una bianca per inizio a destra'
for index in sorted(set([0,starts[0]['page']-1,starts[len(starts)//2]['page']-1,len(pdf)-1])):
 pdf[index].get_pixmap(matrix=pymupdf.Matrix(1.3,1.3)).save(folder/f'pagina-{index+1}.png')
result={'parser':'PyMuPDF','pages':len(pdf),'embeddedFonts':sorted(fonts),'hyphenatedLineEndings':hyphens,'chapterStarts':starts,'blankPages':blank,'bookmarks':toc,'allMediaTrimBleedBoxesVerified':True}
(folder/'verifica-indipendente.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in result.items() if k not in ['chapterStarts','bookmarks']}))
