package app.officinalibri;

import android.app.Activity;
import android.accounts.*;
import android.content.*;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import java.io.*;
import java.util.*;
import java.util.concurrent.ExecutorService;
import org.json.*;

public final class DriveConnection {
 public interface Reply {void send(String id,Object value,Exception error);}
 private static final String SCOPE="https://www.googleapis.com/auth/drive.appdata";
 private final Activity activity;private final MobileStore store;private final DriveFiles files;private final ExecutorService io;private final Reply reply;private final SharedPreferences prefs;
 private Request pending;private boolean closed;
 private static final class Request {String id,method,name;JSONObject args;Request(String id,String method,JSONObject args){this.id=id;this.method=method;this.args=args;}}
 public DriveConnection(Activity activity,MobileStore store,ExecutorService io,Reply reply)throws Exception {this.activity=activity;this.store=store;this.io=io;this.reply=reply;files=new DriveFiles(activity.getFilesDir(),store);prefs=activity.getSharedPreferences("officina-drive",0);}
 private JSONObject status(JSONObject args)throws Exception {String id=args.optString("id",null);JSONObject b=files.binding(id);return new JSONObject().put("configured",true).put("connected",prefs.getBoolean("connected",false)).put("account",prefs.getString("label",null)).put("bound",b!=null).put("automatic",b!=null&&b.optBoolean("automatic")).put("lastSync",b==null?JSONObject.NULL:b.opt("lastSync"));}
 public void request(String id,String method,JSONObject args)throws Exception {
  Object value;
  switch(method){
   case "driveStatus":value=status(args);break;
   case "driveDisconnect":prefs.edit().remove("name").remove("label").putBoolean("connected",false).apply();value=null;break;
   case "driveAutomatic":files.automatic(args.getString("id"),args.getBoolean("enabled"));value=status(args);break;
   case "driveSnapshot":value=files.snapshot(args.getString("id"));break;
   case "driveClone":value=files.cloneBook(args.getString("id"),args.getString("expectedDigest"));break;
   case "driveConnect":{Request r=new Request(id,method,args);activity.runOnUiThread(()->choose(r));return;}
   case "drivePrepare":case "driveCommits":case "driveVersion":case "driveReceive":case "drivePublish":case "driveBind":{
    Request r=new Request(id,method,args);r.name=prefs.getString("name",null);if(!prefs.getBoolean("connected",false)||r.name==null)throw new IOException("Collega prima Google Drive");activity.runOnUiThread(()->authorize(r,false));return;
   }
   default:throw new IOException("Operazione Drive non riconosciuta");
  }
  reply.send(id,value,null);
 }
 private void choose(Request r){if(pending!=null){reply.send(r.id,null,new IOException("Completa prima il collegamento Google aperto"));return;}pending=r;try{Intent picker=AccountManager.newChooseAccountIntent(null,null,new String[]{"com.google"},null,null,null,null);activity.startActivityForResult(picker,52);}catch(Exception e){fail(r,new IOException("Selezione account Google non disponibile"));}}
 private void authorize(Request r,boolean interactive){
  if(closed)return;if(pending!=null&&pending!=r){reply.send(r.id,null,new IOException("Accesso Google già in corso"));return;}pending=r;
  AuthorizationRequest request=AuthorizationRequest.builder().setAccount(new Account(r.name,"com.google")).setRequestedScopes(Collections.singletonList(new Scope(SCOPE))).build();
  Identity.getAuthorizationClient(activity).authorize(request).addOnSuccessListener(result->{try{if(result.hasResolution()){if(!interactive){fail(r,new IOException("Google richiede il tuo consenso: premi Collega Google Drive"));return;}activity.startIntentSenderForResult(result.getPendingIntent().getIntentSender(),51,null,0,0,0);}else authorized(r,result);}catch(Exception e){fail(r,new IOException("Collegamento Google non completato"));}}).addOnFailureListener(e->fail(r,new IOException("Google non ha autorizzato Officina Libri. Verifica la registrazione Android e riprova il collegamento")));
 }
 private void fail(Request r,Exception e){if(pending==r)pending=null;if(!closed)reply.send(r.id,null,e);}
 private void authorized(Request r,AuthorizationResult result){
  if(closed)return;String token=result.getAccessToken();if(token==null||!result.getGrantedScopes().contains(SCOPE)){fail(r,new IOException("Accesso ai dati Officina Libri non concesso"));return;}if(pending==r)pending=null;
  io.execute(()->{try{DriveHttp api=new DriveHttp(token);JSONObject account=api.account();prefs.edit().putString("label",account.getString("label")).apply();Object value;
   switch(r.method){
    case "driveConnect":prefs.edit().putString("name",r.name).putBoolean("connected",true).apply();value=status(r.args);break;
    case "drivePrepare":{String id=r.args.getString("id");JSONObject b=files.binding(id);if(b!=null&&!account.getString("id").equals(b.getString("account")))throw new IOException("Questa copia è associata a un altro account Drive");value=new JSONObject().put("snapshot",files.snapshot(id)).put("commits",api.commits()).put("base",b==null?JSONObject.NULL:b).put("account",account.getString("id"));break;}
    case "driveCommits":value=api.commits();break;
    case "driveVersion":value=api.version(r.args.getString("version"));break;
    case "driveReceive":value=files.materialize(r.args.getJSONObject("commit"),api);break;
    case "drivePublish":value=files.publish(r.args.getString("id"),r.args.getJSONArray("parents"),r.args.getString("expectedDigest"),api);break;
    case "driveBind":if(!account.getString("id").equals(r.args.getString("account")))throw new IOException("Account cambiato durante la sincronizzazione");value=files.bind(r.args.getString("id"),account.getString("id"),r.args.isNull("head")?null:r.args.getString("head"),r.args.getString("digest"),r.args.optBoolean("automatic",false));break;
    default:throw new IOException("Operazione Drive non riconosciuta");
   }
   reply.send(r.id,value,null);
  }catch(Exception e){if(e.getMessage()!=null&&e.getMessage().contains("Accesso Google scaduto"))activity.runOnUiThread(()->Identity.getAuthorizationClient(activity).clearToken(ClearTokenRequest.builder().setToken(token).build()));reply.send(r.id,null,e);}});
 }
 public boolean activityResult(int request,int result,Intent data){
  if(request!=51&&request!=52)return false;Request r=pending;if(r==null)return true;
  if(result!=Activity.RESULT_OK||data==null){fail(r,new IOException("Collegamento Google annullato"));return true;}
  try{if(request==52){String name=data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME),type=data.getStringExtra(AccountManager.KEY_ACCOUNT_TYPE);if(name==null||!"com.google".equals(type))throw new IOException("Account Google non riconosciuto");r.name=name;authorize(r,true);}else authorized(r,Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data));}catch(Exception e){fail(r,new IOException("Accesso Google non completato"));}return true;
 }
 public void close(){closed=true;pending=null;}
}
