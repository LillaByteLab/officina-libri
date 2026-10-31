export type Box = { x:number; y:number; width:number; height:number };
export function moveBox(start:Box, dx:number, dy:number, pageWidth:number, pageHeight:number):Box;
export function resizeBox(start:Box, handle:string, dx:number, dy:number, pageWidth:number, pageHeight:number):Box;
