import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const names=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const name of names) {
  if(/\.(png|jpe?g|pdf|epub|docx|ttf|otf|apk|exe|zip)$/i.test(name)||/(^|\/)(private|output|assets|snapshots|node_modules)\//.test(name)||/(^|\/)manifest\.json$/.test(name))throw new Error('File privato o binario non ammesso: '+name);
  const data=fs.readFileSync(name);if(data.length>1024*1024)throw new Error('File oltre 1 MB: '+name);
  if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|ya29\.[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{20,}|1\/\/[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(data.toString()))throw new Error('Possibile segreto: '+name);
}
console.log(`${names.length} file controllati: nessun formato privato vietato, file grande o segreto riconosciuto. Controllo euristico, non garanzia universale.`);
