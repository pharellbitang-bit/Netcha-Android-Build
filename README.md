# Netcha Android build

Ce dépôt contient l'enveloppe Android Capacitor de **Netcha uniquement**.

- Application : `com.netcha.app`
- Interface : embarquée dans l'APK (l'écran principal reste disponible sans réseau)
- API distante : serveur Netcha sur Railway
- Notifications : notifications Android locales à partir des notifications récupérées depuis l'API
- APK : artifact GitHub Actions `netcha-android-debug-apk`

## Fonctionnement hors connexion

L'APK charge désormais son interface depuis les fichiers inclus dans l'application, et non plus depuis une page Web distante. Les requêtes API restent dirigées vers le serveur Netcha. En cas de coupure, l'interface reste affichée et un indicateur signale l'absence de réseau ; les fonctions nécessitant le serveur reprennent à la reconnexion.

## Notifications

Lorsque Netcha est ouvert et connecté, l'application vérifie régulièrement les notifications du compte et affiche les nouvelles notifications dans le centre de notifications Android. Android peut retarder ou suspendre cette vérification lorsque l'application est en arrière-plan ou fermée. Sans service push externe ni tâche native persistante dédiée, une livraison immédiate en arrière-plan n'est pas garantie.

Aucun Firebase n'est utilisé.

## Interactions Android

L'interface embarquée utilise des transitions entre écrans, des retours tactiles visuels, des animations sur les stories, les actions sociales et les conversations, ainsi qu'une prise en charge de la préférence Android de réduction des animations. Aucun navigateur externe ni barre d'adresse n'est intégré à l'application.

## Compilation

Le workflow **Build Netcha Android APK** compile une APK de test. Elle n'est pas signée pour publication Play Store.


## Application web installable

La version web installable est publiée par GitHub Pages à l'adresse :
https://pharellbitang-bit.github.io/Netcha-Android-Build/

L'interface est servie depuis `www/`. Les appels `/api/*` sont envoyés vers le serveur Netcha de production sur Railway. Le serveur doit autoriser l'origine GitHub Pages via `NETCHA_ALLOWED_ORIGINS`. Le service worker ne met en cache que la coque statique de l'application : aucune API, session, conversation ou donnée personnelle n'est mise en cache.

Sur Android, ouvrir l'adresse dans Chrome puis utiliser le menu ⋮ > Installer l'application (ou Ajouter à l'écran d'accueil selon la version de Chrome).
