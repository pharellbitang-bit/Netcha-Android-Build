import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as sdk from "matrix-js-sdk";
const baseUrl=process.env.MATRIX_BASE_URL??"http://127.0.0.1:8008";
const password="Netcha-Lab-Only-2026!";
const markers=["NETCHA_ANDROID_LAB_A_TO_B","NETCHA_ANDROID_LAB_B_TO_A","NETCHA_ANDROID_LAB_AFTER_REMOVAL"];
const clients=[];
async function register(username){
 const secret=process.env.MATRIX_REGISTRATION_SHARED_SECRET;
 if(!secret)throw new Error("Secret éphémère de test absent");
 const nr=await fetch(baseUrl+"/_synapse/admin/v1/register");
 assert.equal(nr.status,200,"Nonce d'inscription indisponible");
 const {nonce}=await nr.json();
 const mac=createHmac("sha1",secret).update(nonce+"\0"+username+"\0"+password+"\0notadmin").digest("hex");
 const response=await fetch(baseUrl+"/_synapse/admin/v1/register",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({nonce,username,password,admin:false,mac})
 });
 assert.equal(response.status,200,"Création compte fictif impossible: "+await response.text());
}
async function login(username){
 const auth=await sdk.createClient({baseUrl}).loginRequest({
  type:"m.login.password",identifier:{type:"m.id.user",user:username},password,
  initial_device_display_name:"Netcha Android CI "+username
 });
 const c=sdk.createClient({baseUrl,accessToken:auth.access_token,userId:auth.user_id,deviceId:auth.device_id});
 await c.initRustCrypto({useIndexedDB:false});clients.push(c);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error("Timeout synchronisation Matrix")),60000);
  c.once(sdk.ClientEvent.Sync,state=>{
   if(state==="PREPARED"){clearTimeout(timer);resolve();}
   else if(state==="ERROR"){clearTimeout(timer);reject(new Error("Synchronisation Matrix en erreur"));}
  });
  c.startClient({initialSyncLimit:20});
 });
 return c;
}
async function waitFor(client,roomId,body){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  if((client.getRoom(roomId)?.getLiveTimeline().getEvents()??[]).some(e=>e.getType()==="m.room.message"&&e.getContent()?.body===body))return;
  await new Promise(r=>setTimeout(r,300));
 }
 throw new Error("Message non déchiffré par le destinataire : "+body);
}
try{
 await register("netcha_android_a");await register("netcha_android_b");await register("netcha_android_c");
 const a=await login("netcha_android_a"),b=await login("netcha_android_b"),c=await login("netcha_android_c");
 const created=await a.createRoom({
  name:"Netcha Android E2EE isolated test",preset:"private_chat",
  invite:[b.getUserId(),c.getUserId()],
  initial_state:[{type:"m.room.encryption",state_key:"",content:{algorithm:"m.megolm.v1.aes-sha2"}}]
 });
 const roomId=created.room_id,deadline=Date.now()+30000;
 while(Date.now()<deadline&&(!b.getRoom(roomId)||!c.getRoom(roomId)))await new Promise(r=>setTimeout(r,300));
 assert(b.getRoom(roomId)&&c.getRoom(roomId),"Invitations des comptes B/C non reçues");
 await b.joinRoom(roomId);await c.joinRoom(roomId);
 const first=await a.sendTextMessage(roomId,markers[0]);await waitFor(b,roomId,markers[0]);
 const beforeRaw=await a.fetchRoomEvent(roomId,first.event_id);
 assert.equal(beforeRaw.type,"m.room.encrypted","Premier message non chiffré");
 const beforeSession=beforeRaw.content?.session_id;
 assert.ok(beforeSession,"Session Megolm initiale absente");
 await b.sendTextMessage(roomId,markers[1]);await waitFor(a,roomId,markers[1]);
 await a.kick(roomId,c.getUserId(),"Test retrait membre");
 const removedDeadline=Date.now()+30000;
 while(Date.now()<removedDeadline&&c.getRoom(roomId)?.getMyMembership()!=="leave")await new Promise(r=>setTimeout(r,300));
 assert.equal(c.getRoom(roomId)?.getMyMembership(),"leave","Le membre retiré n'a pas quitté le salon");
 const after=await a.sendTextMessage(roomId,markers[2]);await waitFor(b,roomId,markers[2]);
 const afterRaw=await a.fetchRoomEvent(roomId,after.event_id);
 assert.equal(afterRaw.type,"m.room.encrypted","Message après retrait non chiffré");
 assert.ok(afterRaw.content?.session_id,"Nouvelle session Megolm absente");
 assert.notEqual(afterRaw.content.session_id,beforeSession,"La session Megolm n'a pas changé après le retrait du membre");
 const response=await fetch(baseUrl+"/_matrix/client/v3/rooms/"+encodeURIComponent(roomId)+"/messages?dir=b&limit=50",{
  headers:{authorization:"Bearer "+a.getAccessToken()}
 });
 assert.equal(response.status,200,"Lecture des événements homeserver impossible");
 const events=(await response.json()).chunk??[],serialized=JSON.stringify(events);
 for(const marker of markers)assert(!serialized.includes(marker),"Texte sentinelle visible côté serveur : "+marker);
 assert(events.some(event=>event.type==="m.room.encrypted"),"Aucun événement m.room.encrypted stocké");
 console.log("PASS : messages déchiffrés dans les deux sens.");
 console.log("PASS : le homeserver stocke des événements chiffrés sans sentinelles en clair.");
 console.log("PASS : une nouvelle session Megolm est utilisée après le retrait du membre.");
 console.log("NON TESTÉ : vérification humaine, cross-signing, sauvegarde/restauration, révocation appareil, médias, notifications et compatibilité Android WebView réelle.");
}catch(error){console.error(error);process.exitCode=1;}
finally{for(const c of clients){try{c.stopClient();await c.logout(true);}catch{}}}
