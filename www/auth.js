(function(){
  const topActions=document.querySelector('.top-actions');
  if(!topActions||document.getElementById('netchaAuthTrigger'))return;

  const style=document.createElement('style');
  style.textContent=`
  .auth-trigger{white-space:nowrap;font-size:12px;font-weight:800;padding:0 12px;width:auto;min-width:70px;background:linear-gradient(120deg,#8b9cff,#62e6d4);color:#0b1018;border:0}
  .auth-overlay{position:fixed;inset:0;z-index:110;display:none;align-items:flex-end;justify-content:center;padding:0 12px;background:#03060bd9;backdrop-filter:blur(8px)}
  .auth-overlay.is-open{display:flex;animation:authFadeIn .18s ease both}
  .auth-card{width:min(480px,100%);max-height:min(90dvh,760px);overflow:auto;overscroll-behavior:contain;background:#111a26;border:1px solid #2d4055;border-radius:24px 24px 0 0;padding:22px 18px calc(22px + env(safe-area-inset-bottom));box-shadow:0 25px 90px #0009;transform:translateY(25px);opacity:0;transition:transform .3s cubic-bezier(.2,.8,.2,1),opacity .22s ease}
  .auth-overlay.is-open .auth-card{transform:translateY(0);opacity:1}
  .auth-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
  .auth-heading h2{margin:0;font-size:23px;letter-spacing:-.6px}
  .auth-heading p{margin:5px 0 0;color:#98a8ba;font-size:12px;line-height:1.5}
  .auth-close{border:1px solid #2d4055;background:#172333;color:#e9efff;border-radius:12px;width:38px;height:38px;flex:0 0 38px;font-size:20px}
  .auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:5px;border:1px solid #26384b;border-radius:15px;background:#0b1018;margin:0 0 18px}
  .auth-tab{border:0;border-radius:11px;padding:11px 8px;background:transparent;color:#98a8ba;font-size:12px;font-weight:800}
  .auth-tab[aria-selected="true"]{color:#fff;background:linear-gradient(110deg,#7C3AED,#EC4899);box-shadow:0 5px 18px #7c3aed35}
  .auth-form[hidden]{display:none!important}
  .auth-form label{display:block;color:#c4cede;font-size:12px;font-weight:700;margin:12px 0 6px}
  .auth-form input,.auth-form select{display:block;width:100%;min-width:0;background:#0b1018;border:1px solid #29394e;border-radius:13px;padding:13px;color:#f4f8ff;outline:none}
  .auth-form input:focus,.auth-form select:focus{border-color:#7C3AED;box-shadow:0 0 0 3px #7C3AED30}
  .auth-submit{width:100%;margin-top:18px;min-height:47px;border:0;border-radius:13px;background:linear-gradient(110deg,#7C3AED,#EC4899);color:#fff;font-weight:850}
  .auth-submit:disabled{opacity:.6}
  .auth-message{min-height:0;margin:12px 0 0;font-size:12px;line-height:1.5;color:#b7e9d2;overflow-wrap:anywhere}
  .auth-message[data-error="true"]{color:#ffb6c1}
  @keyframes authFadeIn{from{opacity:0}to{opacity:1}}
  @media(min-width:600px){.auth-overlay{align-items:center}.auth-card{border-radius:24px;padding:26px;transform:translateY(12px) scale(.985)}.auth-overlay.is-open .auth-card{transform:translateY(0) scale(1)}}
  @media(max-width:380px){.top-actions{gap:5px}.top-actions .iconbtn:not(.auth-trigger){width:34px;height:36px;flex:0 0 34px}.auth-trigger{padding:0 8px;min-width:54px;font-size:11px}.auth-card{padding:19px 15px calc(18px + env(safe-area-inset-bottom))}}
  @media(prefers-reduced-motion:reduce){.auth-overlay,.auth-card{animation:none!important;transition:none!important}}
  `;
  document.head.appendChild(style);

  const trigger=document.createElement('button');
  trigger.type='button';trigger.id='netchaAuthTrigger';trigger.className='iconbtn auth-trigger';
  const actualiserLibelleCompte=()=>{const connecte=!!sessionStorage.getItem('netcha_token');trigger.textContent='Compte';trigger.setAttribute('aria-label',connecte?'Ouvrir mon compte':'Créer un compte ou se connecter')};actualiserLibelleCompte();
  topActions.appendChild(trigger);

  const modal=document.createElement('div');
  modal.id='netchaAuthModal';modal.className='auth-overlay';modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`
  <section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="netchaAuthTitle">
    <div class="auth-heading"><div><h2 id="netchaAuthTitle">Rejoindre Netcha</h2><p>Un seul espace pour créer ton compte ou te connecter.</p></div><button type="button" class="auth-close" id="netchaAuthClose" aria-label="Fermer">×</button></div>
    <div class="auth-tabs" role="tablist" aria-label="Accès au compte"><button type="button" class="auth-tab" id="netchaSignupTab" role="tab" aria-controls="netchaSignupForm" aria-selected="true">Créer un compte</button><button type="button" class="auth-tab" id="netchaLoginTab" role="tab" aria-controls="netchaLoginForm" aria-selected="false">Se connecter</button></div>
    <form id="netchaSignupForm" class="auth-form" autocomplete="on">
      <label for="netchaSignupName">Nom complet</label><input id="netchaSignupName" name="nom_affiche" placeholder="Ton nom complet" maxlength="80" autocomplete="name" required>
      <label for="netchaSignupUsername">Nom d’utilisateur</label><input id="netchaSignupUsername" name="identifiant" placeholder="Ex. Jean Paul ou jean_23" minlength="2" maxlength="30" autocomplete="username" required><small style="display:block;color:#98a8ba;font-size:11px;margin-top:6px">Tu peux utiliser des accents et des espaces ; les espaces seront convertis automatiquement en _.</small>
      <label for="netchaSignupEmail">Adresse e-mail</label><input id="netchaSignupEmail" name="email" type="email" placeholder="nom@exemple.com" autocomplete="email" maxlength="254" required>
      <label for="netchaSignupBirthYear">Accès rapide à l’année de naissance</label><select id="netchaSignupBirthYear" aria-label="Choisir rapidement l’année de naissance"><option value="">Choisir une année…</option></select><label for="netchaSignupBirth">Date de naissance complète</label><input id="netchaSignupBirth" name="date_naissance" type="date" autocomplete="bday" required aria-describedby="netchaBirthHint"><small id="netchaBirthHint" style="display:block;color:#98a8ba;font-size:11px;margin-top:6px">Il faut avoir au moins 13 ans pour créer un compte. Ta date de naissance n’est pas affichée publiquement.</small>
      <label for="netchaSignupGender">Genre</label><select id="netchaSignupGender" name="genre" autocomplete="sex" required><option value="">Choisir…</option><option value="FEMME">Femme</option><option value="HOMME">Homme</option><option value="PERSONNALISE">Personnalisé</option><option value="PREFERE_NE_PAS_REPONDRE">Préfère ne pas répondre</option></select>
      <label for="netchaSignupPhone">Téléphone (facultatif, pour retrouver tes contacts)</label><input id="netchaSignupPhone" name="telephone" type="tel" placeholder="+237 6XX XX XX XX" autocomplete="tel" inputmode="tel" maxlength="25" aria-describedby="netchaPhoneHint"><small id="netchaPhoneHint" style="display:block;color:#98a8ba;font-size:11px;margin-top:6px">Tu peux laisser ce champ vide. Ajoute ton numéro si tu veux faciliter la découverte par tes contacts Netcha.</small>
      <label for="netchaSignupPassword">Mot de passe</label><input id="netchaSignupPassword" name="mot_de_passe" type="password" placeholder="12 caractères minimum" minlength="12" maxlength="128" autocomplete="new-password" aria-describedby="netchaPasswordHint" required><small id="netchaPasswordHint" style="display:block;color:#98a8ba;font-size:11px;margin-top:6px">12 caractères minimum. Évite ton nom, ton identifiant et les mots de passe courants.</small><label for="netchaSignupPasswordConfirm">Confirmer le mot de passe</label><input id="netchaSignupPasswordConfirm" name="mot_de_passe_confirmation" type="password" placeholder="Saisis le même mot de passe" minlength="12" maxlength="128" autocomplete="new-password" required>
      <button class="auth-submit" type="submit">Créer mon compte</button>
    </form>
    <form id="netchaLoginForm" class="auth-form" autocomplete="on" hidden>
      <label for="netchaLoginUsername">Identifiant, e-mail ou téléphone</label><input id="netchaLoginUsername" name="identifiant" placeholder="Ton identifiant, e-mail ou +237…" autocomplete="username" required>
      <label for="netchaLoginPassword">Mot de passe</label><input id="netchaLoginPassword" name="mot_de_passe" type="password" placeholder="Ton mot de passe" autocomplete="current-password" required>
      <button class="auth-submit" type="submit">Se connecter</button><button type="button" class="auth-link" id="netchaForgotPassword" style="display:block;margin:12px auto 0;border:0;background:transparent;color:#c4b5fd;font-size:12px;font-weight:800;text-decoration:underline">Mot de passe oublié ?</button>
    </form>
    <form id="netchaRecoveryForm" class="auth-form" autocomplete="on" hidden><label for="netchaRecoveryEmail">Adresse e-mail du compte</label><input id="netchaRecoveryEmail" name="email" type="email" autocomplete="email" maxlength="254" placeholder="nom@exemple.com" required><p style="color:#98a8ba;font-size:12px;line-height:1.5">Nous enverrons un lien sécurisé valable 30 minutes si l’adresse est associée à un compte.</p><button class="auth-submit" type="submit">Envoyer le lien</button><button type="button" class="auth-link" data-auth-back="login" style="display:block;margin:12px auto 0;border:0;background:transparent;color:#c4b5fd;font-size:12px;font-weight:800">Retour à la connexion</button></form>
    <form id="netchaResetForm" class="auth-form" autocomplete="on" hidden><label for="netchaResetPassword">Nouveau mot de passe</label><input id="netchaResetPassword" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required placeholder="12 caractères minimum"><label for="netchaResetPasswordConfirm">Confirmer le nouveau mot de passe</label><input id="netchaResetPasswordConfirm" name="password_confirmation" type="password" minlength="12" maxlength="128" autocomplete="new-password" required placeholder="Saisis le même mot de passe"><button class="auth-submit" type="submit">Enregistrer le nouveau mot de passe</button></form>
    <p id="netchaAuthMessage" class="auth-message" aria-live="polite"></p>
  </section>`;
  document.body.appendChild(modal);

  const signupTab=document.getElementById('netchaSignupTab');
  const loginTab=document.getElementById('netchaLoginTab');
  const signupForm=document.getElementById('netchaSignupForm');
  const signupUsername=document.getElementById('netchaSignupUsername');
  // Remplacer les espaces immédiatement pendant la saisie, pas seulement à l'envoi.
  signupUsername.addEventListener('input',()=>{
    const debut=signupUsername.selectionStart,fin=signupUsername.selectionEnd;
    const avant=signupUsername.value;
    const apres=avant.replace(/\s/g,'_');
    if(apres!==avant){
      const avantCurseur=avant.slice(0,debut).replace(/\s/g,'_').length;
      const apresCurseur=avant.slice(0,fin).replace(/\s/g,'_').length;
      signupUsername.value=apres;
      signupUsername.setSelectionRange(avantCurseur,apresCurseur);
    }
  });
  const loginForm=document.getElementById('netchaLoginForm');
  const recoveryForm=document.getElementById('netchaRecoveryForm');
  const resetForm=document.getElementById('netchaResetForm');
  const message=document.getElementById('netchaAuthMessage');
  const title=document.getElementById('netchaAuthTitle');
  let lastFocus=null;

  function switchTab(which){
    const signup=which==='signup',login=which==='login',recovery=which==='recovery',reset=which==='reset';
    signupForm.hidden=!signup;loginForm.hidden=!login;recoveryForm.hidden=!recovery;resetForm.hidden=!reset;
    signupTab.setAttribute('aria-selected',String(signup));loginTab.setAttribute('aria-selected',String(login));
    title.textContent=signup?'Créer ton compte Netcha':login?'Bon retour sur Netcha':recovery?'Récupérer mon compte':'Choisir un nouveau mot de passe';
    message.textContent='';message.removeAttribute('data-error');
    const active=signup?signupForm:login?loginForm:recovery?recoveryForm:resetForm;
    active.querySelector('input')?.focus();
  }
  function openAuth(which='signup'){
    lastFocus=document.activeElement;switchTab(which);
    modal.classList.add('is-open');modal.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    setTimeout(()=>{(which==='signup'?signupForm:loginForm).querySelector('input')?.focus()},80);
  }
  function closeAuth(){
    modal.classList.remove('is-open');modal.setAttribute('aria-hidden','true');
    document.body.style.overflow='';lastFocus?.focus?.();
  }
  trigger.addEventListener('click',()=>{if(sessionStorage.getItem('netcha_token')){if(typeof window.go==='function')window.go('profile')}else openAuth('signup')});
  window.addEventListener('netcha:auth',actualiserLibelleCompte);
  signupTab.addEventListener('click',()=>switchTab('signup'));
  loginTab.addEventListener('click',()=>switchTab('login'));
  document.getElementById('netchaForgotPassword').addEventListener('click',()=>{recoveryForm.elements.email.value=loginForm.elements.identifiant.value.includes('@')?loginForm.elements.identifiant.value:'';switchTab('recovery')});
  modal.querySelectorAll('[data-auth-back]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.authBack)));
  document.getElementById('netchaAuthClose').addEventListener('click',closeAuth);
  modal.addEventListener('click',e=>{if(e.target===modal)closeAuth()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('is-open'))closeAuth()});

  async function afficherProfilNetcha(){
    const token=sessionStorage.getItem('netcha_token');if(!token)return;
    const r=await fetch('/api/profile',{headers:{Authorization:'Bearer '+token}});
    const d=await r.json();if(!r.ok)throw new Error(d.erreur||'Profil indisponible');
    const profil=d.profil||{},nomAffiche=profil.nom_affiche||profil.identifiant||'Utilisateur',identifiant=profil.identifiant||'';
    const profilZone=document.querySelector('#profile .profile-hero');
    if(profilZone){
      const nom=profilZone.querySelector('h2'),handle=profilZone.querySelector('.handle'),bio=profilZone.querySelector('.bio'),avatar=profilZone.querySelector('.profile-avatar');
      if(nom)nom.textContent=nomAffiche;if(handle)handle.textContent='@'+identifiant;
      if(bio)bio.textContent=profil.biographie||'Bienvenue dans mon univers ✨';
      if(avatar)avatar.textContent=Array.from(nomAffiche)[0].toUpperCase();
    }
    document.querySelectorAll('.mini-avatar, #create .composer .avatar').forEach(a=>{a.textContent=Array.from(nomAffiche)[0].toUpperCase()});
  }


  async function verifierCompletionCompteNetcha(){
    const token=sessionStorage.getItem('netcha_token');if(!token)return;
    try{
      const r=await fetch('/api/account/identity',{headers:{Authorization:'Bearer '+token}});
      const d=await r.json();if(!r.ok)throw new Error(d.erreur||'Informations de compte indisponibles');
      const identite=d.identite||{};
      if(identite.email&&identite.date_naissance&&identite.genre)return;
      let modal=document.getElementById('netchaIdentityModal');
      if(!modal){
        modal=document.createElement('div');modal.id='netchaIdentityModal';
        modal.style.cssText='position:fixed;inset:0;z-index:10000;background:#070b12ef;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
        modal.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="netchaIdentityTitle" style="width:min(460px,100%);background:#111a26;border:1px solid #35475b;border-radius:22px;padding:22px;color:#f4f8ff;box-shadow:0 20px 80px #0009"><h2 id="netchaIdentityTitle" style="margin:0 0 8px">Sécurise ton compte Netcha</h2><p style="color:#c4cede;font-size:13px;line-height:1.5">Ton compte existant est conservé. Ajoute une adresse e-mail à ton compte pour compléter les informations requises, sans créer un autre compte.</p><form id="netchaIdentityForm"><label for="netchaIdentityEmail" style="display:block;margin:12px 0 5px;font-size:12px;font-weight:700">Adresse e-mail</label><input id="netchaIdentityEmail" name="email" type="email" required autocomplete="email" maxlength="254" style="width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:1px solid #35475b;background:#0b1018;color:white"><label for="netchaIdentityBirthYear" style="display:block;margin:12px 0 5px;font-size:12px;font-weight:700">Accès rapide à l’année de naissance</label><select id="netchaIdentityBirthYear" aria-label="Choisir rapidement l’année de naissance" style="width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:1px solid #35475b;background:#0b1018;color:white"><option value="">Choisir une année…</option></select><label for="netchaIdentityBirth" style="display:block;margin:12px 0 5px;font-size:12px;font-weight:700">Date de naissance complète</label><input id="netchaIdentityBirth" name="date_naissance" type="date" autocomplete="bday" required style="width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:1px solid #35475b;background:#0b1018;color:white"><label for="netchaIdentityGender" style="display:block;margin:12px 0 5px;font-size:12px;font-weight:700">Genre</label><select id="netchaIdentityGender" name="genre" required style="width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:1px solid #35475b;background:#0b1018;color:white"><option value="">Choisir…</option><option value="FEMME">Femme</option><option value="HOMME">Homme</option><option value="PERSONNALISE">Personnalisé</option><option value="PREFERE_NE_PAS_REPONDRE">Préfère ne pas répondre</option></select><label for="netchaIdentityPhone" style="display:block;margin:12px 0 5px;font-size:12px;font-weight:700">Téléphone (facultatif)</label><input id="netchaIdentityPhone" name="telephone" type="tel" autocomplete="tel" placeholder="+237 6XX XX XX XX" maxlength="25" style="width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:1px solid #35475b;background:#0b1018;color:white"><p id="netchaIdentityMessage" role="status" style="font-size:12px;color:#c4cede"></p><button id="netchaIdentitySubmit" type="submit" style="width:100%;padding:13px;border:0;border-radius:12px;background:linear-gradient(110deg,#7C3AED,#EC4899);color:white;font-weight:800">Enregistrer et continuer</button></form></section>';
        document.body.appendChild(modal);
        installerRaccourciAnneeNaissance(document.getElementById('netchaIdentityBirth'),document.getElementById('netchaIdentityBirthYear'));
        modal.querySelector('#netchaIdentityForm').addEventListener('submit',async e=>{
          e.preventDefault();const form=e.currentTarget,button=modal.querySelector('#netchaIdentitySubmit'),msg=modal.querySelector('#netchaIdentityMessage');
          if(!form.reportValidity())return;button.disabled=true;msg.textContent='Enregistrement…';
          try{
            const response=await fetch('/api/account/identity',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessionStorage.getItem('netcha_token')},body:JSON.stringify({email:form.elements.email.value,telephone:form.elements.telephone.value,date_naissance:form.elements.date_naissance.value,genre:form.elements.genre.value})});
            const result=await response.json();if(!response.ok)throw new Error(result.erreur||'Impossible d’enregistrer les coordonnées.');
            modal.remove();window.dispatchEvent(new Event('netcha:auth'));await afficherProfilNetcha();
          }catch(error){msg.textContent=error.message||'Erreur de connexion.';msg.style.color='#ffb6c1'}
          finally{button.disabled=false}
        });
      }
      const form=modal.querySelector('#netchaIdentityForm');
      if(form&&!form.elements.email.value)form.elements.email.value=identite.email||'';
      if(form&&!form.elements.telephone.value)form.elements.telephone.value=identite.telephone||'';
      if(form&&!form.elements.date_naissance.value)form.elements.date_naissance.value=identite.date_naissance||'';
      if(form&&!form.elements.genre.value)form.elements.genre.value=identite.genre||'';
    }catch(error){console.warn('Vérification des coordonnées Netcha impossible',error)}
  }

  recoveryForm.addEventListener('submit',async e=>{
    e.preventDefault();if(!recoveryForm.reportValidity())return;
    const button=recoveryForm.querySelector('button[type="submit"]');button.disabled=true;
    message.textContent='Préparation du lien sécurisé…';message.removeAttribute('data-error');
    try{
      const r=await fetch('/api/password/forgot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:recoveryForm.elements.email.value})});
      const d=await r.json();if(!r.ok)throw new Error(d.erreur||'Récupération indisponible.');
      message.textContent=d.message||'Si cette adresse est associée à un compte, un lien sera envoyé.';
    }catch(err){message.textContent=err.message||'La récupération est momentanément indisponible.';message.dataset.error='true'}
    finally{button.disabled=false}
  });
  resetForm.addEventListener('submit',async e=>{
    e.preventDefault();if(!resetForm.reportValidity())return;
    const password=resetForm.elements.password.value,confirmation=resetForm.elements.password_confirmation.value;
    if(password!==confirmation){message.textContent='Les deux mots de passe ne correspondent pas.';message.dataset.error='true';return}
    const token=new URLSearchParams(window.location.search).get('reset');
    if(!token){message.textContent='Le lien de récupération est manquant. Demande un nouveau lien.';message.dataset.error='true';return}
    const button=resetForm.querySelector('button[type="submit"]');button.disabled=true;
    message.textContent='Mise à jour sécurisée du mot de passe…';message.removeAttribute('data-error');
    try{
      const r=await fetch('/api/password/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,nouveau_mot_de_passe:password})});
      const d=await r.json();if(!r.ok)throw new Error(d.erreur||'Réinitialisation impossible.');
      window.history.replaceState({},document.title,window.location.pathname);
      resetForm.reset();switchTab('login');message.textContent=d.message||'Mot de passe modifié. Reconnecte-toi.';
    }catch(err){message.textContent=err.message||'Réinitialisation impossible.';message.dataset.error='true'}
    finally{button.disabled=false}
  });

  async function envoyer(form,route,type){
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      if(!form.reportValidity())return;
      const submit=form.querySelector('button[type="submit"]'),data=new FormData(form);
      const identifiantBrut=String(data.get('identifiant')||'').trim();
      const identifiant=(type==='inscription'?identifiantBrut.replace(/\s+/g,'_'):identifiantBrut).toLowerCase();
      if(type==='inscription'){
        const motDePasse=String(data.get('mot_de_passe')||'');
        const confirmation=String(data.get('mot_de_passe_confirmation')||'');
        if(motDePasse!==confirmation){message.textContent='Les deux mots de passe ne correspondent pas.';message.dataset.error='true';return}
        if(motDePasse.length<12){message.textContent='Choisis un mot de passe de 12 caractères minimum.';message.dataset.error='true';return}
      }
      submit.disabled=true;message.textContent='Connexion sécurisée en cours…';message.removeAttribute('data-error');
      try{
        const r=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          identifiant,nom_affiche:data.get('nom_affiche')||'',mot_de_passe:data.get('mot_de_passe'),
          email:data.get('email')||null,telephone:data.get('telephone')||null,date_naissance:data.get('date_naissance')||null,genre:data.get('genre')||null,code_parrainage:(new URLSearchParams(window.location.search).get('invite')||'').toUpperCase()
        })});
        const d=await r.json();
        if(!r.ok)throw new Error(d.erreur||'Opération impossible.');
        if(type==='inscription'&&!d.token){
          message.textContent='Compte créé. Connecte-toi avec tes identifiants.';
          document.getElementById('netchaLoginUsername').value=identifiant;
          signupForm.reset();switchTab('login');
        }else{
          sessionStorage.setItem('netcha_token',d.token);
          message.textContent=type==='inscription'?'Compte créé. Bienvenue sur Netcha !':'Connexion réussie. Bienvenue sur Netcha !';
          signupForm.reset();
          window.dispatchEvent(new Event('netcha:auth'));
          try{await afficherProfilNetcha()}catch(err){console.warn('Profil Netcha indisponible',err)}
          closeAuth();
          await verifierCompletionCompteNetcha();
        }
      }catch(err){
        const texte=err.message||'Connexion impossible pour le moment.';
        const bas=texte.toLocaleLowerCase('fr');
        const doublon=type==='inscription'&&/(déjà utilisé|déjà associée|déjà associé|coordonnée.*utilisé|coordonnées.*utilisé|duplicate key|unique constraint)/i.test(texte);
        if(doublon){
          const email=String(data.get('email')||'').trim();
          const telephone=String(data.get('telephone')||'').trim();
          const valeurConnexion=/(e-?mail|adresse)/i.test(texte)&&email?email:
            /(téléphone|numéro)/i.test(texte)&&telephone?telephone:identifiant;
          loginForm.elements.identifiant.value=valeurConnexion;
          switchTab('login');
          message.textContent=texte+' Si ces coordonnées appartiennent à ton ancien compte, connecte-toi avec celles-ci ou utilise « Mot de passe oublié ». Sinon, vérifie le champ déjà associé à un compte.';
        }else{
          message.textContent=texte;
        }
        message.dataset.error='true'
      }
      finally{submit.disabled=false}
    });
  }
  const limiteNaissance=new Date();limiteNaissance.setFullYear(limiteNaissance.getFullYear()-13);
  const maxNaissance=limiteNaissance.toISOString().slice(0,10);
  function installerRaccourciAnneeNaissance(input,select){
    if(!input||!select||select.dataset.ready==='true')return;
    select.dataset.ready='true';
    input.max=maxNaissance;
    const anneeMax=Number(maxNaissance.slice(0,4));
    const fragment=document.createDocumentFragment();
    for(let annee=anneeMax;annee>=1900;annee--){
      const option=document.createElement('option');option.value=String(annee);option.textContent=String(annee);fragment.appendChild(option);
    }
    select.appendChild(fragment);
    const synchroniserAnnee=()=>{select.value=input.value?input.value.slice(0,4):''};
    select.addEventListener('change',()=>{
      const annee=Number(select.value);if(!annee)return;
      const ancienne=input.value;
      const moisJour=ancienne?ancienne.slice(5):'01-01';
      let candidate=annee+'-'+moisJour;
      if(candidate>maxNaissance)candidate=maxNaissance;
      input.value=candidate;
      synchroniserAnnee();
    });
    input.addEventListener('change',synchroniserAnnee);
    synchroniserAnnee();
  }
  installerRaccourciAnneeNaissance(document.getElementById('netchaSignupBirth'),document.getElementById('netchaSignupBirthYear'));
  const identityBirth=document.getElementById('netchaIdentityBirth');if(identityBirth)installerRaccourciAnneeNaissance(identityBirth,document.getElementById('netchaIdentityBirthYear'));
  envoyer(signupForm,'register','inscription');
  envoyer(loginForm,'login','connexion');
  if(sessionStorage.getItem('netcha_token'))afficherProfilNetcha().then(verifierCompletionCompteNetcha).catch(()=>sessionStorage.removeItem('netcha_token'));
  if(new URLSearchParams(window.location.search).has('reset'))openAuth('reset');
})();