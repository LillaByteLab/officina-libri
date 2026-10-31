export function pageGeometry(g,index=0) {
  const b=g.bleedMm;
  const kdp=g.bleedMode==='kdp';
  const left=kdp?(index%2?b:0):b,right=kdp?(index%2?0:b):b;
  return {widthMm:g.trimWidthMm+left+right,heightMm:g.trimHeightMm+2*b,trimX:left,trimY:b,left,right,top:b,bottom:b};
}
export function safeInsets(project,index=0,plan) {
  const safe=project.geometry.safeMm;
  if(project.geometry.bleedMode!=='kdp'||!plan)return {left:safe,right:safe,top:safe,bottom:safe};
  const {inside,outside,top,bottom}=plan.safeFromTrimMm;
  return {left:Math.max(safe,index%2?outside:inside),right:Math.max(safe,index%2?inside:outside),top:Math.max(safe,top),bottom:Math.max(safe,bottom)};
}
