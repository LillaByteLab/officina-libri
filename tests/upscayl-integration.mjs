import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {inspectImage,processImage,engineStatus} from '../packages/image-lab.mjs';
const root=path.resolve('output/upscayl-real-'+Date.now()),source=path.join(root,'source'),dest=path.join(root,'results');await fs.mkdir(source,{recursive:true});await fs.mkdir(dest);const file=path.join(source,'fixture-à.png');
const svg='<svg width="96" height="64"><rect width="96" height="64" fill="#b59bd9"/><circle cx="48" cy="32" r="22" fill="#ed7971"/><path d="M0 0L96 64M96 0L0 64" stroke="#155e70" stroke-width="2"/></svg>';
await sharp(Buffer.from(svg)).flatten({background:'#fff'}).removeAlpha().png().toFile(file);const info=await inspectImage(file);assert.equal(info.aiIssue,null);const engine=await engineStatus();assert.equal(engine.installed,true,'Motore locale non installato: test reale NON eseguito');const results=[];
for(const scale of [2,3,4]){console.log('Upscayl reale '+scale+'×');const result=await processImage(file,dest,info.sha256,{mode:'ai',scale,model:'upscayl-standard-4x',rotate:0,mirror:false,brightness:1},{onProgress:p=>console.log(p.phase)});assert.equal(result.output.width,96*scale);assert.equal(result.output.height,64*scale);const log=await fs.readFile(path.join(result.folder,'motore.log'),'utf8');assert.match(log,/Adreno|Radeon|GeForce|Intel|NVIDIA|AMD|Apple/i);results.push({scale,folder:result.folder,width:result.output.width,height:result.output.height,sourceUnchanged:result.originalUnchanged,log});}
await fs.writeFile(path.join(root,'result.json'),JSON.stringify({passed:true,engine,results},null,2));await fs.writeFile('output/LATEST_UPSCAYL.txt',root);console.log('PASS AI reale 2×/3×/4×: '+root);
