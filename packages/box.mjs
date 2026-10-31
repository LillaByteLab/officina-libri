const clamp=(n,min,max)=>Math.max(min,Math.min(n,Math.max(min,max)));
const tenth=n=>Math.round(n*10)/10;
export function moveBox(start,dx,dy,pageWidth,pageHeight) {
  return {x:tenth(clamp(start.x+dx,0,pageWidth-start.width)),y:tenth(clamp(start.y+dy,0,pageHeight-start.height)),width:start.width,height:start.height};
}
export function resizeBox(start,handle,dx,dy,pageWidth,pageHeight) {
  let left=start.x,top=start.y,right=start.x+start.width,bottom=start.y+start.height;
  if(handle.includes('w'))left=clamp(left+dx,0,right-5);
  if(handle.includes('e'))right=clamp(right+dx,left+5,pageWidth);
  if(handle.includes('n'))top=clamp(top+dy,0,bottom-5);
  if(handle.includes('s'))bottom=clamp(bottom+dy,top+5,pageHeight);
  return {x:tenth(left),y:tenth(top),width:tenth(right-left),height:tenth(bottom-top)};
}
