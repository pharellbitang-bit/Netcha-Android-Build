import * as sdk from "matrix-js-sdk";
const $ = id => document.getElementById(id);
let client;
const log = value => { $("log").textContent += "\n" + value; };
$("connect").onclick = async () => {
  $("connect").disabled = true;
  try {
    const url = new URL($("homeserver").value.trim());
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Homeserver HTTPS requis");
    const user = $("user").value.trim(), password = $("password").value;
    if (!user || !password) throw new Error("Compte Matrix fictif requis");
    const auth = await sdk.createClient({baseUrl:url.origin}).loginRequest({
      type:"m.login.password",identifier:{type:"m.id.user",user},password,
      initial_device_display_name:"Netcha Android E2EE Lab"
    });
    $("password").value = "";
    client = sdk.createClient({baseUrl:url.origin,accessToken:auth.access_token,userId:auth.user_id,deviceId:auth.device_id});
    await client.initRustCrypto();
    const ready = new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error("Délai de synchronisation dépassé")),45000);
      client.once(sdk.ClientEvent.Sync,state=>{
        if(state==="PREPARED"){clearTimeout(timer);resolve();}
        if(state==="ERROR"){clearTimeout(timer);reject(new Error("Synchronisation Matrix en erreur"));}
      });
    });
    await client.startClient({initialSyncLimit:10});
    await ready;
    log("Moteur Rust/WASM initialisé et client synchronisé.");
    log("Compte de laboratoire : "+auth.user_id+" — appareil : "+auth.device_id);
    $("create").disabled=false;$("send").disabled=false;$("logout").disabled=false;
  } catch(error) {
    try { client?.stopClient(); await client?.logout(true); } catch {}
    client=undefined;$("password").value="";$("connect").disabled=false;
    log("ÉCHEC : "+(error.message||String(error)));
  }
};
$("create").onclick=async()=>{
  try {
    const result=await client.createRoom({
      name:"Netcha E2EE Android lab",preset:"private_chat",
      initial_state:[{type:"m.room.encryption",state_key:"",content:{algorithm:"m.megolm.v1.aes-sha2"}}]
    });
    $("room").value=result.room_id;log("Salon privé chiffré créé : "+result.room_id);
  } catch(error){log("Création impossible : "+(error.message||String(error)));}
};
$("send").onclick=async()=>{
  try {
    const roomId=$("room").value.trim(),body=$("message").value.trim();
    if(!roomId||!body)throw new Error("Salon et texte fictif requis");
    const state=client.getRoom(roomId)?.getLiveTimeline().getState(sdk.EventTimeline.FORWARDS);
    if(state?.getStateEvents("m.room.encryption","")?.getContent()?.algorithm!=="m.megolm.v1.aes-sha2")throw new Error("Salon non confirmé comme chiffré");
    await client.sendTextMessage(roomId,body);$("message").value="";
    log("Message transmis au SDK Matrix. Vérifier aussi l'événement stocké côté homeserver.");
  } catch(error){log("ENVOI BLOQUÉ : "+(error.message||String(error)));}
};
$("logout").onclick=async()=>{
  try{client?.stopClient();await client?.logout(true);}catch{}
  client=undefined;$("room").value="";$("message").value="";
  $("create").disabled=true;$("send").disabled=true;$("logout").disabled=true;$("connect").disabled=false;
  log("Session du laboratoire terminée.");
};
