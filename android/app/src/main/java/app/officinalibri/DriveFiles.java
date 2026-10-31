package app.officinalibri;

import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Immutable cloud versions; all received books are separate private copies. */
public final class DriveFiles {
 public interface Transport {
  JSONObject account()throws Exception; JSONArray commits()throws Exception;
  String blob(File source,JSONObject record)throws Exception;
  String upload(File source,JSONObject record,JSONObject properties)throws Exception;
  void download(String blob,File target,JSONObject record)throws Exception;
 }
 private final MobileStore store; private final File root,cache,stateFile;
 public DriveFiles(File root,MobileStore store)throws Exception {this.root=root;this.store=store;cache=new File(root,"drive-blobs");stateFile=new File(root,"drive-state.json");Files.createDirectories(cache.toPath());}
 private JSONObject state()throws Exception {if(stateFile.isFile())return MobileStore.json(stateFile);return new JSONObject().put("device",UUID.randomUUID().toString()).put("books",new JSONObject());}
 public JSONObject binding(String id)throws Exception {return id==null?null:state().getJSONObject("books").optJSONObject(id);}
 public JSONObject bind(String id,String account,String head,String digest,boolean automatic)throws Exception {
  store.read(id);if(!digest.matches("[a-f0-9]{64}")||(head!=null&&!head.matches("[a-f0-9-]{36}")))throw new IOException("Versione non riconosciuta");
  JSONObject s=state(),old=s.getJSONObject("books").optJSONObject(id);if(old!=null&&!account.equals(old.getString("account")))throw new IOException("Questa copia è associata a un altro account Drive");
  JSONObject b=new JSONObject().put("account",account).put("head",head==null?JSONObject.NULL:head).put("digest",digest).put("automatic",automatic).put("lastSync",head==null?JSONObject.NULL:java.time.Instant.now().toString());s.getJSONObject("books").put(id,b);MobileStore.atomic(stateFile,s.toString());return b;
 }
 public void automatic(String id,boolean enabled)throws Exception {JSONObject s=state(),b=s.getJSONObject("books").optJSONObject(id);if(b==null)throw new IOException("Attiva prima la sincronizzazione di questa copia");b.put("automatic",enabled);MobileStore.atomic(stateFile,s.toString());}
 private static void collect(File folder,String prefix,List<String> names)throws Exception {File[] entries=new File(folder,prefix).listFiles();if(entries==null)return;for(File f:entries){if(Files.isSymbolicLink(f.toPath()))throw new IOException("Link escluso dalla sincronizzazione");String n=prefix.isEmpty()?f.getName():prefix+"/"+f.getName();if(f.isDirectory()){if(Arrays.asList("assets","novel-fonts","imports","snapshots").contains(n))collect(folder,n,names);}else if(MobileStore.allowed(n))names.add(n);}}
 private static JSONObject record(File f,String name)throws Exception {return new JSONObject().put("path",name).put("bytes",f.length()).put("sha256",MobileStore.hash(f));}
 private static void records(JSONArray files)throws Exception {if(files.length()<2||files.length()>10000)throw new IOException("Inventario Drive non valido");Set<String> names=new HashSet<>();long total=0;for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);String p=f.getString("path");long bytes=f.getLong("bytes");if(!MobileStore.allowed(p)||!names.add(p)||bytes<0||bytes>MobileStore.FILE_LIMIT||!f.getString("sha256").matches("[a-f0-9]{64}"))throw new IOException("File Drive non ammesso");if((p.equals("manifest.json")||p.equals("romanzo.json"))&&bytes>32L*1024*1024)throw new IOException("Documento oltre 32 MiB");total+=bytes;}if(total>MobileStore.LIMIT||!names.contains("manifest.json")||!names.contains("romanzo.json"))throw new IOException("Copia Drive oltre i limiti o incompleta");}
 // Explicit ASCII encoding shared with JSON.stringify; Android JSONStringer escapes '/' differently from the JVM test library.
 public static String digest(JSONArray files)throws Exception {records(files);List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<files.length();i++)sorted.add(files.getJSONObject(i));sorted.sort(Comparator.comparing(f->f.optString("path")));StringBuilder rows=new StringBuilder("[");for(JSONObject f:sorted){if(rows.length()>1)rows.append(',');String name=f.getString("path");if(!name.matches("[a-zA-Z0-9_./-]+"))throw new IOException("Percorso inventario non canonico");rows.append("[\"").append(name).append("\",").append(f.getLong("bytes")).append(",\"").append(f.getString("sha256")).append("\"]");}rows.append(']');byte[] b=MessageDigest.getInstance("SHA-256").digest(rows.toString().getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();for(byte x:b)hex.append(String.format(Locale.ROOT,"%02x",x&255));return hex.toString();}

 public static JSONObject properties(JSONObject c)throws Exception {String title=c.getString("title");while(title.getBytes(StandardCharsets.UTF_8).length>100)title=title.substring(0,title.offsetByCodePoints(0,title.codePointCount(0,title.length())-1));JSONArray parents=c.getJSONArray("parents");JSONObject p=new JSONObject().put("kind","officina-commit-1").put("version",c.getString("id")).put("project",c.getString("projectId")).put("device",c.getString("device")).put("title",title).put("date",c.getString("createdAt")).put("digest",c.getString("digest")).put("parentCount",String.valueOf(parents.length()));for(int i=0;i<parents.length();i++)p.put("p"+i,parents.getString(i));return p;}
 public static JSONObject summary(JSONObject p)throws Exception {int count=Integer.parseInt(p.getString("parentCount"));if(count<0||count>16)throw new IOException("Cronologia Drive non valida");JSONArray parents=new JSONArray();for(int i=0;i<count;i++)parents.put(p.getString("p"+i));return new JSONObject().put("format","officina-sync-1").put("id",p.getString("version")).put("projectId",p.getString("project")).put("device",p.getString("device")).put("title",p.getString("title")).put("createdAt",p.getString("date")).put("digest",p.getString("digest")).put("parents",parents);}
 public static JSONObject matches(JSONObject c,JSONObject s)throws Exception {for(String key:Arrays.asList("id","projectId","device","createdAt","digest"))if(!c.getString(key).equals(s.getString(key)))throw new IOException("Versione Drive diversa dalla cronologia dichiarata");if(!c.getJSONArray("parents").toString().equals(s.getJSONArray("parents").toString()))throw new IOException("Cronologia Drive non integra");return c;}
 private File cached(JSONObject r,File source,Transport api)throws Exception {
  String hash=r.getString("sha256");if(!hash.matches("[a-f0-9]{64}"))throw new IOException("Impronta Drive non valida");File target=new File(cache,hash+".blob");
  if(!target.exists()){File temp=new File(cache,hash+"."+UUID.randomUUID()+".tmp");if(source!=null)Files.copy(source.toPath(),temp.toPath());else{String blob=r.getString("blob");if(!blob.matches("[A-Za-z0-9_-]{1,200}"))throw new IOException("Risorsa Drive non valida");api.download(blob,temp,r);}if(temp.length()!=r.getLong("bytes")||!MobileStore.hash(temp).equals(hash))throw new IOException("Copia Drive non integra; file precedente conservato");Files.move(temp.toPath(),target.toPath());}
  if(target.length()!=r.getLong("bytes")||!MobileStore.hash(target).equals(hash))throw new IOException("Cache locale non integra; sincronizzazione fermata");return target;
 }
 public JSONObject snapshot(String id)throws Exception {
  JSONObject book=store.read(id);if(!"romanzo".equals(book.getJSONObject("project").getString("kind")))throw new IOException("Sincronizzazione iniziale per romanzi a flusso");
  File folder=store.folder(id);List<String> names=new ArrayList<>();collect(folder,"",names);Collections.sort(names);JSONArray files=new JSONArray();for(String name:names)files.put(record(new File(folder,name),name));records(files);for(int i=0;i<files.length();i++){JSONObject r=files.getJSONObject(i);cached(r,new File(folder,r.getString("path")),null);}
  return new JSONObject().put("projectId",book.getJSONObject("project").getString("id")).put("title",book.getJSONObject("project").getString("title")).put("files",files).put("digest",digest(files));
 }
 public JSONObject materialize(JSONObject c,Transport api)throws Exception {
  JSONArray files=c.getJSONArray("files");records(files);if(!"officina-sync-1".equals(c.getString("format"))||!c.getString("projectId").matches("[a-f0-9-]{36}")||!digest(files).equals(c.getString("digest")))throw new IOException("Versione Drive non integra");
  String id=UUID.randomUUID().toString();File folder=new File(store.staging,id);Files.createDirectory(folder.toPath());
  for(int i=0;i<files.length();i++){JSONObject r=files.getJSONObject(i);File source=cached(r,null,api),target=new File(folder,r.getString("path"));Files.createDirectories(target.getParentFile().toPath());
   if(Arrays.asList("manifest.json","romanzo.json","percorso.json").contains(r.getString("path")))Files.copy(source.toPath(),target.toPath());else try{Files.createLink(target.toPath(),source.toPath());}catch(IOException|UnsupportedOperationException e){Files.copy(source.toPath(),target.toPath());}
  }
  for(String name:Arrays.asList("assets","snapshots","outputs"))Files.createDirectories(new File(folder,name).toPath());
  JSONObject value=store.prepared(id);if(!value.getJSONObject("project").getString("id").equals(c.getString("projectId")))throw new IOException("La versione appartiene a un altro progetto");return value;
 }
 public JSONObject cloneBook(String id,String expected)throws Exception {JSONObject s=snapshot(id);if(!expected.equals(s.getString("digest")))throw new IOException("Copia locale cambiata: ripeti il confronto");JSONArray files=s.getJSONArray("files");for(int i=0;i<files.length();i++)files.getJSONObject(i).put("blob",files.getJSONObject(i).getString("sha256"));return materialize(new JSONObject().put("format","officina-sync-1").put("projectId",s.getString("projectId")).put("files",files).put("digest",expected),null);}
 public JSONObject publish(String id,JSONArray parents,String expected,Transport api)throws Exception {
  JSONObject snapshot=snapshot(id);if(!expected.equals(snapshot.getString("digest")))throw new IOException("Copia locale cambiata: aggiorna prima il confronto");if(parents.length()>16)throw new IOException("Troppe versioni da confrontare");Set<String> seen=new HashSet<>();for(int i=0;i<parents.length();i++){String p=parents.getString(i);if(!p.matches("[a-f0-9-]{36}")||!seen.add(p))throw new IOException("Cronologia non valida");}
  JSONArray files=snapshot.getJSONArray("files");for(int i=0;i<files.length();i++){JSONObject r=files.getJSONObject(i);r.put("blob",api.blob(cached(r,null,null),r));}
  JSONObject settings=state();MobileStore.atomic(stateFile,settings.toString());
  JSONObject commit=new JSONObject().put("format","officina-sync-1").put("id",UUID.randomUUID().toString()).put("device",settings.getString("device")).put("projectId",snapshot.getString("projectId")).put("title",snapshot.getString("title")).put("createdAt",java.time.Instant.now().toString()).put("parents",parents).put("files",files).put("digest",expected);
  File temp=new File(cache,UUID.randomUUID()+".json");MobileStore.atomic(temp,commit.toString());JSONObject r=record(temp,"commit.json");api.upload(temp,r,properties(commit));return commit;
 }
}
