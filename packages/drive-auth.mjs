import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual,randomUUID} from 'node:crypto';

export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.appdata';
export const LOGIN_WAIT_MS=15*60*1000;
const AUTH='https://accounts.google.com/o/oauth2/v2/auth',TOKEN='https://oauth2.googleapis.com/token';
export function googleClient(value){
 const c=value?.installed;
 if(!c||!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(c.client_id)||typeof c.client_secret!=='string'||!c.client_secret.length||c.client_secret.length>512||![AUTH,'https://accounts.google.com/o/oauth2/auth'].includes(c.auth_uri)||![TOKEN,'https://accounts.google.com/o/oauth2/token'].includes(c.token_uri)||!/^[-a-z0-9]{4,100}$/.test(c.project_id||''))throw new Error('Scegli il JSON di un client OAuth Google di tipo App desktop.');
 return {clientId:c.client_id,clientSecret:c.client_secret,project:c.project_id};
}
export function authorization(clientId,redirect){
 const verifier=randomBytes(48).toString('base64url'),state=randomBytes(32).toString('base64url');
 const url=new URL(AUTH);url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:DRIVE_SCOPE,access_type:'offline',prompt:'consent',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state}).toString();
 return {url:url.href,verifier,state};
}
export function sameState(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export class DriveAuth {
 constructor(file,secure,open,fetcher=fetch){this.file=file;this.secure=secure;this.open=open;this.fetcher=fetcher;this.data=null;this.refreshing=null;}
 async load(){if(this.data)return this.data;try{this.data=JSON.parse(this.secure.decrypt(await fs.readFile(this.file)));}catch(e){if(e.code!=='ENOENT')throw new Error('Impossibile leggere la configurazione Google protetta di questo utente Windows.');this.data={};}return this.data;}
 async save(){const temp=this.file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(temp,this.secure.encrypt(JSON.stringify(this.data)),{flag:'wx'});await fs.rename(temp,this.file);}
 async configure(value){await this.load();if(this.data.tokens)throw new Error('Scollega prima l’account Google per cambiare configurazione.');this.data={client:googleClient(value)};await this.save();return this.status();}
 async status(){const d=await this.load();return {configured:!!d.client,connected:!!d.tokens?.refresh_token,cloudProject:d.client?.project||null,account:d.account?.label||null};}
 async account(value){await this.load();this.data.account=value;await this.save();}
 async disconnect(){this.cancel();await this.load();delete this.data.tokens;delete this.data.account;await this.save();}
 cancel(){this.abortLogin?.();}
 async tokenRequest(body){const r=await this.fetcher(TOKEN,{method:'POST',body:new URLSearchParams(body),redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Accesso Google non valido o revocato. Ricollega l’account.');const v=await r.json();if(typeof v.access_token!=='string'||!Number.isFinite(v.expires_in))throw new Error('Risposta di accesso Google incompleta.');if(v.scope&&!v.scope.split(' ').includes(DRIVE_SCOPE))throw new Error('L’accesso ai dati Officina Libri su Drive non è stato concesso.');return v;}
 async connect(){
  await this.load();if(!this.data.client)throw new Error('Importa prima la configurazione OAuth desktop di Officina Libri.');if(this.abortLogin)throw new Error('Un collegamento Google è già in corso.');
  const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,redirect=`http://127.0.0.1:${port}`,request=authorization(this.data.client.clientId,redirect);
  let timer;
  try{
   const code=await new Promise((resolve,reject)=>{
    this.abortLogin=()=>reject(new Error('Collegamento Google annullato.'));
    timer=setTimeout(()=>reject(new Error('Sono trascorsi 15 minuti senza completare l’accesso. Premi «Collega Google Drive» nel programma per aprire una nuova richiesta Google.')),LOGIN_WAIT_MS);
    server.on('request',(req,res)=>{
     res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'");
     let u;try{u=new URL(req.url||'/',redirect);}catch{res.writeHead(400);res.end('Richiesta non valida.');return;}
     if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`||u.origin!==`http://127.0.0.1:${port}`||u.pathname!=='/'||!sameState(u.searchParams.get('state'),request.state)){res.writeHead(400);res.end('Richiesta non valida.');return;}
     if(u.searchParams.has('error')){res.end('Accesso non concesso. Torna a Officina Libri.');reject(new Error('Accesso Google non concesso.'));return;}
     const c=u.searchParams.get('code');if(!c||c.length>4096){res.writeHead(400);res.end('Codice mancante.');return;}
     res.end('Puoi tornare a Officina Libri.');resolve(c);
    });
    Promise.resolve(this.open(request.url)).catch(reject);
   });
   const c=this.data.client,tokens=await this.tokenRequest({client_id:c.clientId,client_secret:c.clientSecret,code,code_verifier:request.verifier,redirect_uri:redirect,grant_type:'authorization_code'});
   if(!tokens.refresh_token)throw new Error('Google non ha concesso il rinnovo dell’accesso: ripeti il collegamento.');
   this.data.tokens={access_token:tokens.access_token,refresh_token:tokens.refresh_token,expiresAt:Date.now()+tokens.expires_in*1000};await this.save();return this.status();
  }finally{clearTimeout(timer);this.abortLogin=null;server.closeAllConnections();server.close();}
 }
 async token(){
  await this.load();const t=this.data.tokens;if(!t?.refresh_token)throw new Error('Collega prima Google Drive.');if(t.expiresAt>Date.now()+60000)return t.access_token;
  if(!this.refreshing)this.refreshing=(async()=>{const c=this.data.client,v=await this.tokenRequest({client_id:c.clientId,client_secret:c.clientSecret,refresh_token:t.refresh_token,grant_type:'refresh_token'});this.data.tokens={access_token:v.access_token,refresh_token:t.refresh_token,expiresAt:Date.now()+v.expires_in*1000};await this.save();return v.access_token;})().finally(()=>{this.refreshing=null;});return this.refreshing;
 }
}
