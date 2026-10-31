// Local protocol fixture. No Google account, network, credentials or user files.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {sha256} from '../packages/storage.mjs';
export function googleDriveFixture(){
 const files=new Map(),sessions=new Map();let mediaReads=0,chunks=0;
 const json=(v,status=200,headers={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json',...headers}});
 async function fetcher(address,options={}){
  const u=new URL(address);assert.equal(u.origin,'https://www.googleapis.com');assert.equal(options.headers.Authorization,'Bearer synthetic-only');const method=options.method||'GET';
  if(u.pathname==='/drive/v3/about')return json({user:{permissionId:'test-http-user',emailAddress:'fixture@example.invalid'}});
  if(u.pathname==='/upload/drive/v3/files'&&method==='POST'){const metadata=JSON.parse(options.body),key=randomUUID();assert.deepEqual(metadata.parents,['appDataFolder']);assert.equal(metadata.mimeType,'application/octet-stream');sessions.set(key,{metadata,bytes:Number(options.headers['X-Upload-Content-Length']),parts:[],offset:0});return new Response('',{status:200,headers:{location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id='+key}});}
  if(u.pathname==='/upload/drive/v3/files'&&method==='PUT'){const s=sessions.get(u.searchParams.get('upload_id'));assert.ok(s);const b=Buffer.from(options.body);assert.equal(options.headers['Content-Length'],String(b.length));assert.equal(options.headers['Content-Range'],s.bytes?`bytes ${s.offset}-${s.offset+b.length-1}/${s.bytes}`:'bytes */0');s.parts.push(b);s.offset+=b.length;chunks++;if(s.offset<s.bytes)return new Response('',{status:308,headers:{range:'bytes=0-'+(s.offset-1)}});const data=Buffer.concat(s.parts);assert.equal(data.length,s.bytes);const id=randomUUID(),meta={id,name:s.metadata.name,size:String(data.length),sha256Checksum:sha256(data),appProperties:s.metadata.appProperties};files.set(id,{data,meta});return json(meta);}
  if(u.pathname==='/drive/v3/files'&&method==='GET'){const q=u.searchParams.get('q'),filters=[...q.matchAll(/key='([^']+)' and value='([^']+)'/g)];const selected=[...files.values()].filter(f=>filters.every(([,key,value])=>f.meta.appProperties[key]===value));return json({files:selected.map(f=>f.meta)});}
  const match=/^\/drive\/v3\/files\/([\w-]+)$/.exec(u.pathname);if(match&&method==='GET'&&u.searchParams.get('alt')==='media'){mediaReads++;assert.ok(files.has(match[1]));return new Response(files.get(match[1]).data);}
  throw new Error('Richiesta inattesa nel test: '+method+' '+u.pathname);
 }
 return {fetcher,files,get mediaReads(){return mediaReads;},get chunks(){return chunks;}};
}
