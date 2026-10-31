const q=JSON.stringify;
export function templateSectionSource(project,n,section){
 const s=n.layout.template.style,chapter=section.role==='capitolo',front=section.role==='iniziale',chapters=n.sections.filter(x=>x.role==='capitolo'),index=chapters.indexOf(section),book=s.headerText||project.title;
 const clean=section.title.replace(/^capitolo\s+\d+\s*[:—–-]\s*/iu,'');
 const label=s.headerMode==='book'?q(book):s.headerMode==='chapter'?q(clean):`if calc.odd(here().page()) { ${q(clean)} } else { ${q(book)} }`;
 const header=front||s.headerMode==='none'?'none':`context align(center, text(size:${s.headerSizePt}pt,style:${q(s.headerItalic?'italic':'normal')},${label}))`;
 const footer=front||!n.settings.pageNumbers?'none':`context align(center, text(size:${s.folioSizePt}pt,counter(page).display("1")))`;
 const lines=[`#set page(numbering:none,header:${header},header-ascent:${s.headerGapMm}mm,footer:${footer})`];
 if(chapter&&index===0)lines.push(`#counter(page).update(${s.firstPageNumber})`);
 if(!chapter){lines.push(`#heading(level:1,outlined:${section.outline},bookmarked:true,${q(section.title)})`);return lines;}
 const title=`text(size:${n.settings.headingSizePt||s.headingSizePt}pt,weight:"regular",${s.smallCaps?`smallcaps(${q(clean)})`:q(clean)})`;
 const aligned=value=>s.centerHeading?`align(center,${value})`:value;
 lines.push(`#v(${s.chapterTopMm}mm,weak:false)`,`#block(width:100%,breakable:false)[#set par(justify:false,first-line-indent:0pt)\n#show heading: it => block(width:100%,above:0pt,below:0pt,${s.centerHeading?'align(center,it.body)':'it.body'})\n#${aligned(`text(size:${s.chapterLabelPt}pt,${q('CAPITOLO '+(index+1))})`)}\n#v(${s.labelGapMm}mm)\n#heading(level:1,outlined:${section.outline},bookmarked:true,${title})\n#v(${s.bodyGapMm}mm)]`);
 return lines;
}
