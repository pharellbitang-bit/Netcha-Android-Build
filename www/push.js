import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { LocalNotifications } from '@capacitor/local-notifications';

(function () {
  let initialisation = null;
  let dernierJeton = '';
  let ecouteursInstalles = false;
  let renouvellementInitialEffectue = false;

  function sessionToken() {
    try {
      return window.netchaStockageSession?.get?.() ||
        localStorage.getItem('netcha_token') ||
        sessionStorage.getItem('netcha_token') || '';
    } catch (_) {
      return '';
    }
  }

  async function transmettreJeton(token, forcer = false) {
    if (!token || (!forcer && token === dernierJeton)) return;
    const session = sessionToken();
    if (!session) return;
    const response = await window.fetch('/api/push/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session
      },
      body: JSON.stringify({
        token,
        platform: 'android',
        device_name: (window.Capacitor?.getPlatform?.() || 'android') + ' Netcha'
      })
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || 'Enregistrement du téléphone impossible.');
    }
    dernierJeton = token;
  }

  async function installerEcouteurs() {
    if (ecouteursInstalles) return;
    await FirebaseMessaging.addListener('tokenReceived', event => {
      transmettreJeton(event?.token, true).catch(error =>
        console.warn('[Netcha push] Réenregistrement du nouveau jeton impossible.', error)
      );
    });
    await FirebaseMessaging.addListener('notificationReceived', async event => {
      const notification = event?.notification || {};
      const title = String(notification.title || 'Netcha').slice(0, 100);
      const body = String(notification.body || 'Tu as une nouvelle notification.').slice(0, 240);
      try {
        await LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Date.now() % 2147483647),
            title,
            body,
            channelId: 'messages',
            schedule: { at: new Date(Date.now() + 150) }
          }]
        });
      } catch (error) {
        console.warn('[Netcha push] Affichage local au premier plan impossible.', error);
      }
    });
    await FirebaseMessaging.addListener('notificationActionPerformed', event => {
      const data = event?.notification?.data || {};
      if (data.type === 'campaign_pending_review') {
        window.dispatchEvent(new CustomEvent('netcha:campaign-push-open', { detail: data }));
      }
    });
    ecouteursInstalles = true;
  }

  async function synchroniserJetonAndroid() {
    if (!window.Capacitor?.isNativePlatform?.() ||
        window.Capacitor?.getPlatform?.() !== 'android' ||
        !sessionToken()) return;

    await LocalNotifications.createChannel({
      id: 'messages',
      name: 'Netcha',
      description: 'Alertes importantes de Netcha',
      importance: 5,
      visibility: 1,
      sound: 'default',
      vibration: true
    }).catch(() => {});

    let permissions = await FirebaseMessaging.checkPermissions();
    if (permissions.receive !== 'granted') {
      permissions = await FirebaseMessaging.requestPermissions();
    }
    if (permissions.receive !== 'granted') {
      console.info('[Netcha push] Autorisation Android non accordée.');
      return;
    }

    await installerEcouteurs();

    // Un jeton FCM peut être révoqué côté Firebase sans événement côté application.
    // Au premier démarrage authentifié, on supprime le jeton local potentiellement
    // périmé puis on en demande un neuf avant de le réenregistrer côté Netcha.
    if (!renouvellementInitialEffectue) {
      try {
        await FirebaseMessaging.deleteToken();
      } catch (error) {
        console.warn('[Netcha push] Suppression du jeton local précédent impossible.', error);
      }
      renouvellementInitialEffectue = true;
    }

    const result = await FirebaseMessaging.getToken();
    if (result?.token) await transmettreJeton(result.token, true);
  }

  function activerNotificationsAndroid() {
    if (initialisation) return initialisation;
    initialisation = synchroniserJetonAndroid()
      .catch(error => console.warn('[Netcha push] Synchronisation du jeton impossible.', error))
      .finally(() => { initialisation = null; });
    return initialisation;
  }

  window.addEventListener('netcha:auth', () => {
    dernierJeton = '';
    activerNotificationsAndroid();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activerNotificationsAndroid();
  });
  window.addEventListener('load', () => activerNotificationsAndroid());
  setTimeout(() => activerNotificationsAndroid(), 1200);
})();
