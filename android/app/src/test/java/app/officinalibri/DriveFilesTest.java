package app.officinalibri;

import org.junit.*;
import org.junit.rules.TemporaryFolder;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.Assert.*;

public class DriveFilesTest {
 @Rule public TemporaryFolder temporary=new TemporaryFolder();
 private File fixture(){return new File(System.getProperty("officina.driveFixture"));}
 private static final class Cloud implements DriveFiles.Transport {
  final Map<String,byte[]> data=new HashMap<>();boolean corrupt;File exported;
  public JSONObject account()throws Exception {return new JSONObject().put("id","synthetic-account");}
  public JSONArray commits(){return new JSONArray();}
  public String blob(File source,JSONObject r)throws Exception {assertEquals(r.getString("sha256"),MobileStore.hash(source));String id=UUID.randomUUID().toString();data.put(id,Files.readAllBytes(source.toPath()));return id;}
  public String upload(File source,JSONObject r,JSONObject properties)throws Exception {assertEquals(r.getString("sha256"),MobileStore.hash(source));if(exported!=null&&"officina-commit-1".equals(properties.getString("kind"))){Files.copy(source.toPath(),exported.toPath(),StandardCopyOption.REPLACE_EXISTING);Files.write(new File(exported.getParentFile(),"from-android-properties.json").toPath(),properties.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}return UUID.randomUUID().toString();}
  public void download(String id,File target,JSONObject r)throws Exception {assertNotNull(data.get(id));Files.write(target.toPath(),corrupt?new byte[]{1,2}:data.get(id));}
 }
 private Cloud cloud(JSONObject commit)throws Exception {Cloud c=new Cloud();File source=new File(new String(Files.readAllBytes(new File(fixture(),"root.txt").toPath()),java.nio.charset.StandardCharsets.UTF_8).trim());JSONArray files=commit.getJSONArray("files");for(int i=0;i<files.length();i++){JSONObject r=files.getJSONObject(i);c.data.put(r.getString("blob"),Files.readAllBytes(new File(source,r.getString("path")).toPath()));}return c;}
 @Test public void nodeAndroidNodeKeepsFontsImagesAndRichStructures()throws Exception {
  JSONObject commit=MobileStore.json(new File(fixture(),"commit.json")),snapshot=MobileStore.json(new File(fixture(),"snapshot.json"));assertEquals(snapshot.getString("digest"),DriveFiles.digest(snapshot.getJSONArray("files")));
  Cloud cloud=cloud(commit);cloud.exported=new File(fixture(),"from-android.json");MobileStore store=new MobileStore(temporary.newFolder());DriveFiles drive=new DriveFiles(temporary.newFolder(),store);
  JSONObject preview=drive.materialize(commit,cloud),original=store.accept(preview.getString("id"));String id=original.getString("id"),before=MobileStore.hash(new File(store.folder(id),"romanzo.json"));
  JSONObject actual=drive.snapshot(id);assertEquals(commit.getString("digest"),actual.getString("digest"));
  JSONObject clone=drive.cloneBook(id,actual.getString("digest"));store.accept(clone.getString("id"));String copy=clone.getString("id");JSONObject n=store.read(copy).getJSONObject("novel"),section=n.getJSONArray("sections").getJSONObject(0);String notes=section.getJSONArray("notes").toString(),table=section.getJSONArray("paragraphs").getJSONObject(1).toString(),old=section.getJSONArray("paragraphs").getJSONObject(0).getJSONArray("runs").getJSONObject(0).getString("text");section.getJSONArray("paragraphs").getJSONObject(0).getJSONArray("runs").getJSONObject(0).put("text","Modificato in Java Drive");section.put("text",section.getString("text").replace(old,"Modificato in Java Drive"));store.save(copy,n);assertEquals(notes,section.getJSONArray("notes").toString());assertEquals(table,section.getJSONArray("paragraphs").getJSONObject(1).toString());assertEquals(before,MobileStore.hash(new File(store.folder(id),"romanzo.json")));
  JSONObject changed=drive.snapshot(copy),published=drive.publish(copy,new JSONArray().put(commit.getString("id")),changed.getString("digest"),cloud);assertEquals(changed.getString("digest"),published.getString("digest"));drive.bind(copy,"synthetic-account",published.getString("id"),published.getString("digest"),true);assertTrue(drive.binding(copy).getBoolean("automatic"));
  store.exportArchive(copy,new FileOutputStream(new File(fixture(),"from-android.officinazip")));
 }
 @Test public void corruptionAndTraversalNeverReplaceAnExistingBook()throws Exception {
  JSONObject commit=MobileStore.json(new File(fixture(),"commit.json"));Cloud cloud=cloud(commit);cloud.corrupt=true;MobileStore store=new MobileStore(temporary.newFolder());DriveFiles drive=new DriveFiles(temporary.newFolder(),store);try{drive.materialize(commit,cloud);fail();}catch(IOException expected){assertEquals(0,store.list().length());}
  JSONObject bad=new JSONObject(commit.toString());bad.getJSONArray("files").getJSONObject(0).put("path","../outside");try{drive.materialize(bad,cloud);fail();}catch(IOException expected){assertEquals(0,store.list().length());}
 }
 @Test public void onlyGoogleDriveHttpsIsAccepted()throws Exception {
  assertEquals("www.googleapis.com",DriveHttp.allowed("https://www.googleapis.com/drive/v3/files").getHost());
  for(String url:Arrays.asList("http://www.googleapis.com/drive/v3/files","https://evil.invalid/drive/v3/files","https://name@www.googleapis.com/drive/v3/files","https://www.googleapis.com/oauth2/token"))try{DriveHttp.allowed(url);fail();}catch(IOException expected){}
 }
 @Test public void metadataContainsTheSameHistoryAsItsDocument()throws Exception {
  JSONObject c=MobileStore.json(new File(fixture(),"commit.json")),p=DriveFiles.properties(c),s=DriveFiles.summary(p);assertEquals(c.getString("digest"),s.getString("digest"));assertEquals(c.getJSONArray("parents").toString(),s.getJSONArray("parents").toString());assertEquals(c,DriveFiles.matches(c,s));p.put("digest","0".repeat(64));try{DriveFiles.matches(c,DriveFiles.summary(p));fail();}catch(IOException expected){}
 }

 @Test public void canonicalInventoryMatchesJavascriptWithNestedPaths()throws Exception {JSONArray files=new JSONArray("[{\"path\":\"romanzo.json\",\"bytes\":3,\"sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"},{\"path\":\"assets/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png\",\"bytes\":7,\"sha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"},{\"path\":\"manifest.json\",\"bytes\":2,\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]");assertEquals("3a10399708d815cce78401dcc8146f44609dca1c19a9fc751baa02ddbe3b1963",DriveFiles.digest(files));files.getJSONObject(1).put("bytes",8);assertNotEquals("3a10399708d815cce78401dcc8146f44609dca1c19a9fc751baa02ddbe3b1963",DriveFiles.digest(files));}
}
