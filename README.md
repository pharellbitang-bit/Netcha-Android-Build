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

## Compilation

Le workflow **Build Netcha Android APK** compile une APK de test. Elle n'est pas signée pour publication Play Store.
