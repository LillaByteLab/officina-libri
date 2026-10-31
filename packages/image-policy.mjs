// Politica iniziale prudente: bloccare i casi non ancora collaudati anziché
// perdere profili, profondità o orientamento durante l'export.
import {crc32} from 'node:zlib';
const intents=['Perceptual','RelativeColorimetric','Saturation','AbsoluteColorimetric'];
const srgbChromaticities=[31270,32900,64000,33000,30000,60000,15000,6000];
export function assertImagePolicy(bytes) {
  const fail = detail => { throw new Error(detail + ' Export iniziale non compatibile: nessuna conversione automatica. Conserva l’originale; occorre il futuro motore colore/immagini.'); };
  if (bytes[0]===137 && bytes.toString('ascii',1,4)==='PNG') {
    if(bytes.length<33||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')fail('PNG non valido.');
    if (bytes[24]!==8 || ![2,6].includes(bytes[25])) fail('PNG: sono collaudati soltanto RGB/RGBA a 8 bit per canale.');
    const tags=new Map();let seenData=false,ended=false;
    for(let offset=8;offset+12<=bytes.length;) {
      const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
      if(offset+length+12>bytes.length)fail('PNG troncato.');
      if(['iCCP','eXIf','cICP','mDCV','cLLI'].includes(type)) fail('PNG con profilo colore, HDR o metadati di orientamento non ancora gestiti.');
      if(['sRGB','gAMA','cHRM'].includes(type)){
        if(seenData||tags.has(type))fail('PNG con metadati colore duplicati o fuori ordine.');
        if(crc32(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length))fail('PNG con profilo colore/gamma corrotto (CRC).');
        tags.set(type,bytes.subarray(offset+8,offset+8+length));
      }
      if(type==='IDAT')seenData=true;
      offset+=length+12;
      if(type==='IEND'){if(length!==0||offset!==bytes.length)fail('PNG con terminazione non valida.');ended=true;break;}
    }
    if(!ended||!seenData)fail('PNG incompleto.');
    const srgb=tags.get('sRGB'),gamma=tags.get('gAMA'),chroma=tags.get('cHRM');
    if((gamma||chroma)&&!srgb)fail('PNG con profilo colore/gamma non accompagnato da dichiarazione sRGB.');
    if(srgb){
      if(srgb.length!==1||srgb[0]>3)fail('PNG con intento sRGB non valido.');
      if(gamma&&(gamma.length!==4||gamma.readUInt32BE(0)!==45455))fail('PNG con gamma incompatibile con sRGB.');
      if(chroma&&(chroma.length!==32||srgbChromaticities.some((v,i)=>chroma.readUInt32BE(i*4)!==v)))fail('PNG con cromaticità incompatibili con sRGB.');
      return {colorSpace:'sRGB',renderingIntent:intents[srgb[0]]};
    }
    return {colorSpace:'RGB senza profilo'};
  } else if(bytes[0]===255 && bytes[1]===216) {
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset]!==255)break;
      const marker=bytes[offset+1];if(marker===0xda||marker===0xd9)break;
      const length=bytes.readUInt16BE(offset+2);if(length<2)fail('JPEG non valido.');
      const segment=bytes.subarray(offset+4,offset+2+length);
      if((marker===0xe1&&segment.subarray(0,6).toString()==='Exif\0\0') || (marker===0xe2&&segment.subarray(0,11).toString()==='ICC_PROFILE')) fail('JPEG con EXIF o ICC non ancora gestito.');
      if([0xc0,0xc1,0xc2].includes(marker)&&segment[5]!==3)fail('JPEG: sono collaudati soltanto tre canali RGB.');
      offset+=length+2;
    }
  } else fail('Formato immagine non supportato.');
  return {colorSpace:'RGB senza profilo'};
}
