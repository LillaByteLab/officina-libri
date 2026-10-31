import sharp from 'sharp';
// Solo la vista SVG: PDF e asset vengono generati e conservati separatamente.
export async function lightenNovelPreview(svg){
 const pattern=/data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)/g,cache=new Map();let at=0;const parts=[];
 for(const m of svg.matchAll(pattern)){
  parts.push(svg.slice(at,m.index));let replacement=cache.get(m[0]);
  if(!replacement){const bytes=Buffer.from(m[2],'base64'),metadata=await sharp(bytes).metadata();replacement=m[0];if(metadata.width>800||metadata.height>800){const preview=await sharp(bytes).resize({width:800,height:800,fit:'inside',withoutEnlargement:true}).png().toBuffer();replacement='data:image/png;base64,'+preview.toString('base64');}cache.set(m[0],replacement);}
  parts.push(replacement);at=m.index+m[0].length;
 }
 parts.push(svg.slice(at));return parts.join('');
}
