import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { LocalNotifications } from '@capacitor/local-notifications';

(function () {
  let initialisation = null;
  let dernierJeton = '';

  function sessionToken() {
    try {
      return window.netchaStockageSession?.get?.() ||
        localStorage.getItem('netcha_token') ||
        sessionStorage.getItem('netcha_token') || '';
    } catch (_) {
      return '';
    }
  }

  async function transmettreJeton(token) {
    if (!token || token === dernierJeton) return;
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

  async function activerNotificationsAndroid() {
    if (!window.Capacitor?.isNativePlatform?.() ||
        window.Capacitor?.getPlatform?.() !== 'android' ||
        !sessionToken()) return;

    if (!initialisation) {
      initialisation = (async () => {
        try {
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
          const result = await FirebaseMessaging.getToken();
          if (result?.token) await transmettreJeton(result.token);
          await FirebaseMessaging.addListener('tokenReceived', event => {
            transmettreJeton(event?.token).catch(error =>
              console.warn('[Netcha push] Renouvellement du jeton impossible.', error)
            );
          });
          await FirebaseMessaging.addListener('notificationActionPerformed', event => {
            const data = event?.notification?.data || {};
            if (data.type === 'campaign_pending_review') {
              window.dispatchEvent(new CustomEvent('netcha:campaign-push-open', { detail: data }));
            }
          });
        } catch (error) {
          console.warn('[Netcha push] Initialisation impossible.', error);
          initialisation = null;
        }
      })();
    }
    await initialisation;
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
