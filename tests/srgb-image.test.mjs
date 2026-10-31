import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {crc32} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {PDFDocument,PDFName} from 'pdf-lib';
import {assertImagePolicy} from '../packages/image-policy.mjs';
import {ProjectStore,sha256} from '../packages/storage.mjs';
import {exportPdf} from '../packages/pdf.mjs';
const base=path.resolve('output/srgb-'+Date.now());await fs.mkdir(base,{recursive:true});
const pixels=Buffer.alloc(96*64*4);for(let i=0;i<96*64;i++){pixels[i*4]=i%256;pixels[i*4+1]=(i*7)%256;pixels[i*4+2]=255-i%256;pixels[i*4+3]=i%3?255:0;}
const plain=await sharp(pixels,{raw:{width:96,height:64,channels:4}}).png().toBuffer();
const chunk=(name,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(name,4,'ascii');data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,data.length+8)),data.length+8);return out;};
const uint=value=>{const b=Buffer.alloc(4);b.writeUInt32BE(value);return b;},gamma=chunk('gAMA',uint(45455)),chroma=chunk('cHRM',Buffer.concat([31270,32900,64000,33000,30000,60000,15000,6000].map(uint))),tagged=(...tags)=>Buffer.concat([plain.subarray(0,33),...tags,plain.subarray(33)]);
test('PNG sRGB canonici: byte originali, RGBA e intento di rendering conservati nel PDF',async()=>{const store=new ProjectStore(path.join(base,'prova'));let p=await store.create('Prova PNG sRGB','albo');p.pages=[];for(let intent=0;intent<4;intent++){const bytes=tagged(chunk('sRGB',Buffer.from([intent])),gamma,chroma),file=path.join(base,'intent-'+intent+'.png');await fs.writeFile(file,bytes);assert.equal(assertImagePolicy(bytes).colorSpace,'sRGB');const a=await store.importImage(file);assert.equal(sha256(await fs.readFile(store.file('assets',a.name))),sha256(bytes));p.assets[a.name]=a.metadata;p.pages.push({id:crypto.randomUUID(),name:'Intento '+intent,role:'corpo',includeEpub:false,nodes:[{id:crypto.randomUUID(),type:'image',x:18,y:25,width:96,height:64,asset:a.name,alt:'PNG RGBA sRGB'}]});}p=await store.save(p);const pdf=await exportPdf(store,p,'C:/Windows/Fonts/georgia.ttf'),doc=await PDFDocument.load(await fs.readFile(pdf.path));for(const [i,page] of doc.getPages().entries()){const objects=page.node.Resources().lookup(PDFName.of('XObject'));const image=doc.context.lookup(objects.get(objects.keys()[0]));assert.equal(image.dict.get(PDFName.of('Intent')).toString(),'/'+['Perceptual','RelativeColorimetric','Saturation','AbsoluteColorimetric'][i]);}execFileSync('python',['tests/verify_srgb.py',pdf.path,path.join(base,'intent-0.png')],{stdio:'inherit'});});
test('PNG: gamma/cromaticita non standard, ICC, HDR ed EXIF restano bloccati',()=>{for(const bytes of [tagged(gamma),tagged(chunk('sRGB',Buffer.from([0])),chunk('gAMA',uint(50000))),tagged(chunk('sRGB',Buffer.from([0])),chunk('cHRM',Buffer.alloc(32))),tagged(chunk('sRGB',Buffer.from([0])),chunk('iCCP',Buffer.from('non gestito'))),tagged(chunk('eXIf',Buffer.from('non gestito'))),tagged(chunk('cICP',Buffer.from([1,1,1,1])))])assert.throws(()=>assertImagePolicy(bytes),/non compatibile/);});
test('PNG: metadati sRGB corrotti, duplicati o fuori ordine non diventano compatibili',()=>{const tag=chunk('sRGB',Buffer.from([0])),corrupt=Buffer.from(tag);corrupt[corrupt.length-1]^=1;for(const bytes of [tagged(corrupt),tagged(tag,tag),tagged(chunk('sRGB',Buffer.from([5]))),Buffer.concat([plain.subarray(0,-12),tag,plain.subarray(-12)]),plain.subarray(0,-4)])assert.throws(()=>assertImagePolicy(bytes),/non compatibile/);});
